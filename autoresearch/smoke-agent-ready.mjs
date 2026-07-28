#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// always compare against the version this checkout declares, so the smoke
// harness cannot go stale when the package version bumps
const expectedVersion = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
).version;
const checks = [];

async function main() {
  await check("npm latest is expected release", async () => {
    const { stdout } = await run(bin("npm"), ["view", "@netanelyasi/agent-ready", "version", "--json"]);
    assert.equal(JSON.parse(stdout), expectedVersion);
  });

  const root = await createNextFixture("agent-ready-smoke-next-");
  try {
    await check("analyze detects Next stack and nonzero entry points", async () => {
      const { stdout } = await runAgentReady("analyze", root);
      assert.match(stdout, /Next\.js/);
      assert.match(stdout, /React/);
      assert.match(stdout, /Supabase/);
      assert.doesNotMatch(stdout, /Entry points: 0/);
    });

    await check("dry-run verbose exposes valid Claude settings and skill paths", async () => {
      const { stdout } = await runAgentReady("init", root, "--dry-run", "--verbose");
      assert.match(stdout, /would create: \.claude\/settings\.json/);
      assert.match(stdout, /Write\(dist\/\*\*\)/);
      assert.match(stdout, /Edit\(dist\/\*\*\)/);
      assert.match(stdout, /MultiEdit\(dist\/\*\*\)/);
      assert.doesNotMatch(stdout, /"agentReady"/);
      assert.match(stdout, /\.claude\/skills\/nextjs-hydration\/SKILL\.md/);
      assert.doesNotMatch(stdout, /\.agent-ready\/skills\//);
    });

    await check("init writes loadable skills and App Router codemap entries", async () => {
      await runAgentReady("init", root);
      const codemap = await readFile(path.join(root, "CODEMAP.md"), "utf8");
      const settings = JSON.parse(await readFile(path.join(root, ".claude", "settings.json"), "utf8"));
      const nextSkill = await readFile(path.join(root, ".claude", "skills", "nextjs-hydration", "SKILL.md"), "utf8");

      assert.match(codemap, /src\/app\/layout\.tsx/);
      assert.match(codemap, /src\/app\/\(dashboard\)\/page\.tsx/);
      assert.match(codemap, /middleware\.ts/);
      assert.match(codemap, /next\.config\.ts/);
      assert.equal(Object.hasOwn(settings, "agentReady"), false);
      assert.ok(settings.permissions.deny.every((rule) => /^(Write|Edit|MultiEdit)\(.+\)$/.test(rule)));
      assert.ok(settings.permissions.deny.includes("Write(dist/**)"));
      assert.match(nextSkill, /hydration/i);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const existingHarnessRoot = await createNextFixture("agent-ready-smoke-existing-");
  try {
    await writeFile(path.join(existingHarnessRoot, "CLAUDE.md"), "# Existing maintainer guide\n");
    await check("init preserves existing CLAUDE.md and writes proposed merge file", async () => {
      await runAgentReady("init", existingHarnessRoot);
      const original = await readFile(path.join(existingHarnessRoot, "CLAUDE.md"), "utf8");
      const proposed = await readFile(path.join(existingHarnessRoot, "CLAUDE.md.agent-ready-proposed"), "utf8");
      assert.equal(original, "# Existing maintainer guide\n");
      assert.match(proposed, /AI Agent Guide/);
    });
  } finally {
    await rm(existingHarnessRoot, { recursive: true, force: true });
  }

  const passed = checks.filter((check) => check.status === "pass").length;
  const total = checks.length;
  const passRate = total ? (passed / total) * 100 : 0;
  for (const item of checks) console.log(`${item.status.toUpperCase()} ${item.name}${item.error ? ` :: ${item.error}` : ""}`);
  console.log(`METRIC smoke_pass_rate=${passRate.toFixed(2)} passed=${passed} total=${total}`);
  if (passed !== total) process.exit(1);
}

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: "pass" });
  } catch (error) {
    checks.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) });
  }
}

async function runAgentReady(command, root, ...args) {
  return run(bin("npx"), ["--yes", "@netanelyasi/agent-ready@latest", command, root, ...args], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    shell: process.platform === "win32",
    ...options,
  });
}

function bin(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

async function createNextFixture(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(root, "src", "app", "(dashboard)"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: prefix.replace(/-$/, ""),
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
  await writeFile(path.join(root, "middleware.ts"), "export function middleware() {}\n");
  await writeFile(path.join(root, "src", "utils.ts"), "export function title() { return 'שלום'; }\n");
  await writeFile(path.join(root, "src", "app", "layout.tsx"), "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n");
  await writeFile(path.join(root, "src", "app", "(dashboard)", "page.tsx"), "import { title } from '../../utils.js';\nexport default function Page() { return <main dir=\"rtl\">{title()}</main>; }\n");
  return root;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  console.log("METRIC smoke_pass_rate=0.00 passed=0 total=1");
  process.exit(1);
});
