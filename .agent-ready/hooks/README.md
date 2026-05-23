# Hook Templates

These are safe starter hook policies. Wire them into your agent harness only after reviewing them for this repository.

## Start Hook
- Load the nearest `CLAUDE.md` files for the current working directory.
- If the task mentions a framework/library, prefer current docs before implementation.
- For monorepos, identify the affected workspace before broad search.

## Pre-edit / Pre-delete Hook
- Block edits in ignored/generated paths unless the user explicitly asked for generated output.
- Require confirmation before deleting files, rewriting broad directories, or changing deployment secrets.

## Post-edit Hook
- Run or suggest the narrowest relevant validation command.
- Lint candidate: `npm run lint`
- Typecheck candidate: `npm run check`
- Test candidate: `npm run test`

## Stop Hook
- Summarize what changed and what was validated.
- If a reusable gotcha/pattern was discovered, propose a focused update to the nearest `CLAUDE.md` or a skill.
- Do not store temporary session state as long-term memory.
