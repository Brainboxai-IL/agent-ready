export type CommandName = "dev" | "build" | "test" | "lint" | "typecheck" | "format";
export interface PackageInfo {
    path: string;
    name?: string;
    description?: string;
    packageManager?: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    workspaces?: string[];
}
export interface ProjectScan {
    root: string;
    name: string;
    description?: string;
    envVars: string[];
    packages: PackageInfo[];
    packageManager?: string;
    languages: string[];
    frameworks: string[];
    databases: string[];
    deployment: string[];
    monorepo: {
        detected: boolean;
        tools: string[];
        workspaceGlobs: string[];
    };
    commands: Partial<Record<CommandName, string[]>>;
    importantDirs: DirectorySummary[];
    noisyPaths: string[];
    existingHarness: ExistingHarness;
    codeGraph: CodeGraph;
    traits: {
        hasHebrewOrRtl: boolean;
        hasDocker: boolean;
        hasGithubActions: boolean;
        hasTests: boolean;
        hasTypeScript: boolean;
    };
}
export interface DirectorySummary {
    path: string;
    reason: string;
    children: string[];
}
export interface ExistingHarness {
    claudeMd: HarnessFileState;
    codemap: HarnessFileState;
    aiIgnore: HarnessFileState;
    claudeSettings: HarnessFileState;
    skillsDir: boolean;
}
export interface HarnessFileState {
    exists: boolean;
    generatedByAgentReady: boolean;
    countsAsMaintainerAuthored: boolean;
}
export interface CodeGraph {
    entryPoints: EntryPoint[];
    importEdges: ImportEdge[];
    centralFiles: CentralFile[];
    externalImports: ExternalImport[];
    unresolvedRelativeImports: ImportEdge[];
}
export interface EntryPoint {
    path: string;
    kind: string;
    reason: string;
}
export interface ImportEdge {
    from: string;
    to: string;
    specifier: string;
    resolved: boolean;
}
export interface CentralFile {
    path: string;
    inbound: number;
    outbound: number;
}
export interface ExternalImport {
    packageName: string;
    importedBy: string[];
}
export interface GeneratedFile {
    path: string;
    content: string;
    kind: "create" | "propose" | "overwrite";
}
export interface InitOptions {
    dryRun: boolean;
    force: boolean;
    verbose: boolean;
}
export interface ReadinessScore {
    score: number;
    strengths: string[];
    missing: string[];
    warnings: string[];
}
