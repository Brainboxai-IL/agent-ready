import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORES, listDirSafe, pathExists, readJson, readText, rel, walkFiles } from "../utils/fs.js";
const LANGUAGE_EXTS = {
    TypeScript: [".ts", ".tsx"],
    JavaScript: [".js", ".jsx", ".mjs", ".cjs"],
    Python: [".py"],
    PHP: [".php"],
    Java: [".java"],
    "C#": [".cs"],
    Go: [".go"],
    Rust: [".rs"],
    Svelte: [".svelte"],
    "C/C++": [".c", ".cc", ".cpp", ".h", ".hpp"],
};
export async function scanProject(rootInput) {
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
    const codeGraph = await analyzeCodeGraph(root, files, packages, frameworks);
    const description = await extractDescription(root, rootPackage);
    const envVars = await detectEnvVars(root, relativeFiles);
    return {
        root,
        name: rootPackage?.name ?? path.basename(root),
        description,
        envVars,
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
async function detectPackages(root, files) {
    const packageFiles = files.filter((file) => path.basename(file) === "package.json" && !file.includes(`${path.sep}node_modules${path.sep}`));
    const packages = [];
    for (const file of packageFiles) {
        const json = await readJson(file);
        if (!json)
            continue;
        const workspaces = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages;
        packages.push({
            path: rel(root, file),
            name: json.name,
            description: json.description,
            packageManager: json.packageManager,
            scripts: json.scripts ?? {},
            dependencies: json.dependencies ?? {},
            devDependencies: json.devDependencies ?? {},
            workspaces,
        });
    }
    return packages.sort((a, b) => a.path.localeCompare(b.path));
}
function mergeDeps(packages) {
    return Object.assign({}, ...packages.map((pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies })));
}
function detectPackageManager(root, rootPackage, files) {
    if (rootPackage?.packageManager)
        return rootPackage.packageManager.split("@")[0];
    if (files.includes("pnpm-lock.yaml"))
        return "pnpm";
    if (files.includes("yarn.lock"))
        return "yarn";
    if (files.includes("bun.lockb") || files.includes("bun.lock"))
        return "bun";
    if (files.includes("package-lock.json"))
        return "npm";
    return undefined;
}
function detectFrameworks(files, deps) {
    const found = new Set();
    if (deps.next || files.includes("next.config.js") || files.includes("next.config.ts"))
        found.add("Next.js");
    if (deps.react || deps["react-dom"])
        found.add("React");
    if (deps.vue || deps.nuxt)
        found.add(deps.nuxt ? "Nuxt" : "Vue");
    if (deps.svelte || deps["@sveltejs/kit"])
        found.add(deps["@sveltejs/kit"] ? "SvelteKit" : "Svelte");
    if (deps["@remix-run/react"] || deps["@remix-run/node"] || deps["@remix-run/server-runtime"] || files.includes("remix.config.js") || files.includes("remix.config.ts"))
        found.add("Remix");
    if (deps.vite || files.some((file) => file.startsWith("vite.config.")))
        found.add("Vite");
    if (deps.express)
        found.add("Express");
    if (deps["@nestjs/core"])
        found.add("NestJS");
    if (files.includes("pyproject.toml") || files.includes("requirements.txt"))
        found.add("Python");
    if (files.includes("manage.py"))
        found.add("Django");
    if (files.includes("artisan") || files.includes("composer.json"))
        found.add("PHP/Laravel or Composer");
    if (files.some((file) => file.endsWith(".csproj") || file.endsWith(".sln")))
        found.add(".NET");
    if (files.includes("go.mod"))
        found.add("Go Module");
    if (files.includes("Cargo.toml"))
        found.add("Rust/Cargo");
    return [...found];
}
function detectDatabases(files, deps) {
    const found = new Set();
    if (deps["@supabase/supabase-js"] || files.some((file) => file.startsWith("supabase/")))
        found.add("Supabase");
    if (deps.prisma || files.some((file) => file.startsWith("prisma/")))
        found.add("Prisma");
    if (deps["drizzle-orm"] || files.some((file) => file.includes("drizzle")))
        found.add("Drizzle");
    if (deps.pg || deps.postgres)
        found.add("PostgreSQL");
    if (deps.mysql2 || deps.mysql)
        found.add("MySQL");
    if (deps.mongoose || deps.mongodb)
        found.add("MongoDB");
    return [...found];
}
async function detectDeployment(root, files, deps) {
    const found = new Set();
    if (files.includes("vercel.json") || deps.vercel)
        found.add("Vercel");
    if (files.some((file) => /(^|\/)Dockerfile$|docker-compose\.ya?ml$/.test(file)))
        found.add("Docker");
    if (files.some((file) => file.startsWith(".github/workflows/")))
        found.add("GitHub Actions");
    if (await pathExists(path.join(root, "netlify.toml")))
        found.add("Netlify");
    if (files.includes("wrangler.toml"))
        found.add("Cloudflare Workers");
    return [...found];
}
function detectMonorepo(files, packages, rootPackage) {
    const tools = new Set();
    if (files.includes("turbo.json"))
        tools.add("Turborepo");
    if (files.includes("nx.json"))
        tools.add("Nx");
    if (files.includes("pnpm-workspace.yaml"))
        tools.add("pnpm workspaces");
    if (rootPackage?.workspaces?.length)
        tools.add("package workspaces");
    const workspaceGlobs = rootPackage?.workspaces ?? (files.includes("pnpm-workspace.yaml") ? ["apps/*", "packages/*", "services/*"] : []);
    return { detected: tools.size > 0 || packages.length > 1, tools: [...tools], workspaceGlobs };
}
function detectCommands(packages, projectPackageManager) {
    const map = {};
    const names = ["dev", "build", "test", "lint", "typecheck", "format"];
    for (const pkg of packages) {
        const dir = path.posix.dirname(pkg.path) === "." ? "." : path.posix.dirname(pkg.path);
        const pm = pkg.packageManager?.split("@")[0] ?? projectPackageManager ?? "npm";
        for (const name of names) {
            const scriptName = scriptForCommand(pkg.scripts, name);
            if (!scriptName)
                continue;
            const prefix = dir === "." ? "" : `cd ${dir} && `;
            const command = `${prefix}${pm} run ${scriptName}`;
            map[name] = [...(map[name] ?? []), command];
        }
    }
    return map;
}
function scriptForCommand(scripts, name) {
    const candidates = {
        dev: ["dev", "start:dev", "serve"],
        build: ["build", "compile"],
        test: ["test", "test:unit", "unit"],
        lint: ["lint", "eslint"],
        typecheck: ["typecheck", "type-check", "check", "tsc"],
        format: ["format", "prettier"],
    };
    return findScript(scripts, candidates[name]);
}
function findScript(scripts, candidates) {
    return candidates.find((candidate) => scripts[candidate]);
}
function hasCommand(commands, name) {
    return Boolean(commands[name]?.length);
}
function detectLanguages(files) {
    const counts = new Map();
    for (const file of files) {
        const ext = path.extname(file);
        for (const [language, exts] of Object.entries(LANGUAGE_EXTS)) {
            if (exts.includes(ext))
                counts.set(language, (counts.get(language) ?? 0) + 1);
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language]) => language);
}
async function summarizeImportantDirs(root, files, isMonorepo) {
    const candidates = ["apps", "packages", "services", "src", "lib", "components", "app", "pages", "api", "server", "client", "prisma", "supabase", "scripts", "docs", ".github"];
    const summaries = [];
    for (const candidate of candidates) {
        const full = path.join(root, candidate);
        try {
            const stat = await fs.stat(full);
            if (!stat.isDirectory())
                continue;
        }
        catch {
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
function reasonForDir(dir) {
    const reasons = {
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
async function harnessFileState(root, relativePath) {
    const fullPath = path.join(root, relativePath);
    const exists = await pathExists(fullPath);
    if (!exists)
        return { exists: false, generatedByAgentReady: false, countsAsMaintainerAuthored: false };
    const text = await readText(fullPath);
    const generatedByAgentReady = Boolean(text && /generated by `?agent-ready`?|agent-ready:|Generated by agent-ready/i.test(text));
    return { exists: true, generatedByAgentReady, countsAsMaintainerAuthored: !generatedByAgentReady };
}
// Pull a human description from the repo itself: the README's first real prose
// paragraph (skipping the title, badges, and HTML), falling back to the root
// package.json `description`. This is what turns the generated CLAUDE.md from a
// generic template into something that actually describes the project.
async function extractDescription(root, rootPackage) {
    const readmeNames = ["README.md", "readme.md", "Readme.md", "README.markdown", "README.rst", "README.txt", "README"];
    for (const name of readmeNames) {
        const text = await readText(path.join(root, name));
        if (!text)
            continue;
        const paragraph = firstProseParagraph(text);
        if (paragraph)
            return paragraph;
    }
    const fromPackage = rootPackage?.description?.trim();
    return fromPackage || undefined;
}
function firstProseParagraph(markdown) {
    const paragraph = [];
    let inFence = false;
    let inCallout = false;
    for (const raw of markdown.split(/\r?\n/)) {
        const line = raw.trim();
        if (/^(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        } // toggle fenced code block
        if (inFence)
            continue; // never treat code as prose (e.g. a ```bash language tag)
        if (!line) {
            if (paragraph.length)
                break; // blank line ends the first paragraph
            inCallout = false;
            continue;
        }
        if (line.startsWith(">")) {
            // A blockquote right under the title is usually the tagline/description, so
            // treat it as prose — but skip GitHub callouts (`> [!NOTE]`, `> [!WARNING]`).
            const content = line.replace(/^>+\s?/, "").trim();
            if (inCallout)
                continue;
            if (/^\[!\w+\]/i.test(content)) {
                inCallout = true;
                continue;
            }
            if (content)
                paragraph.push(content);
            continue;
        }
        inCallout = false;
        if (/^#{1,6}\s/.test(line)) {
            if (paragraph.length)
                break;
            else
                continue;
        } // heading
        if (/^(<!--|<\/?(p|div|img|a|br|picture|table|h[1-6]|center|sub|sup)\b)/i.test(line))
            continue; // html block/badge wrappers
        if (/^([-*_])\1{2,}$/.test(line))
            continue; // horizontal rule
        if (/^!\[/.test(line))
            continue; // standalone image
        if (isBadgeOnlyLine(line))
            continue; // shields.io badge rows
        paragraph.push(line);
    }
    if (!paragraph.length)
        return undefined;
    const text = stripInlineMarkdown(paragraph.join(" ")).replace(/\s+/g, " ").trim();
    return text ? clampSentences(text, 360) : undefined;
}
// A line is "badge only" if removing image/link markdown and HTML leaves no real words.
function isBadgeOnlyLine(line) {
    if (/img\.shields\.io|badge|\bsvg\b/i.test(line) && /\]\(|<img/i.test(line))
        return true;
    const remainder = line
        .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[^\p{L}]/gu, "")
        .trim();
    return remainder.length < 3;
}
function stripInlineMarkdown(text) {
    return text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
        .replace(/<[^>]+>/g, "") // inline html
        .replace(/[*_`]+/g, "") // emphasis/code marks
        .trim();
}
function clampSentences(text, max) {
    if (text.length <= max)
        return text;
    const slice = text.slice(0, max);
    const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (lastStop > max * 0.5)
        return slice.slice(0, lastStop + 1).trim();
    return `${slice.replace(/\s+\S*$/, "").trim()}…`;
}
// Collect required environment variable NAMES (never values) from .env.example-style
// files. Agents constantly need to know which env vars a project expects; this surfaces
// them without leaking secrets.
async function detectEnvVars(root, relativeFiles) {
    const envFiles = relativeFiles
        .filter((file) => /(^|\/)\.env\.(example|sample|template|defaults|dist)$/i.test(file))
        .slice(0, 12);
    const keys = new Set();
    for (const file of envFiles) {
        const text = await readText(path.join(root, file));
        if (!text)
            continue;
        for (const line of text.split(/\r?\n/)) {
            const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
            if (match)
                keys.add(match[1]);
        }
    }
    return [...keys].sort().slice(0, 60);
}
async function analyzeCodeGraph(root, files, packages, frameworks) {
    const sourceFiles = files
        .filter((file) => /\.(tsx?|jsx?|mjs|cjs|py|go|rs|svelte)$/.test(file))
        .filter((file) => !file.endsWith(".d.ts"))
        .filter((file) => !file.includes(`${path.sep}dist${path.sep}`) && !file.includes(`${path.sep}node_modules${path.sep}`) && !file.includes(`${path.sep}target${path.sep}`))
        .slice(0, 2000);
    const sourceSet = new Set(sourceFiles.map((file) => rel(root, file)));
    const goModulePath = await readGoModulePath(root);
    const entryPoints = detectEntryPoints(root, packages, sourceSet, frameworks);
    const importEdges = [];
    const externalImportMap = new Map();
    for (const file of sourceFiles) {
        const text = await readText(file);
        if (!text)
            continue;
        const from = rel(root, file);
        for (const specifier of extractImportSpecifiers(text, from)) {
            const resolved = resolveImport(from, specifier, sourceSet, goModulePath);
            if (resolved) {
                importEdges.push({ from, to: resolved, specifier, resolved: true });
            }
            else if (isProbablyLocalSpecifier(specifier, from, sourceSet, goModulePath)) {
                importEdges.push({ from, to: specifier, specifier, resolved: false });
            }
            else {
                const packageName = externalPackageName(specifier);
                const importedBy = externalImportMap.get(packageName) ?? new Set();
                importedBy.add(from);
                externalImportMap.set(packageName, importedBy);
            }
        }
    }
    const inbound = new Map();
    const outbound = new Map();
    for (const edge of importEdges) {
        outbound.set(edge.from, (outbound.get(edge.from) ?? 0) + 1);
        if (edge.resolved)
            inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
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
function detectEntryPoints(root, packages, sourceSet, frameworks) {
    const entries = new Map();
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
            ["main.py", "Python entry", "conventional Python entry"],
            ["app.py", "Python app", "conventional Python app entry"],
            ["src/main.py", "Python entry", "conventional Python entry"],
            ["cmd/main.go", "Go command", "conventional Go command entry"],
            ["main.go", "Go command", "conventional Go command entry"],
            ["src/main.rs", "Rust binary", "conventional Rust binary entry"],
            ["src/lib.rs", "Rust library", "conventional Rust library entry"],
        ];
        for (const [candidate, kind, reason] of candidates) {
            const file = `${packageRoot}${candidate}`;
            if (sourceSet.has(file))
                entries.set(file, { path: file, kind, reason });
        }
        for (const source of sourceSet) {
            if (!source.startsWith(packageRoot))
                continue;
            const local = source.slice(packageRoot.length);
            const frameworkEntry = frameworkEntryPoint(local, frameworks);
            if (frameworkEntry)
                entries.set(source, { path: source, ...frameworkEntry });
            if (/^cmd\/[^/]+\/main\.go$/.test(local))
                entries.set(source, { path: source, kind: "Go command", reason: "cmd/*/main.go" });
            if (/^src\/bin\/[^/]+\.rs$/.test(local))
                entries.set(source, { path: source, kind: "Rust binary", reason: "Cargo src/bin entry" });
        }
        if (/tsx\s+src\/cli\.ts|node\s+dist\/cli\.js/.test(scripts)) {
            const cli = `${packageRoot}src/cli.ts`;
            if (sourceSet.has(cli))
                entries.set(cli, { path: cli, kind: "CLI binary", reason: "package script invokes CLI" });
        }
    }
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 40);
}
function frameworkEntryPoint(localPath, frameworks) {
    // Framework conventions like `pages/` and `app/` are generic folder names that
    // also appear in Vite/React-Router apps. Only treat them as framework entry
    // points when the framework is actually detected, or every such project is
    // mislabeled (e.g. a Vite `src/pages/*.tsx` reported as a Next.js route).
    if (frameworks.includes("Next.js")) {
        if (/^(src\/)?app\/(page|layout|route)\.(tsx?|jsx?)$/.test(localPath)) {
            const file = localPath.includes("/layout.") ? "layout" : localPath.includes("/route.") ? "route handler" : "page";
            return { kind: `Next.js ${file}`, reason: "App Router root entry" };
        }
        if (/^(src\/)?app\/.+\/(page|layout|route|loading|error|not-found)\.(tsx?|jsx?)$/.test(localPath)) {
            return { kind: "Next.js route", reason: "App Router route segment entry" };
        }
        if (/^(src\/)?pages\/index\.(tsx?|jsx?)$/.test(localPath))
            return { kind: "Next.js route", reason: "Pages Router index" };
        if (/^(src\/)?pages\/(api\/.+|.+)\.(tsx?|jsx?)$/.test(localPath))
            return { kind: "Next.js route", reason: "Pages Router route/API entry" };
        if (/^(src\/)?middleware\.(tsx?|jsx?)$/.test(localPath))
            return { kind: "Next.js middleware", reason: "Next.js request middleware entry" };
        if (/^next\.config\.(tsx?|jsx?|mjs|cjs)$/.test(localPath))
            return { kind: "Next.js config", reason: "Next.js configuration entry" };
    }
    if (frameworks.includes("Remix")) {
        if (/^app\/(root|entry\.(client|server))\.(tsx?|jsx?)$/.test(localPath))
            return { kind: "Remix entry", reason: "Remix root/client/server entry" };
        if (/^app\/routes\/.+\.(tsx?|jsx?)$/.test(localPath))
            return { kind: "Remix route", reason: "Remix route module" };
    }
    if (frameworks.includes("SvelteKit")) {
        if (/^src\/routes\/(\+page|\+layout|\+server)\.(svelte|tsx?|jsx?)$/.test(localPath))
            return { kind: "SvelteKit route", reason: "SvelteKit root route entry" };
        if (/^src\/routes\/.+\/(\+page|\+layout|\+server)\.(svelte|tsx?|jsx?)$/.test(localPath))
            return { kind: "SvelteKit route", reason: "SvelteKit route entry" };
        if (/^src\/hooks(\.server)?\.(tsx?|jsx?)$/.test(localPath))
            return { kind: "SvelteKit hook", reason: "SvelteKit lifecycle hook entry" };
    }
    return undefined;
}
function extractImportSpecifiers(text, from) {
    const specifiers = new Set();
    const ext = path.posix.extname(from);
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(ext)) {
        const patterns = [
            /import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
            /export\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)["']([^"']+)["']/g,
            /import\(\s*["']([^"']+)["']\s*\)/g,
            /require\(\s*["']([^"']+)["']\s*\)/g,
        ];
        for (const pattern of patterns)
            for (const match of text.matchAll(pattern))
                specifiers.add(match[1]);
    }
    if (ext === ".py") {
        for (const match of text.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+\w+)?/gm))
            specifiers.add(match[1]);
        for (const match of text.matchAll(/^\s*from\s+([\w.]+|\.+[\w.]*)\s+import\s+([\w*,\s]+)/gm)) {
            const moduleName = match[1];
            const imported = match[2].split(",").map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean);
            specifiers.add(moduleName);
            if (moduleName.startsWith("."))
                for (const item of imported)
                    if (item !== "*" && /^[A-Za-z_]\w*$/.test(item))
                        specifiers.add(`${moduleName}.${item}`);
        }
    }
    if (ext === ".go") {
        for (const match of text.matchAll(/import\s+(?:[\w.]+\s+)?"([^"]+)"/g))
            specifiers.add(match[1]);
        for (const block of text.matchAll(/import\s*\(([^)]+)\)/gs)) {
            for (const match of block[1].matchAll(/(?:[\w.]+\s+)?"([^"]+)"/g))
                specifiers.add(match[1]);
        }
    }
    if (ext === ".rs") {
        for (const match of text.matchAll(/^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm))
            specifiers.add(`./${match[1]}`);
        for (const match of text.matchAll(/^\s*(?:pub\s+)?use\s+([^;]+);/gm)) {
            const first = match[1].trim().split(/::|\s+/)[0];
            if (first)
                specifiers.add(match[1].trim());
        }
    }
    return [...specifiers];
}
async function readGoModulePath(root) {
    const goMod = await readText(path.join(root, "go.mod"));
    return goMod?.match(/^module\s+(.+)$/m)?.[1]?.trim();
}
function resolveImport(from, specifier, sourceSet, goModulePath) {
    const ext = path.posix.extname(from);
    if (specifier.startsWith("."))
        return resolveRelativeLikeImport(from, specifier, sourceSet, ext);
    if (ext === ".py")
        return resolvePythonAbsoluteImport(specifier, sourceSet);
    if (ext === ".go" && goModulePath && specifier.startsWith(`${goModulePath}/`))
        return resolveGoModuleImport(specifier.slice(goModulePath.length + 1), sourceSet);
    if (ext === ".rs" && /^(crate|self|super)::/.test(specifier))
        return resolveRustPathImport(from, specifier, sourceSet);
    return undefined;
}
function resolveRelativeLikeImport(from, specifier, sourceSet, ext) {
    if (ext === ".py")
        return resolvePythonRelativeImport(from, specifier, sourceSet);
    const fromDir = path.posix.dirname(from);
    const base = path.posix.normalize(path.posix.join(fromDir, specifier));
    const withoutJsRuntimeExt = base.replace(/\.(js|mjs|cjs|jsx)$/, "");
    const candidates = [
        base,
        withoutJsRuntimeExt,
        `${withoutJsRuntimeExt}.ts`, `${withoutJsRuntimeExt}.tsx`, `${withoutJsRuntimeExt}.js`, `${withoutJsRuntimeExt}.jsx`, `${withoutJsRuntimeExt}.mjs`, `${withoutJsRuntimeExt}.cjs`,
        `${withoutJsRuntimeExt}.py`, `${withoutJsRuntimeExt}.go`, `${withoutJsRuntimeExt}.rs`,
        `${withoutJsRuntimeExt}/index.ts`, `${withoutJsRuntimeExt}/index.tsx`, `${withoutJsRuntimeExt}/index.js`, `${withoutJsRuntimeExt}/index.jsx`,
        `${withoutJsRuntimeExt}/__init__.py`, `${withoutJsRuntimeExt}/mod.rs`,
    ];
    return [...new Set(candidates)].find((candidate) => sourceSet.has(candidate));
}
function resolvePythonRelativeImport(from, specifier, sourceSet) {
    const leadingDots = specifier.match(/^\.+/)?.[0].length ?? 0;
    const rest = specifier.slice(leadingDots).replaceAll(".", "/");
    let dir = path.posix.dirname(from);
    for (let i = 1; i < leadingDots; i += 1)
        dir = path.posix.dirname(dir);
    const base = rest ? path.posix.join(dir, rest) : dir;
    return resolvePythonModulePath(base, sourceSet);
}
function resolvePythonAbsoluteImport(specifier, sourceSet) {
    const modulePath = specifier.replaceAll(".", "/");
    return resolvePythonModulePath(modulePath, sourceSet) ?? resolvePythonModulePath(`src/${modulePath}`, sourceSet);
}
function resolvePythonModulePath(base, sourceSet) {
    const candidates = [`${base}.py`, `${base}/__init__.py`];
    return candidates.find((candidate) => sourceSet.has(candidate));
}
function resolveGoModuleImport(localPath, sourceSet) {
    const normalized = localPath.replace(/^\/+/, "");
    const candidates = [...sourceSet].filter((file) => file.startsWith(`${normalized}/`) && file.endsWith(".go") && !file.endsWith("_test.go"));
    return candidates.sort()[0];
}
function resolveRustPathImport(from, specifier, sourceSet) {
    const parts = specifier.split("::").map((part) => part.replace(/[{}*\s].*$/, "")).filter(Boolean);
    const scope = parts.shift();
    let baseParts = parts;
    if (scope === "crate") {
        // crate::foo::bar usually maps from src/foo/bar.rs or src/foo.rs.
    }
    else if (scope === "self") {
        const dir = path.posix.dirname(from);
        const base = path.posix.join(dir, ...baseParts);
        return resolveRustModulePath(base, sourceSet);
    }
    else if (scope === "super") {
        const dir = path.posix.dirname(path.posix.dirname(from));
        const base = path.posix.join(dir, ...baseParts);
        return resolveRustModulePath(base, sourceSet);
    }
    else {
        baseParts = [scope ?? "", ...baseParts].filter(Boolean);
    }
    const base = path.posix.join("src", ...baseParts);
    return resolveRustModulePath(base, sourceSet);
}
function resolveRustModulePath(base, sourceSet) {
    const candidates = [`${base}.rs`, `${base}/mod.rs`, `${base}/lib.rs`];
    return candidates.find((candidate) => sourceSet.has(candidate));
}
function isProbablyLocalSpecifier(specifier, from, sourceSet, goModulePath) {
    const ext = path.posix.extname(from);
    return specifier.startsWith(".") || (ext === ".go" && Boolean(goModulePath && specifier.startsWith(`${goModulePath}/`))) || (ext === ".rs" && /^(crate|self|super)::/.test(specifier)) || (ext === ".py" && Boolean(resolvePythonAbsoluteImport(specifier, sourceSet)));
}
function externalPackageName(specifier) {
    if (specifier.startsWith("@"))
        return specifier.split("/").slice(0, 2).join("/");
    if (specifier.includes("::"))
        return specifier.split("::")[0];
    if (specifier.includes("."))
        return specifier.split(".")[0];
    return specifier.split("/")[0];
}
function detectNoisyPaths(files) {
    const noisy = new Set();
    for (const file of files) {
        const first = file.split("/")[0];
        if (["node_modules", ".next", "dist", "build", "coverage", ".turbo", "vendor", "target"].includes(first))
            noisy.add(first);
        if (file.endsWith(".generated.ts") || file.includes("/generated/"))
            noisy.add("generated");
    }
    return [...noisy];
}
async function detectHebrewOrRtl(files) {
    const textFiles = files.filter((file) => /\.(ts|tsx|js|jsx|md|css|html|json)$/.test(file)).slice(0, 300);
    for (const file of textFiles) {
        const text = await readText(file);
        if (!text)
            continue;
        if (/[\u0590-\u05FF]/.test(text) || /dir=["']rtl["']|direction:\s*rtl/.test(text))
            return true;
    }
    return false;
}
