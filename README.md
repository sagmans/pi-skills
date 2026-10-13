# pi-skills
Better skill usage in Pi

## Development

Checks run in tracked local Git hooks. Run `scripts/setup-hooks` once after cloning; it points this clone's `core.hooksPath` at `.githooks`. Each hook runs the generic checks first (sign-off and commit message format, a gitleaks secret scan, and signed, signed-off commits on push), then this repository's checks in `.githooks/<hook>.d/` in name order. Install [gitleaks](https://github.com/gitleaks/gitleaks) first. Every check must pass before you push; never use `--no-verify`. Pre-push checks test exactly each pushed commit: in place only when it is the clean, unmodified checkout, otherwise in a temporary worktree of that commit. `pre-commit` rejects whitespace errors in staged changes.
