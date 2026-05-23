#!/usr/bin/env node
import path from "node:path";
import { scoreReadiness } from "./analyzers/scoreReadiness.js";
import { generateFiles } from "./generators/generate.js";
import { scanProject } from "./scanner/scanProject.js";
import { safeWriteFile } from "./utils/fs.js";
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === "help") {
        printHelp();
        return;
    }
    const root = path.resolve(args.target);
    const scan = await scanProject(root);
    const score = scoreReadiness(scan);
    printSummary(scan, score);
    if (args.command === "analyze")
        return;
    const files = generateFiles(scan, score, args.force);
    console.log(`\nGenerating ${files.length} files${args.dryRun ? " (dry-run)" : ""}:`);
    for (const file of files) {
        const relative = path.relative(root, file.path).replaceAll(path.sep, "/");
        if (args.dryRun) {
            console.log(`- would write ${relative}`);
            continue;
        }
        const result = await safeWriteFile(file.path, file.content, args.force);
        const target = result === "proposed" ? `${relative}.agent-ready-proposed` : relative;
        console.log(`- ${result}: ${target}`);
    }
    console.log("\nDone. Start with CODEMAP.md and .agent-ready/report.md.");
}
function parseArgs(argv) {
    const command = argv[0] === "init" || argv[0] === "analyze" ? argv[0] : argv[0] ? "help" : "help";
    const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
    const target = argv.find((arg, index) => index > 0 && !arg.startsWith("--")) ?? ".";
    return {
        command,
        target,
        dryRun: flags.has("--dry-run"),
        force: flags.has("--force"),
        verbose: flags.has("--verbose"),
    };
}
function printSummary(scan, score) {
    console.log(`Agent Ready: ${scan.name}`);
    console.log(`Root: ${scan.root}`);
    console.log(`Score: ${score.score}/100`);
    console.log(`Languages: ${scan.languages.join(", ") || "none detected"}`);
    console.log(`Frameworks: ${scan.frameworks.join(", ") || "none detected"}`);
    console.log(`Databases/tools: ${scan.databases.join(", ") || "none detected"}`);
    console.log(`Deployment: ${scan.deployment.join(", ") || "none detected"}`);
    console.log(`Monorepo: ${scan.monorepo.detected ? `yes (${scan.monorepo.tools.join(", ") || "multiple packages"})` : "no/unclear"}`);
    if (score.missing.length) {
        console.log("\nMissing:");
        for (const item of score.missing)
            console.log(`- ${item}`);
    }
    if (score.warnings.length) {
        console.log("\nWarnings:");
        for (const item of score.warnings)
            console.log(`- ${item}`);
    }
}
function printHelp() {
    console.log(`agent-ready\n\nUsage:\n  agent-ready analyze [path]\n  agent-ready init [path] [--dry-run] [--force]\n\nCommands:\n  analyze   Scan project and print readiness summary\n  init      Generate CLAUDE.md, CODEMAP.md, .aiignore, settings, skills, and reports\n\nOptions:\n  --dry-run   Show files that would be written\n  --force     Overwrite existing files instead of writing *.agent-ready-proposed\n`);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
