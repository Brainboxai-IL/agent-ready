#!/usr/bin/env node
import { readFileSync } from "node:fs";

readFileSync(0, "utf8");
console.log(JSON.stringify({
  systemMessage: "Suggested validation after edits: `npm run lint`, `npm run check`, `npm run test`. Run the narrowest relevant command before completion.",
}));
