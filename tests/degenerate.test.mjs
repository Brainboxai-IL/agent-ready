import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("dist/cli.js");

async function emptyDir(prefix = "agent-ready-degenerate-") {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function collectFiles(root) {
  const out = new Map();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return out;
}

test("analyze and init survive a completely empty directory", async () => {
  const root = await emptyDir();
  try {
    const analyze = await execFileAsync("node", [cliPath, "analyze", root]);
    assert.match(analyze.stdout, /\/100/);
    await execFileAsync("node", [cliPath, "init", root]);
    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
    assert.match(claude, /AI Agent Guide/);
    const settings = JSON.parse(await readFile(path.join(root, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.hooks);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init survives a README-only repository and extracts nothing dangerous", async () => {
  const root = await emptyDir();
  try {
    await writeFile(path.join(root, "README.md"), "# Only Docs\n\nJust a readme, no code.\n");
    await execFileAsync("node", [cliPath, "init", root]);
    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
    assert.match(claude, /Just a readme, no code\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed manifests do not crash the scan", async () => {
  const root = await emptyDir();
  try {
    await writeFile(path.join(root, "package.json"), "{ this is not json ");
    await writeFile(path.join(root, "pyproject.toml"), "[project\nname = broken");
    await writeFile(path.join(root, "Cargo.toml"), "[[bin]\nname=");
    await writeFile(path.join(root, "main.py"), "print('ok')\n");
    const { stdout } = await execFileAsync("node", [cliPath, "init", root]);
    assert.match(stdout, /Generating \d+ files/);
    await readFile(path.join(root, "CLAUDE.md"), "utf8");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("binary and huge files do not break the code graph", async () => {
  const root = await emptyDir();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "bin-fixture" }));
    await writeFile(path.join(root, "blob.js"), Buffer.from([0, 159, 146, 150, 255, 0, 13, 10]));
    await writeFile(path.join(root, "big.js"), `const x = "${"a".repeat(4_000_000)}";\n`);
    await writeFile(path.join(root, "src.js"), "import './other.js';\n");
    await writeFile(path.join(root, "other.js"), "export {};\n");
    const { stdout } = await execFileAsync("node", [cliPath, "analyze", root]);
    assert.match(stdout, /bin-fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated init --force reaches a byte-for-byte stable state", async () => {
  const root = await emptyDir("agent-ready-idempotent-");
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "idempotent-fixture", scripts: { test: "node --test" } })
    );
    await writeFile(path.join(root, "index.js"), "console.log('hi');\n");
    // run 1 creates the harness; run 2 re-describes the repo now that the
    // harness exists (report/score legitimately change); run 3 must match run 2
    await execFileAsync("node", [cliPath, "init", root]);
    await execFileAsync("node", [cliPath, "init", root, "--force"]);
    const second = await collectFiles(root);
    await execFileAsync("node", [cliPath, "init", root, "--force"]);
    const third = await collectFiles(root);
    assert.deepEqual([...third.keys()].sort(), [...second.keys()].sort());
    for (const [name, content] of second) {
      assert.equal(third.get(name), content, `content drifted between runs: ${name}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init without --force proposes instead of overwriting existing files", async () => {
  const root = await emptyDir();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "propose-fixture" }));
    await writeFile(path.join(root, "CLAUDE.md"), "# Hand-written guide\n");
    await execFileAsync("node", [cliPath, "init", root]);
    assert.equal(await readFile(path.join(root, "CLAUDE.md"), "utf8"), "# Hand-written guide\n");
    await stat(path.join(root, "CLAUDE.md.agent-ready-proposed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
