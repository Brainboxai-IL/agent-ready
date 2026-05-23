import { promises as fs } from "node:fs";
import path from "node:path";
import type { CodeGraph, CommandName, DirectorySummary, EntryPoint, ImportEdge, PackageInfo, ProjectScan } from "../types.js";
import { DEFAULT_IGNORES, listDirSafe, pathExists, readJson, readText, rel, walkFiles } from "../utils/fs.js";

interface PackageJson {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const LANGUAGE_EXTS: Record<string, string[]> = {
  TypeScript: [".ts", ".tsx"],
  JavaScript: [".js", ".jsx", ".mjs", ".cjs"],
  Python: [".py"],
  PHP: [".php"],
  Java: [".java"],
  "C#": [".cs"],
  Go: [".go"],
  Rust: [".rs"],
  "C/C++": [".c", ".cc", ".cpp", ".h", ".hpp"],
};

export async function scanProject(rootInput: string): Promise<ProjectScan> {
  const root = path.resolve(rootInput);
  const files = await walkFiles(root, { maxDepth: 6, maxFiles: 5000 });
  const relativeFiles = files.map((file) => rel(root, file));
  const packages = await detectPackages(root, files);
  const rootPackage = packages.find((pkg) => pkg.path === "package.json");
  const allDeps = mergeDeps(packages);

  const frameworks = detectFrameworks(relativeFiles, allDeps);
  const databases = detectDatabases(relativeFiles, allDeps);
  const deployment = await detectDeployment(root, relativeFiles, allDeps);
  const monorepo = detectMonorepo(relativeFiles, packages, rootPackage);
  const packageManager = detectPackageManager(root, rootPackage, relativeFiles);
  const commands = detectCommands(packages, packageManager);
  const languages = detectLanguages(files);
  const importantDirs = await summarizeImportantDirs(root, relativeFiles, monorepo.detected);
  const noisyPaths = detectNoisyPaths(relativeFiles);
  const existingHarness = {
    claudeMd: await harnessFileState(root, "CLAUDE.md"),
    codemap: await harnessFileState(root, "CODEMAP.md"),
    aiIgnore: await harnessFileState(root, ".aiignore"),
    claudeSettings: await harnessFileState(root, path.join(".claude", "settings.json")),
    skillsDir: await pathExists(path.join(root, ".agent-ready", "skills")) || await pathExists(path.join(root, ".claude", "skills")),
  };
  const codeGraph = await analyzeCodeGraph(root, files, packages);

  return {
    root,
    name: rootPackage?.name ?? path.basename(root),
    packages,
    packageManager,
    languages,
    frameworks,
    databases,
    deployment,
    monorepo,
    commands,
    importantDirs,
    noisyPaths,
    existingHarness,
    codeGraph,
    traits: {
      hasHebrewOrRtl: await detectHebrewOrRtl(files),
      hasDocker: relativeFiles.some((file) => /(^|\/)Dockerfile$|docker-compose\.ya?ml$/.test(file)),
      hasGithubActions: relativeFiles.some((file) => file.startsWith(".github/workflows/")),
      hasTests: hasCommand(commands, "test") || relativeFiles.some((file) => /(__tests__|\.test\.|\.spec\.)/.test(file)),
      hasTypeScript: languages.includes("TypeScript"),
    },
  };
}

async function detectPackages(root: string, files: string[]): Promise<PackageInfo[]> {
  const packageFiles = files.filter((file) => path.basename(file) === "package.json" && !file.includes(`${path.sep}node_modules${path.sep}`));
  const packages: PackageInfo[] = [];

  for (const file of packageFiles) {
    const json = await readJson<PackageJson>(file);
    if (!json) continue;
    const workspaces = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages;
    packages.push({
      path: rel(root, file),
      name: json.name,
      packageManager: json.packageManager,
      scripts: json.scripts ?? {},
      dependencies: json.dependencies ?? {},
      devDependencies: json.devDependencies ?? {},
      workspaces,
    });
  }

  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

function mergeDeps(packages: PackageInfo[]): Record<string, string> {
  return Object.assign({}, ...packages.map((pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies })));
}

function detectPackageManager(root: string, rootPackage: PackageInfo | undefined, files: string[]): string | undefined {
  if (rootPackage?.packageManager) return rootPackage.packageManager.split("@")[0];
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("package-lock.json")) return "npm";
  return undefined;
}

