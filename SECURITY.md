# Security Policy

## Status

`agent-ready` is currently an experimental early-preview tool.

## Reporting a Vulnerability

If you find a security issue, please open a private security advisory on GitHub or contact the BrainboxAI maintainers directly.

Please include:

- affected version or commit
- steps to reproduce
- expected vs actual behavior
- potential impact

## Data Handling

`agent-ready` scans repositories locally from disk. It does not upload source code, create embeddings, or call remote AI services.

Generated files should still be reviewed before committing, especially in repositories with sensitive paths, private infrastructure details, or deployment secrets.
