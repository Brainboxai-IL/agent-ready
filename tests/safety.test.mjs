import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("dist/cli.js");

async function fixtureDir() {
  return mkdtemp(path.join(tmpdir(), "agent-ready-safety-"));
}

test("init on a nonexistent target fails instead of creating a directory", async () => {
  const root = await fixtureDir();
  try {
    const typo = path.join(root, "does-not-exist");
    await assert.rejects(
      execFileAsync("node", [cliPath, "init", typo]),
      /does not exist/i
    );
    assert.equal(existsSync(typo), false, "the typo'd directory must not be created");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a file passed as target fails with a clear error", async () => {
  const root = await fixtureDir();
  try {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "hello\n");
    await assert.rejects(execFileAsync("node", [cliPath, "analyze", file]), /not a directory/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown flags fail loudly instead of silently doing a real run", async () => {
  const root = await fixtureDir();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "flags-fixture" }));
    await assert.rejects(
      execFileAsync("node", [cliPath, "init", root, "--dryrun"]),
      /unknown flag/i
    );
    assert.equal(existsSync(path.join(root, "CLAUDE.md")), false, "no files may be written on a rejected flag");
    await assert.rejects(execFileAsync("node", [cliPath, "init", "-v", root]), /unknown flag/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stray second package.json does not make a monorepo or receive a CLAUDE.md", async () => {
  const root = await fixtureDir();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "main-app" }));
    await mkdir(path.join(root, "examples", "demo"), { recursive: true });
    await writeFile(
      path.join(root, "examples", "demo", "package.json"),
      JSON.stringify({ name: "demo-example" })
    );
    const { stdout } = await execFileAsync("node", [cliPath, "init", root]);
    assert.match(stdout, /Monorepo: no/);
    assert.equal(
      existsSync(path.join(root, "examples", "demo", "CLAUDE.md")),
      false,
      "example dirs must not receive a workspace CLAUDE.md"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declared workspaces still get per-package CLAUDE.md, and only they do", async () => {
  const root = await fixtureDir();
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "real-monorepo", workspaces: ["packages/*"] })
    );
    await mkdir(path.join(root, "packages", "web"), { recursive: true });
    await writeFile(
      path.join(root, "packages", "web", "package.json"),
      JSON.stringify({ name: "@mono/web", scripts: { test: "vitest" } })
    );
    await mkdir(path.join(root, "fixtures", "sample"), { recursive: true });
    await writeFile(
      path.join(root, "fixtures", "sample", "package.json"),
      JSON.stringify({ name: "sample-fixture" })
    );
    const { stdout } = await execFileAsync("node", [cliPath, "init", root]);
    assert.match(stdout, /Monorepo: yes/);
    assert.equal(existsSync(path.join(root, "packages", "web", "CLAUDE.md")), true);
    assert.equal(
      existsSync(path.join(root, "fixtures", "sample", "CLAUDE.md")),
      false,
      "packages outside declared workspace globs must not receive a CLAUDE.md"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
