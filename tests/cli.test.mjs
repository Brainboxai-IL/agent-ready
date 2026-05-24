import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("dist/cli.js");

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ready-fixture-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fixture-next-supabase",
        packageManager: "npm@10.0.0",
        scripts: {
          dev: "next dev",
          build: "next build",
          lint: "next lint",
          typecheck: "tsc --noEmit"
        },
        dependencies: {
          next: "latest",
          react: "latest",
          "react-dom": "latest",
          "@supabase/supabase-js": "latest"
        },
        devDependencies: {
          typescript: "latest"
        }
      },
      null,
      2
    )
  );
  await mkdir(path.join(root, "src", "app", "(dashboard)"), { recursive: true });
  await writeFile(path.join(root, "next.config.ts"), "export default {};\n");
  await writeFile(path.join(root, "middleware.ts"), "export function middleware() {}\n");
  await writeFile(path.join(root, "src", "utils.ts"), "export function title() { return 'שלום'; }\n");
  await writeFile(path.join(root, "src", "app", "layout.tsx"), "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n");
  await writeFile(path.join(root, "src", "app", "(dashboard)", "page.tsx"), "import { title } from '../../utils.js';\nexport default function Page() { return <main dir=\"rtl\">{title()}</main>; }\n");
  return root;
}

test("analyze detects stack and does not write files", async () => {
  const root = await createFixture();
  try {
    const { stdout } = await execFileAsync("node", [cliPath, "analyze", root]);
    assert.match(stdout, /fixture-next-supabase/);
    assert.match(stdout, /Next\.js/);
    assert.match(stdout, /React/);
    assert.match(stdout, /Supabase/);
    assert.doesNotMatch(stdout, /Entry points: 0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init generates harness files and stack-specific skills", async () => {
  const root = await createFixture();
  try {
    await execFileAsync("node", [cliPath, "init", root]);
    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
    const codemap = await readFile(path.join(root, "CODEMAP.md"), "utf8");
    const nextSkill = await readFile(path.join(root, ".claude", "skills", "nextjs-hydration", "SKILL.md"), "utf8");
    const supabaseSkill = await readFile(path.join(root, ".claude", "skills", "supabase-debugging", "SKILL.md"), "utf8");
    const rtlSkill = await readFile(path.join(root, ".claude", "skills", "rtl-ui", "SKILL.md"), "utf8");
    const settings = JSON.parse(await readFile(path.join(root, ".claude", "settings.json"), "utf8"));
    const destructiveHook = await readFile(path.join(root, ".claude", "hooks", "prevent-destructive.mjs"), "utf8");
    const validationHook = await readFile(path.join(root, ".claude", "hooks", "suggest-validation.mjs"), "utf8");

    assert.match(claude, /Next\.js detected/);
    assert.match(codemap, /fixture-next-supabase/);
    assert.match(codemap, /Internal Import Graph/);
    assert.match(codemap, /`src\/app\/\(dashboard\)\/page\.tsx` — Next\.js route; App Router route segment entry/);
    assert.match(codemap, /`src\/app\/layout\.tsx` — Next\.js layout; App Router root entry/);
    assert.match(codemap, /`middleware\.tsx?`|`middleware\.ts`/);
    assert.match(codemap, /`src\/app\/\(dashboard\)\/page\.tsx` → `src\/utils\.ts`/);
    assert.match(nextSkill, /hydration/i);
    assert.match(supabaseSkill, /Supabase/);
    assert.match(rtlSkill, /RTL/);

    // Skills must carry valid YAML frontmatter (name + description) or Claude
    // Code will not load them. Guard against regressing to a plain heading.
    for (const [slug, content] of [
      ["nextjs-hydration", nextSkill],
      ["supabase-debugging", supabaseSkill],
      ["rtl-ui", rtlSkill],
    ]) {
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(frontmatter, `${slug} SKILL.md must start with YAML frontmatter`);
      assert.match(frontmatter[1], new RegExp(`(^|\\n)name: ${slug}(\\n|$)`), `${slug} frontmatter must declare name: ${slug}`);
      assert.match(frontmatter[1], /(^|\n)description: \S/, `${slug} frontmatter must declare a non-empty description`);
    }
    assert.ok(settings.hooks.PreToolUse.length > 0);
    assert.equal(Object.hasOwn(settings, "agentReady"), false);
    assert.ok(settings.permissions.deny.every((rule) => /^(Write|Edit|MultiEdit)\(.+\)$/.test(rule)));
    assert.ok(!settings.permissions.deny.includes("dist/**"));
    assert.ok(settings.permissions.deny.includes("Write(dist/**)"));
    assert.match(destructiveHook, /permissionDecision/);
    assert.match(validationHook, /Suggested validation after edits/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run verbose prints generated contents", async () => {
  const root = await createFixture();
  try {
    const { stdout } = await execFileAsync("node", [cliPath, "init", root, "--dry-run", "--verbose"]);

    assert.match(stdout, /would create: CLAUDE\.md/);
    assert.match(stdout, /--- CLAUDE\.md begin ---/);
    assert.match(stdout, /AI Agent Guide/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated harness files do not count as maintainer-authored readiness", async () => {
  const root = await createFixture();
  try {
    await execFileAsync("node", [cliPath, "init", root]);
    const { stdout } = await execFileAsync("node", [cliPath, "analyze", root]);

    assert.match(stdout, /existing file is agent-ready generated/);
    assert.match(stdout, /not counted as maintainer-authored readiness/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("builds Python, Go, and Rust import graph", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ready-polyglot-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "polyglot" }, null, 2));

    await mkdir(path.join(root, "src", "pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "main.py"), "from .pkg import helper\nprint(helper.value())\n");
    await writeFile(path.join(root, "src", "pkg", "__init__.py"), "from .helper import value\n");
    await writeFile(path.join(root, "src", "pkg", "helper.py"), "def value(): return 1\n");

    await mkdir(path.join(root, "internal", "calc"), { recursive: true });
    await writeFile(path.join(root, "go.mod"), "module example.com/polyglot\n");
    await writeFile(path.join(root, "main.go"), "package main\nimport \"example.com/polyglot/internal/calc\"\nfunc main(){ calc.Value() }\n");
    await writeFile(path.join(root, "internal", "calc", "calc.go"), "package calc\nfunc Value() int { return 1 }\n");

    await mkdir(path.join(root, "src", "core"), { recursive: true });
    await writeFile(path.join(root, "src", "lib.rs"), "pub mod core;\nuse crate::core::thing;\n");
    await writeFile(path.join(root, "src", "core", "mod.rs"), "pub mod thing;\n");
    await writeFile(path.join(root, "src", "core", "thing.rs"), "pub fn value() -> i32 { 1 }\n");

    await execFileAsync("node", [cliPath, "init", root]);
    const codemap = await readFile(path.join(root, "CODEMAP.md"), "utf8");

    assert.match(codemap, /`src\/main\.py` → `src\/pkg\/__init__\.py`/);
    assert.match(codemap, /`main\.go` → `internal\/calc\/calc\.go`/);
    assert.match(codemap, /`src\/lib\.rs` → `src\/core\/mod\.rs`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not mislabel Vite + React Router pages as Next.js routes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ready-vite-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "vite-spa",
          scripts: { dev: "vite", build: "vite build" },
          dependencies: { react: "latest", "react-dom": "latest", "react-router-dom": "latest" },
          devDependencies: { vite: "latest", typescript: "latest" },
        },
        null,
        2
      )
    );
    await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
    await mkdir(path.join(root, "src", "pages"), { recursive: true });
    await writeFile(path.join(root, "src", "main.tsx"), "import './pages/Home';\n");
    await writeFile(path.join(root, "src", "pages", "Home.tsx"), "export default function Home() { return null; }\n");

    await execFileAsync("node", [cliPath, "init", root]);
    const codemap = await readFile(path.join(root, "CODEMAP.md"), "utf8");

    assert.doesNotMatch(codemap, /Next\.js/);
    assert.doesNotMatch(codemap, /Pages Router/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enriches CLAUDE.md with README description and .env.example variables", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ready-enrich-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "enrich-app", scripts: { build: "tsc" }, dependencies: { express: "latest" } }, null, 2)
    );
    await writeFile(
      path.join(root, "README.md"),
      [
        "# Enrich App",
        "",
        "![build](https://img.shields.io/badge/build-passing-green)",
        "",
        "> [!WARNING]",
        "> Experimental preview, expect breakage.",
        "",
        "```bash",
        "npx enrich-app init",
        "```",
        "",
        "Enrich App is a billing service that syncs invoices between Stripe and the ledger.",
        "",
        "## Install",
        "Run npm install.",
      ].join("\n")
    );
    await writeFile(
      path.join(root, ".env.example"),
      ["# config", "STRIPE_SECRET_KEY=", "export DATABASE_URL=postgres://localhost", "PORT=3000", "not_a_var"].join("\n")
    );

    await execFileAsync("node", [cliPath, "init", root]);
    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");

    // README first prose paragraph becomes the overview (badge + heading skipped).
    assert.match(claude, /## Overview/);
    assert.match(claude, /billing service that syncs invoices/);
    assert.doesNotMatch(claude, /shields\.io/);

    // Env var NAMES are surfaced; values are not.
    assert.match(claude, /## Required Environment Variables/);
    assert.match(claude, /`STRIPE_SECRET_KEY`/);
    assert.match(claude, /`DATABASE_URL`/);
    assert.match(claude, /`PORT`/);
    assert.doesNotMatch(claude, /postgres:\/\/localhost/);

    // GitHub callout body must not leak into the description.
    assert.doesNotMatch(claude, /Experimental preview/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses a leading blockquote tagline as the description", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ready-tagline-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "tagline-app" }, null, 2));
    await writeFile(
      path.join(root, "README.md"),
      ["# Tagline App 🎙️", "", "> Smart meeting transcription, in real time.", "", "## Setup", "Clone and run."].join("\n")
    );

    await execFileAsync("node", [cliPath, "init", root]);
    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");

    assert.match(claude, /## Overview/);
    assert.match(claude, /Smart meeting transcription, in real time\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init preserves existing files by writing proposed files", async () => {
  const root = await createFixture();
  try {
    await writeFile(path.join(root, "CLAUDE.md"), "# Existing\n");
    await execFileAsync("node", [cliPath, "init", root]);
    const original = await readFile(path.join(root, "CLAUDE.md"), "utf8");
    const proposed = await readFile(path.join(root, "CLAUDE.md.agent-ready-proposed"), "utf8");

    assert.equal(original, "# Existing\n");
    assert.match(proposed, /AI Agent Guide/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