function detectFrameworks(files: string[], deps: Record<string, string>): string[] {
  const found = new Set<string>();
  if (deps.next || files.includes("next.config.js") || files.includes("next.config.ts")) found.add("Next.js");
  if (deps.react || deps["react-dom"]) found.add("React");
  if (deps.vue || deps.nuxt) found.add(deps.nuxt ? "Nuxt" : "Vue");
  if (deps.svelte || deps["@sveltejs/kit"]) found.add(deps["@sveltejs/kit"] ? "SvelteKit" : "Svelte");
  if (deps.vite || files.some((file) => file.startsWith("vite.config."))) found.add("Vite");
  if (deps.express) found.add("Express");
  if (deps["@nestjs/core"]) found.add("NestJS");
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) found.add("Python");
  if (files.includes("manage.py")) found.add("Django");
  if (files.includes("artisan") || files.includes("composer.json")) found.add("PHP/Laravel or Composer");
  if (files.some((file) => file.endsWith(".csproj") || file.endsWith(".sln"))) found.add(".NET");
  if (files.includes("go.mod")) found.add("Go Module");
  if (files.includes("Cargo.toml")) found.add("Rust/Cargo");
  return [...found];
}

function detectDatabases(files: string[], deps: Record<string, string>): string[] {
  const found = new Set<string>();
  if (deps["@supabase/supabase-js"] || files.some((file) => file.startsWith("supabase/"))) found.add("Supabase");
  if (deps.prisma || files.some((file) => file.startsWith("prisma/"))) found.add("Prisma");
  if (deps["drizzle-orm"] || files.some((file) => file.includes("drizzle"))) found.add("Drizzle");
  if (deps.pg || deps.postgres) found.add("PostgreSQL");
  if (deps.mysql2 || deps.mysql) found.add("MySQL");
  if (deps.mongoose || deps.mongodb) found.add("MongoDB");
  return [...found];
}

async function detectDeployment(root: string, files: string[], deps: Record<string, string>): Promise<string[]> {
  const found = new Set<string>();
  if (files.includes("vercel.json") || deps.vercel) found.add("Vercel");
  if (files.some((file) => /(^|\/)Dockerfile$|docker-compose\.ya?ml$/.test(file))) found.add("Docker");
  if (files.some((file) => file.startsWith(".github/workflows/"))) found.add("GitHub Actions");
  if (await pathExists(path.join(root, "netlify.toml"))) found.add("Netlify");
  if (files.includes("wrangler.toml")) found.add("Cloudflare Workers");
  return [...found];
}

function detectMonorepo(files: string[], packages: PackageInfo[], rootPackage?: PackageInfo): ProjectScan["monorepo"] {
  const tools = new Set<string>();
  if (files.includes("turbo.json")) tools.add("Turborepo");
  if (files.includes("nx.json")) tools.add("Nx");
  if (files.includes("pnpm-workspace.yaml")) tools.add("pnpm workspaces");
  if (rootPackage?.workspaces?.length) tools.add("package workspaces");
  const workspaceGlobs = rootPackage?.workspaces ?? (files.includes("pnpm-workspace.yaml") ? ["apps/*", "packages/*", "services/*"] : []);
  return { detected: tools.size > 0 || packages.length > 1, tools: [...tools], workspaceGlobs };
}

function detectCommands(packages: PackageInfo[], projectPackageManager?: string): Partial<Record<CommandName, string[]>> {
  const map: Partial<Record<CommandName, string[]>> = {};
  const names: CommandName[] = ["dev", "build", "test", "lint", "typecheck", "format"];

  for (const pkg of packages) {
    const dir = path.posix.dirname(pkg.path) === "." ? "." : path.posix.dirname(pkg.path);
    const pm = pkg.packageManager?.split("@")[0] ?? projectPackageManager ?? "npm";
    for (const name of names) {
      const scriptName = scriptForCommand(pkg.scripts, name);
      if (!scriptName) continue;
      const prefix = dir === "." ? "" : `cd ${dir} && `;
      const command = `${prefix}${pm} run ${scriptName}`;
      map[name] = [...(map[name] ?? []), command];
    }
  }

  return map;
}

function scriptForCommand(scripts: Record<string, string>, name: CommandName): string | undefined {
  const candidates: Record<CommandName, string[]> = {
    dev: ["dev", "start:dev", "serve"],
    build: ["build", "compile"],
    test: ["test", "test:unit", "unit"],
    lint: ["lint", "eslint"],
    typecheck: ["typecheck", "type-check", "check", "tsc"],
    format: ["format", "prettier"],
  };
  return findScript(scripts, candidates[name]);
}

function findScript(scripts: Record<string, string>, candidates: string[]): string | undefined {
  return candidates.find((candidate) => scripts[candidate]);
}

function hasCommand(commands: Partial<Record<CommandName, string[]>>, name: CommandName): boolean {
  return Boolean(commands[name]?.length);
}

