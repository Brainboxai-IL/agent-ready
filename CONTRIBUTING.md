# Contributing

Thanks for considering a contribution to `agent-ready`.

## Project Status

This project is in early preview. Contributions that improve safety, detection quality, documentation, tests, and real-world repository support are especially welcome.

## Development Setup

```bash
npm install
npm run check
npm run build
```

Run the CLI locally:

```bash
npm run dev -- analyze .
npm run dev -- init . --dry-run
```

## Pull Request Checklist

Before opening a PR:

- [ ] Run `npm run check`
- [ ] Run `npm run build`
- [ ] Test `agent-ready init <fixture-or-real-project> --dry-run`
- [ ] Keep root `CLAUDE.md` output lean
- [ ] Put task-specific expertise in generated skills, not always-loaded context
- [ ] Avoid adding remote calls unless they are explicit opt-in

## Design Principles

- Local-first: never upload repository contents by default.
- Conservative writes: do not overwrite existing files unless `--force` is used.
- Lean context: root agent instructions should stay short and broadly applicable.
- Progressive disclosure: specialized knowledge belongs in skills.
- Honest detection: mark heuristic findings clearly; do not overclaim certainty.
