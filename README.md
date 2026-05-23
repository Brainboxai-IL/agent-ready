# agent-ready

<p align="center">
  <strong>Turn any repository into an AI-agent-ready codebase.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#what-it-generates">What it Generates</a> ·
  <a href="#how-it-works">How it Works</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-experimental-f59e0b?style=flat-square" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-111827?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-0f766e?style=flat-square" />
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-Node.js-3c873a?style=flat-square" />
  <img alt="Built by BrainboxAI" src="https://img.shields.io/badge/by-BrainboxAI-111827?style=flat-square" />
</p>

`agent-ready` is a CLI by **BrainboxAI** that scans a project and generates the harness AI coding agents need to work safely and effectively: context files, code maps, ignore rules, skills, hook templates, and readiness reports.

It is designed for real repositories—not demo apps. Use it on small apps, legacy codebases, monorepos, service folders, or projects that need a clean onboarding layer for Claude Code and other agentic coding tools.

> [!WARNING]
> `agent-ready` is an **experimental early preview**. It is useful today, but its repository detection is heuristic and generated files should be reviewed before committing.

> [!NOTE]
> **Inspired by Anthropic's Claude Code large-codebase guidance**  
> This project was created after studying Anthropic's article:  
> [**How Claude Code works in large codebases: best practices and where to start**](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start).  
> `agent-ready` turns those ideas—lean `CLAUDE.md` files, codebase maps, skills, hooks, MCP, LSP, scoped context, and subagent-friendly workflows—into a repeatable CLI workflow.

## Table of Contents

