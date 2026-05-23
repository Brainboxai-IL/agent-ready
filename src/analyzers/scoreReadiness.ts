import type { ProjectScan, ReadinessScore } from "../types.js";

export function scoreReadiness(scan: ProjectScan): ReadinessScore {
  let score = 0;
  const strengths: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  add(scan.existingHarness.claudeMd, 18, "Root CLAUDE.md exists", "No root CLAUDE.md");
  add(scan.existingHarness.codemap, 12, "CODEMAP.md exists", "No CODEMAP.md / codebase map");
  add(scan.existingHarness.aiIgnore, 10, ".aiignore exists", "No .aiignore");
  add(scan.existingHarness.claudeSettings, 10, ".claude/settings.json exists", "No versioned Claude settings/permissions");
  add(Boolean(scan.commands.build?.length), 10, "Build command detected", "No build command detected");
  add(Boolean(scan.commands.test?.length || scan.commands.lint?.length || scan.commands.typecheck?.length), 12, "Validation commands detected", "No test/lint/typecheck command detected");
  add(scan.importantDirs.length > 0, 8, "Important directories mapped", "Directory map is thin");
  add(scan.existingHarness.skillsDir, 10, "Skills directory exists", "No reusable skills directory");
  add(scan.monorepo.detected ? scan.packages.length > 1 : true, 5, "Workspace/package layout detected", "Monorepo detected but packages are unclear");
  add(scan.languages.length > 0, 5, `Languages detected: ${scan.languages.join(", ")}`, "Could not detect languages");

  if (scan.monorepo.detected && !scan.existingHarness.claudeMd) warnings.push("Monorepo without CLAUDE.md: agents will waste context discovering structure.");
  if (scan.noisyPaths.length > 0 && !scan.existingHarness.aiIgnore) warnings.push(`Noisy paths detected (${scan.noisyPaths.join(", ")}) but no .aiignore exists.`);
  if (scan.traits.hasHebrewOrRtl) strengths.push("Hebrew/RTL trait detected; RTL UI skill will be generated.");
  if (scan.databases.length > 0) strengths.push(`Database tooling detected: ${scan.databases.join(", ")}.`);

  return { score: Math.min(score, 100), strengths, missing, warnings };

  function add(condition: boolean, points: number, yes: string, no: string) {
    if (condition) {
      score += points;
      strengths.push(yes);
    } else {
      missing.push(no);
    }
  }
}
