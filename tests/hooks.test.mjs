import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("dist/cli.js");

const HOOKS = ["prevent-destructive.mjs", "protect-generated.mjs", "suggest-validation.mjs"];

async function initFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-ready-hooks-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "hooks-fixture", scripts: { test: "node --test", build: "tsc" } })
  );
  await writeFile(path.join(root, "index.js"), "console.log('hi');\n");
  await execFileAsync("node", [cliPath, "init", root]);
  return root;
}

function runHook(hookPath, inputObject) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [hookPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(inputObject));
  });
}

test("every generated hook is syntactically valid JavaScript", async () => {
  const root = await initFixture();
  try {
    for (const hook of HOOKS) {
      const hookPath = path.join(root, ".claude", "hooks", hook);
      await assert.doesNotReject(
        execFileAsync("node", ["--check", hookPath]),
        `node --check failed for ${hook}`
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prevent-destructive denies dangerous commands and allows benign ones", async () => {
  const root = await initFixture();
  try {
    const hookPath = path.join(root, ".claude", "hooks", "prevent-destructive.mjs");
    const denied = [
      "rm -rf ./src",
      "git reset --hard HEAD~3",
      "git clean -fd",
      "git push origin main --force",
    ];
    for (const command of denied) {
      const result = await runHook(hookPath, { tool_input: { command } });
      assert.equal(result.code, 0, `hook crashed on: ${command}\n${result.stderr}`);
      assert.match(result.stdout, /"permissionDecision":\s*"deny"/, `expected deny for: ${command}`);
    }
    const allowed = ["ls -la", "git push origin main", "npm test", "rm notes.txt"];
    for (const command of allowed) {
      const result = await runHook(hookPath, { tool_input: { command } });
      assert.equal(result.code, 0, `hook crashed on: ${command}\n${result.stderr}`);
      assert.equal(result.stdout.trim(), "", `expected silence (allow) for: ${command}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protect-generated denies noisy paths on both path styles and allows source", async () => {
  const root = await initFixture();
  try {
    const hookPath = path.join(root, ".claude", "hooks", "protect-generated.mjs");
    const denied = ["dist/app.js", "packages\\web\\node_modules\\x.js", "src/api.generated.ts"];
    for (const file_path of denied) {
      const result = await runHook(hookPath, { tool_input: { file_path } });
      assert.equal(result.code, 0, `hook crashed on: ${file_path}\n${result.stderr}`);
      assert.match(result.stdout, /"permissionDecision":\s*"deny"/, `expected deny for: ${file_path}`);
    }
    const allowed = ["src/app.ts", "README.md"];
    for (const file_path of allowed) {
      const result = await runHook(hookPath, { tool_input: { file_path } });
      assert.equal(result.stdout.trim(), "", `expected silence (allow) for: ${file_path}`);
    }
    const noPath = await runHook(hookPath, { tool_input: {} });
    assert.equal(noPath.code, 0);
    assert.equal(noPath.stdout.trim(), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("suggest-validation emits a systemMessage with detected commands", async () => {
  const root = await initFixture();
  try {
    const hookPath = path.join(root, ".claude", "hooks", "suggest-validation.mjs");
    const result = await runHook(hookPath, { tool_input: { file_path: "index.js" } });
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.systemMessage, "string");
    assert.match(parsed.systemMessage, /npm (test|run build)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hooks survive empty and malformed stdin without crashing", async () => {
  const root = await initFixture();
  try {
    for (const hook of HOOKS) {
      const hookPath = path.join(root, ".claude", "hooks", hook);
      const empty = await new Promise((resolve, reject) => {
        const child = spawn("node", [hookPath], { stdio: ["pipe", "pipe", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stderr }));
        child.stdin.end("");
      });
      assert.equal(empty.code, 0, `${hook} crashed on empty stdin:\n${empty.stderr}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("settings.json is valid and wires exactly the generated hook files", async () => {
  const root = await initFixture();
  try {
    const settings = JSON.parse(await readFile(path.join(root, ".claude", "settings.json"), "utf8"));
    const wired = [];
    for (const group of Object.values(settings.hooks)) {
      for (const entry of group) {
        for (const hook of entry.hooks) {
          assert.equal(hook.type, "command");
          assert.equal(hook.command, "node");
          wired.push(path.basename(hook.args[0]));
        }
      }
    }
    assert.deepEqual(new Set(wired), new Set(HOOKS));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
