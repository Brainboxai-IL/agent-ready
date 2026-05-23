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

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = unknown>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export async function safeWriteFile(filePath: string, content: string, force: boolean): Promise<"created" | "overwritten" | "proposed"> {
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

export async function listDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function walkFiles(root: string, options?: { maxDepth?: number; maxFiles?: number; includeHidden?: boolean }): Promise<string[]> {
  const maxDepth = options?.maxDepth ?? 5;
  const maxFiles = options?.maxFiles ?? 3000;
  const includeHidden = options?.includeHidden ?? true;
  const out: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (!includeHidden && entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && DEFAULT_IGNORES.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) out.push(full);
    }
  }

  await walk(root, 0);
  return out;
}

export function rel(root: string, target: string): string {
  const relative = path.relative(root, target).replaceAll(path.sep, "/");
  return relative || ".";
}
