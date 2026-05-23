export type CommandName = "dev" | "build" | "test" | "lint" | "typecheck" | "format";

export interface PackageInfo {
  path: string;
  name?: string;
  packageManager?: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  workspaces?: string[];
}

export interface ProjectScan {
  root: string;
  name: string;
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
  claudeMd: boolean;
  codemap: boolean;
  aiIgnore: boolean;
  claudeSettings: boolean;
  skillsDir: boolean;
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
