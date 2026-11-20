# Agent guide

## Git hooks

Checks run in `.githooks/` (see README.md). Run `scripts/setup-hooks` after
cloning. All checks must pass before you push. Never use `--no-verify`.
`pre-commit`: Biome (`20-biome`) and `shellcheck` + `shfmt` (`30-shell-lint`)
on the staged snapshot. `pre-push`: `npm run lint`, `npm run typecheck`,
`npm test`, shell lint and format, `npm ls`, `npm audit --audit-level=high`,
and `npm audit signatures`.

Commit messages follow `.githooks/GIT_CONVENTION.md`, which `commit-msg` and
`pre-push` enforce. The generic checks need gitleaks, osv-scanner, semgrep,
lizard and markdownlint-cli2, plus actionlint and zizmor when a push changes
workflow files. A missing tool blocks the hook.
