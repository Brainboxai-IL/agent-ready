# Agent Harness Recommendations

## LSP
- Install/enable TypeScript language server and ESLint language server for symbol-aware navigation.

## MCP
- Use Context7/library-docs MCP for up-to-date framework/library APIs.
- Expose CI logs/status through GitHub tooling/MCP if available.

## Hooks
- Stop hook: summarize useful session learnings and propose focused CLAUDE.md/skill updates.
- Pre-edit/pre-delete hook: require confirmation for destructive operations and broad rewrites.
- Post-edit hook: suggest or run the narrowest lint command for changed workspace.
- Post-edit hook: suggest targeted tests related to changed files.

## Maintenance
- Review CLAUDE.md and generated skills every 3–6 months or after major model/tool releases.
- Move repeated session learnings into skills or focused subdirectory CLAUDE.md files.
