import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  await writeFile(path.join(root, "next.config.ts"), "export default {};\n");
  await writeFile(path.join(root, "page.tsx"), "export default function Page() { return <main dir=\"rtl\">שלום</main>; }\n");
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
    const nextSkill = await readFile(path.join(root, ".agent-ready", "skills", "nextjs-hydration", "SKILL.md"), "utf8");
    const supabaseSkill = await readFile(path.join(root, ".agent-ready", "skills", "supabase-debugging", "SKILL.md"), "utf8");
    const rtlSkill = await readFile(path.join(root, ".agent-ready", "skills", "rtl-ui", "SKILL.md"), "utf8");

    assert.match(claude, /Next\.js detected/);
    assert.match(codemap, /fixture-next-supabase/);
    assert.match(nextSkill, /hydration/i);
    assert.match(supabaseSkill, /Supabase/);
    assert.match(rtlSkill, /RTL/);
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
