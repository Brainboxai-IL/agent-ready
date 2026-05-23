#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const rawPath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
if (!rawPath) process.exit(0);

const normalized = String(rawPath).replaceAll("\\", "/");
const parts = normalized.split("/").filter(Boolean);
const deniedDirs = new Set(["node_modules", ".next", ".nuxt", "dist", "build", "coverage", ".turbo", "vendor", "target", "generated"]);
const generatedFile = /(^|\/)generated(\/|$)|\.generated\.[^/]+$/i.test(normalized);
const noisyDir = parts.some((part) => deniedDirs.has(part));

if (!generatedFile && !noisyDir) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `agent-ready safety hook denied editing generated/noisy path: ${path.basename(normalized)}. If this is intentional, ask the user to approve and edit settings.`,
  },
}));
