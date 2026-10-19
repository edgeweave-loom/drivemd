# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Spec

- `docs/SPEC.md` is the source of truth. Read it before any change, and build one milestone of its build plan at a time.
- When a decision changes or an open question gets an answer, update the spec in the same PR as the code.
- The app must never alter bytes the user did not edit: the spec's "Risks and gotchas" section lists the traps (line endings, BOM, encodings, MIME types).

## Public-readiness

The repository is public: anyone can read its whole history, pull request branches included, and its issues and pull requests.

- Never commit secrets, tokens, credentials or private keys, even briefly: deleting them later does not remove them from history. The `Secrets` workflow runs gitleaks on every push and every pull request from a fork.
- Configuration comes from environment variables (`VITE_*` at build time), with placeholders in `.env.example`; never commit a `.env` file.
- Test fixtures and examples use made-up data: no real Drive file IDs, email addresses or note contents.

## Git

- Branches: `main` < `dev` < `feat/*`. Branch from `dev` and open the PR against `dev`; `dev` reaches `main` through release PRs.
- Commit messages and PR titles follow Conventional Commits (`type(scope): subject`), in English. Write the PR title and body as the squash commit they will become.
- Keep PRs under about 400 changed lines; split larger work into PRs that can be merged independently.
- `README.md` is the user and developer guide: update it whenever commands, environment variables or behavior change.
