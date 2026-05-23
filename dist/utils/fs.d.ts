export declare const DEFAULT_IGNORES: Set<string>;
export declare function pathExists(filePath: string): Promise<boolean>;
export declare function readJson<T = unknown>(filePath: string): Promise<T | undefined>;
export declare function readText(filePath: string): Promise<string | undefined>;
export declare function safeWriteFile(filePath: string, content: string, force: boolean): Promise<"created" | "overwritten" | "proposed">;
export declare function listDirSafe(dir: string): Promise<string[]>;
export declare function walkFiles(root: string, options?: {
    maxDepth?: number;
    maxFiles?: number;
    includeHidden?: boolean;
}): Promise<string[]>;
export declare function rel(root: string, target: string): string;