function detectLanguages(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const ext = path.extname(file);
    for (const [language, exts] of Object.entries(LANGUAGE_EXTS)) {
      if (exts.includes(ext)) counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language]) => language);
}

async function summarizeImportantDirs(root: string, files: string[], isMonorepo: boolean): Promise<DirectorySummary[]> {
  const candidates = ["apps", "packages", "services", "src", "lib", "components", "app", "pages", "api", "server", "client", "prisma", "supabase", "scripts", "docs", ".github"];
  const summaries: DirectorySummary[] = [];

  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    try {
      const stat = await fs.stat(full);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const children = (await listDirSafe(full)).filter((child) => !DEFAULT_IGNORES.has(child)).slice(0, isMonorepo ? 20 : 12);
    summaries.push({ path: candidate, reason: reasonForDir(candidate), children });
  }

  if (!summaries.length) {
    const top = [...new Set(files.map((file) => file.split("/")[0]))].filter((entry) => !entry.includes(".")).slice(0, 12);
    summaries.push({ path: ".", reason: "Project root", children: top });
  }

  return summaries;
}

function reasonForDir(dir: string): string {
  const reasons: Record<string, string> = {
    apps: "Application workspace(s)",
    packages: "Shared package workspace(s)",
    services: "Service workspace(s)",
    src: "Main source code",
    lib: "Shared library code",
    components: "UI components",
    app: "Application routes or app source",
    pages: "Page routes",
    api: "API handlers",
    server: "Backend/server code",
    client: "Frontend/client code",
    prisma: "Prisma schema and migrations",
    supabase: "Supabase config, migrations, or functions",
    scripts: "Automation scripts",
    docs: "Documentation",
    ".github": "GitHub workflows and repository automation",
  };
  return reasons[dir] ?? "Important project directory";
}

async function harnessFileState(root: string, relativePath: string): Promise<ProjectScan["existingHarness"]["claudeMd"]> {
  const fullPath = path.join(root, relativePath);
  const exists = await pathExists(fullPath);
  if (!exists) return { exists: false, generatedByAgentReady: false, countsAsMaintainerAuthored: false };
  const text = await readText(fullPath);
  const generatedByAgentReady = Boolean(text && /generated by `?agent-ready`?|agentReady|Generated by agent-ready/i.test(text));
  return { exists: true, generatedByAgentReady, countsAsMaintainerAuthored: !generatedByAgentReady };
}

async function analyzeCodeGraph(root: string, files: string[], packages: PackageInfo[]): Promise<CodeGraph> {
  const sourceFiles = files
    .filter((file) => /\.(tsx?|jsx?|mjs|cjs)$/.test(file))
    .filter((file) => !file.endsWith(".d.ts"))
    .filter((file) => !file.includes(`${path.sep}dist${path.sep}`) && !file.includes(`${path.sep}node_modules${path.sep}`))
    .slice(0, 1200);
  const sourceSet = new Set(sourceFiles.map((file) => rel(root, file)));
  const entryPoints = detectEntryPoints(root, packages, sourceSet);
  const importEdges: ImportEdge[] = [];
  const externalImportMap = new Map<string, Set<string>>();

  for (const file of sourceFiles) {
    const text = await readText(file);
    if (!text) continue;
    const from = rel(root, file);
    for (const specifier of extractImportSpecifiers(text)) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(root, from, specifier, sourceSet);
        importEdges.push({ from, to: resolved ?? specifier, specifier, resolved: Boolean(resolved) });
      } else {
        const packageName = externalPackageName(specifier);
        const importedBy = externalImportMap.get(packageName) ?? new Set<string>();
        importedBy.add(from);
        externalImportMap.set(packageName, importedBy);
      }
    }
  }

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const edge of importEdges) {
    outbound.set(edge.from, (outbound.get(edge.from) ?? 0) + 1);
    if (edge.resolved) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  }

  const centralFiles = [...sourceSet]
    .map((file) => ({ path: file, inbound: inbound.get(file) ?? 0, outbound: outbound.get(file) ?? 0 }))
    .filter((file) => file.inbound > 0 || file.outbound > 0)
    .sort((a, b) => b.inbound - a.inbound || b.outbound - a.outbound)
    .slice(0, 20);

  const externalImports = [...externalImportMap.entries()]
    .map(([packageName, importedBy]) => ({ packageName, importedBy: [...importedBy].sort().slice(0, 12) }))
    .sort((a, b) => b.importedBy.length - a.importedBy.length || a.packageName.localeCompare(b.packageName))
    .slice(0, 30);

  return {
    entryPoints,
    importEdges: importEdges.filter((edge) => edge.resolved).slice(0, 120),
    centralFiles,
    externalImports,
    unresolvedRelativeImports: importEdges.filter((edge) => !edge.resolved).slice(0, 30),
  };
}

