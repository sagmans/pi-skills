# Agent guide

## Git hooks

Checks run in `.githooks/` (see README.md). Run `scripts/setup-hooks` after
cloning. All checks must pass before you push. Never use `--no-verify`.

Commit messages follow `.githooks/GIT_CONVENTION.md`, which `commit-msg` and
`pre-push` enforce. The generic checks need gitleaks, osv-scanner, semgrep,
lizard and markdownlint-cli2, plus actionlint and zizmor when a push changes
workflow files. A missing tool blocks the hook.
