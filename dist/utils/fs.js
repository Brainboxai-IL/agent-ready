import { promises as fs } from "node:fs";
import path from "node:path";
export const DEFAULT_IGNORES = new Set([
    ".git",
    "node_modules",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".agent-ready",
    ".claude",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    "vendor",
    "target",
    "bin",
    "obj",
]);
export async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
export async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    catch {
        return undefined;
    }
}
export async function readText(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    }
    catch {
        return undefined;
    }
}
export async function safeWriteFile(filePath, content, force) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (force || !(await pathExists(filePath))) {
        const existed = await pathExists(filePath);
        await fs.writeFile(filePath, content, "utf8");
        return existed ? "overwritten" : "created";
    }
    const proposedPath = `${filePath}.agent-ready-proposed`;
    await fs.writeFile(proposedPath, content, "utf8");
    return "proposed";
}
export async function listDirSafe(dir) {
    try {
        return await fs.readdir(dir);
    }
    catch {
        return [];
    }
}
export async function walkFiles(root, options) {
    const maxDepth = options?.maxDepth ?? 5;
    const maxFiles = options?.maxFiles ?? 3000;
    const includeHidden = options?.includeHidden ?? true;
    const out = [];
    async function walk(current, depth) {
        if (out.length >= maxFiles || depth > maxDepth)
            return;
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= maxFiles)
                return;
            if (!includeHidden && entry.name.startsWith("."))
                continue;
            if (entry.isDirectory() && DEFAULT_IGNORES.has(entry.name))
                continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory())
                await walk(full, depth + 1);
            else if (entry.isFile())
                out.push(full);
        }
    }
    await walk(root, 0);
    return out;
}
export function rel(root, target) {
    const relative = path.relative(root, target).replaceAll(path.sep, "/");
    return relative || ".";
}