function detectEntryPoints(root: string, packages: PackageInfo[], sourceSet: Set<string>): EntryPoint[] {
  const entries = new Map<string, EntryPoint>();
  for (const pkg of packages) {
    const dir = path.posix.dirname(pkg.path) === "." ? "." : path.posix.dirname(pkg.path);
    const packageRoot = dir === "." ? "" : `${dir}/`;
    const scripts = Object.values(pkg.scripts).join("\n");
    const candidates = [
      ["bin", "CLI binary", "package.json bin/main entry"],
      ["cli.ts", "CLI binary", "conventional CLI entry"],
      ["cli.js", "CLI binary", "conventional CLI entry"],
      ["src/cli.ts", "CLI binary", "conventional CLI entry"],
      ["src/cli.js", "CLI binary", "conventional CLI entry"],
      ["src/index.ts", "library entry", "conventional package entry"],
      ["src/index.js", "library entry", "conventional package entry"],
      ["index.ts", "library entry", "conventional package entry"],
      ["index.js", "library entry", "conventional package entry"],
      ["src/main.ts", "application entry", "conventional app entry"],
      ["src/main.js", "application entry", "conventional app entry"],
      ["src/server.ts", "server entry", "conventional server entry"],
      ["src/server.js", "server entry", "conventional server entry"],
      ["app/page.tsx", "Next.js route", "App Router page"],
      ["app/layout.tsx", "Next.js layout", "App Router layout"],
      ["src/app/page.tsx", "Next.js route", "App Router page"],
      ["pages/index.tsx", "Next.js route", "Pages Router index"],
    ] as const;

    for (const [candidate, kind, reason] of candidates) {
      const file = `${packageRoot}${candidate}`;
      if (sourceSet.has(file)) entries.set(file, { path: file, kind, reason });
    }

    for (const source of sourceSet) {
      if (!source.startsWith(packageRoot)) continue;
      const local = source.slice(packageRoot.length);
      if (/^pages\/api\/.+\.(tsx?|jsx?)$/.test(local)) entries.set(source, { path: source, kind: "API route", reason: "Next.js API route" });
      if (/^app\/.+\/(page|route)\.(tsx?|jsx?)$/.test(local)) entries.set(source, { path: source, kind: "Next.js route", reason: "App Router route/page" });
    }

    if (/tsx\s+src\/cli\.ts|node\s+dist\/cli\.js/.test(scripts)) {
      const cli = `${packageRoot}src/cli.ts`;
      if (sourceSet.has(cli)) entries.set(cli, { path: cli, kind: "CLI binary", reason: "package script invokes CLI" });
    }
  }

  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 40);
}

function extractImportSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
    /export\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function resolveRelativeImport(root: string, from: string, specifier: string, sourceSet: Set<string>): string | undefined {
  const fromDir = path.posix.dirname(from);
  const base = path.posix.normalize(path.posix.join(fromDir, specifier));
  const withoutJsRuntimeExt = base.replace(/\.(js|mjs|cjs|jsx)$/, "");
  const candidates = [
    base,
    withoutJsRuntimeExt,
    `${withoutJsRuntimeExt}.ts`,
    `${withoutJsRuntimeExt}.tsx`,
    `${withoutJsRuntimeExt}.js`,
    `${withoutJsRuntimeExt}.jsx`,
    `${withoutJsRuntimeExt}.mjs`,
    `${withoutJsRuntimeExt}.cjs`,
    `${withoutJsRuntimeExt}/index.ts`,
    `${withoutJsRuntimeExt}/index.tsx`,
    `${withoutJsRuntimeExt}/index.js`,
    `${withoutJsRuntimeExt}/index.jsx`,
  ];
  return [...new Set(candidates)].find((candidate) => sourceSet.has(candidate));
}

function externalPackageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function detectNoisyPaths(files: string[]): string[] {
  const noisy = new Set<string>();
  for (const file of files) {
    const first = file.split("/")[0];
    if (["node_modules", ".next", "dist", "build", "coverage", ".turbo", "vendor", "target"].includes(first)) noisy.add(first);
    if (file.endsWith(".generated.ts") || file.includes("/generated/")) noisy.add("generated");
  }
  return [...noisy];
}

async function detectHebrewOrRtl(files: string[]): Promise<boolean> {
  const textFiles = files.filter((file) => /\.(ts|tsx|js|jsx|md|css|html|json)$/.test(file)).slice(0, 300);
  for (const file of textFiles) {
    const text = await readText(file);
    if (!text) continue;
    if (/[\u0590-\u05FF]/.test(text) || /dir=["']rtl["']|direction:\s*rtl/.test(text)) return true;
  }
  return false;
}