- [Why agent-ready](#why-agent-ready)
- [Install](#install)
- [Quick Start](#quick-start)
- [What it Generates](#what-it-generates)
- [How it Works](#how-it-works)
- [Detected Project Signals](#detected-project-signals)
- [Safety Model](#safety-model)
- [Limitations](#limitations)
- [Example Output](#example-output)
- [CLI Reference](#cli-reference)
- [Development](#development)
- [Roadmap](#roadmap)
- [Brand](#brand)
- [Acknowledgements](#acknowledgements)
- [Contributing](#contributing)
- [License](#license)

## Why agent-ready

AI agents perform best when a repository is legible:

- Where should the agent start searching?
- Which files are generated noise?
- Which test/build commands are safe and local?
- Which project rules belong in always-loaded context?
- Which expertise should load only on demand?
- What should the agent never touch without confirmation?

`agent-ready` turns those answers into files an agent can actually use.

Instead of manually writing a bloated `CLAUDE.md`, it creates a layered harness:

```txt
CLAUDE.md                    # lean root agent guide
CODEMAP.md                   # repository map for navigation
.aiignore                    # noisy paths to avoid
.claude/settings.json        # versioned deny rules
.agent-ready/report.md       # readiness score and findings
.agent-ready/recommendations.md
.agent-ready/hooks/README.md
.agent-ready/skills/*/SKILL.md
apps/*/CLAUDE.md             # generated for detected monorepo workspaces
```

## Install

### From source

```bash
git clone https://github.com/Brainboxai-IL/agent-ready.git agent-ready
cd agent-ready
npm install
npm run build
```

Run the compiled CLI:

```bash
node dist/cli.js analyze .
```

### As a linked local CLI

```bash
npm link
agent-ready analyze .
```

> npm package publishing is planned. Until then, use the source or local link workflow.

## Quick Start

Analyze a project without writing files:

```bash
agent-ready analyze /path/to/project
```

Preview generated files:

```bash
agent-ready init /path/to/project --dry-run
```

Generate the harness:

```bash
agent-ready init /path/to/project
```

Overwrite existing generated files intentionally:

```bash
agent-ready init /path/to/project --force
```

By default, existing files are not overwritten. If `CLAUDE.md` already exists, `agent-ready` writes:

```txt
CLAUDE.md.agent-ready-proposed
```

## What it Generates

### `CLAUDE.md`

A lean root guide for AI agents:

- project snapshot
- detected stack
- important directories
- validation commands
- operating rules
- critical framework/database notes

It is intentionally short. Task-specific expertise is placed in skills instead of loading into every session.

### `CODEMAP.md`

A navigation map for agents before broad search:

- top-level directory purpose
- workspace/package manifests
- search guidance
- high-signal project structure

### `.aiignore`

Common noise exclusions:

```txt
node_modules/
.next/
dist/
build/
coverage/
.turbo/
vendor/
generated/
**/*.generated.*
```

### `.claude/settings.json`

Versioned deny rules for generated/build/vendor paths so every developer gets the same baseline safety.

### `.agent-ready/skills/*/SKILL.md`

On-demand task expertise. Examples:

- `codebase-navigation`
- `validation`
- `nextjs-hydration`
- `supabase-debugging`
- `rtl-ui`
- `deployment`

Skills are generated only when matching project signals are detected.

### `.agent-ready/hooks/README.md`

Starter hook policies for:

- session start
- pre-edit / pre-delete safety
- post-edit validation
- stop-hook learning summaries

### Workspace `CLAUDE.md` files

In monorepos, `agent-ready` creates local guides next to detected package manifests, for example:

```txt
apps/web/CLAUDE.md
packages/db/CLAUDE.md
services/api/CLAUDE.md
```

Each one contains local commands and navigation rules for that workspace.

## How it Works

`agent-ready` scans the repository directly from disk. It does not upload code, build embeddings, or require a remote index.

The scanner detects:

1. package manifests and scripts
2. languages and frameworks
3. database/tooling signals
4. deployment infrastructure
5. monorepo/workspace layout
6. important directories
7. noisy/generated paths
8. existing AI harness files

Then it generates a practical agent harness and assigns an **Agent Readiness Score**.

## Detected Project Signals

Current detection includes:

| Area | Signals |
| --- | --- |
| JavaScript/TypeScript | `package.json`, lockfiles, scripts, TS/JS files |
| Frameworks | Next.js, React, Vue, Nuxt, SvelteKit, Vite, Express, NestJS |
| Other languages | Python, PHP, Java, C#, Go, Rust, C/C++ |
| Databases | Supabase, Prisma, Drizzle, PostgreSQL, MySQL, MongoDB |
| Monorepos | Turborepo, Nx, pnpm workspaces, package workspaces |
| Deployment | Docker, GitHub Actions, Vercel, Netlify, Cloudflare Workers |
| UI traits | Hebrew/RTL detection |
| Validation | build, test, lint, typecheck, format scripts |

## Safety Model

`agent-ready` is conservative by default.

- **No overwrite by default** — existing files produce `*.agent-ready-proposed`.
- **Dry-run supported** — preview before writing.
- **Generated noise is denied** — build/vendor/generated paths are excluded.
- **Root context stays lean** — deep knowledge goes into skills.
- **Local validation preferred** — workspace commands are favored over full-repo commands.

## Limitations

`agent-ready` is intentionally conservative and heuristic.

- Detection can miss custom frameworks, unusual scripts, and non-standard repository layouts.
- Generated files are a strong starting point, not a replacement for maintainer review.
- It does not yet perform deep semantic analysis of README files, CI workflows, environment variables, or architecture docs.
- It does not upload code or call remote AI services.
- It is not affiliated with or endorsed by Anthropic.

## Example Output

```txt
Agent Ready: my-app
Root: /code/my-app
Score: 72/100
Languages: TypeScript, Python
Frameworks: Next.js, React
Databases/tools: Supabase
Deployment: Docker, GitHub Actions
Monorepo: yes (Turborepo, pnpm workspaces)

Missing:
- No CODEMAP.md / codebase map
- No reusable skills directory

Generating 14 files:
- created: CLAUDE.md
- created: CODEMAP.md
- created: .aiignore
- created: .claude/settings.json
- created: .agent-ready/report.md
- created: .agent-ready/recommendations.md
- created: .agent-ready/hooks/README.md
- created: .agent-ready/skills/codebase-navigation/SKILL.md
- created: .agent-ready/skills/validation/SKILL.md
- created: .agent-ready/skills/nextjs-hydration/SKILL.md
- created: .agent-ready/skills/supabase-debugging/SKILL.md
- created: apps/web/CLAUDE.md
- created: packages/db/CLAUDE.md
```

## CLI Reference

```bash
agent-ready analyze [path]
```

Scan a project and print the readiness summary. Does not write files.

```bash
agent-ready init [path]
```

Scan a project and generate the AI-agent harness.

```bash
agent-ready init [path] --dry-run
```

Show which files would be generated without writing anything.

```bash
agent-ready init [path] --force
```

Overwrite existing files instead of writing `*.agent-ready-proposed`.

## Development

Requirements:

- Node.js
- npm

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev -- analyze .
npm run dev -- init . --dry-run
```

Type-check:

```bash
npm run check
```

Build:

```bash
npm run build
```

Run compiled CLI:

```bash
node dist/cli.js analyze .
```

## Roadmap

Planned improvements:

- deeper README/config/workflow analysis
- richer monorepo workspace detection
- generated `CONTRIBUTING.md` and `SECURITY.md` templates
- optional AI-assisted repository summary mode
- npm package release
- plugin/export presets for Claude Code, Cursor, Codex, and other agents
- CI mode for failing builds when agent readiness drops below a threshold

## Brand

`agent-ready` is built by **BrainboxAI**.

BrainboxAI builds practical AI-agent infrastructure: tools, workflows, and automation systems that help teams move from ad-hoc prompting to reliable agent operations.

## Acknowledgements

`agent-ready` was created after studying Anthropic's guidance on making large codebases navigable for Claude Code.

> **Reference article**  
> [How Claude Code works in large codebases: best practices and where to start](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start) — Anthropic.

The core idea is to turn those best practices into a repeatable CLI workflow:

- scan the repository
- generate lean, layered context
- map the codebase before broad search
- separate reusable expertise into skills
- document hooks, validation paths, MCP, and LSP recommendations
- keep generated/build/vendor noise away from agents

This project is independent and is not affiliated with or endorsed by Anthropic.

## Contributing

Contributions are welcome once the public repository is available.

Before opening a pull request:

1. Run `npm run check`.
2. Run `npm run build`.
3. Test the CLI on at least one real project with `--dry-run`.
4. Keep generated context lean; do not move task-specific expertise into root `CLAUDE.md` templates.

## License

MIT © BrainboxAI
