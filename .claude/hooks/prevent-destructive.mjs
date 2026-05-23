#!/usr/bin/env node
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input.tool_input?.command ?? "");

const blockedPatterns = [
  { pattern: /(^|[;&|]\s*)rm\s+-[^\n;]*r[^\n;]*f[^\n;]*(\/|~|\.|\*)?(\s|$)/i, reason: "Blocks rm -rf style destructive deletion." },
  { pattern: /git\s+reset\s+--hard/i, reason: "Blocks git reset --hard." },
  { pattern: /git\s+clean\s+-[^\n;]*f/i, reason: "Blocks git clean -f." },
  { pattern: /git\s+push\s+([^\n;]*\s)?--force/i, reason: "Blocks force-push." },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: "Blocks fork bomb pattern." },
];

const match = blockedPatterns.find((item) => item.pattern.test(command));
if (!match) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `agent-ready safety hook denied command. ${match.reason} Ask the user for explicit approval and use a narrower command.`,
  },
}));
