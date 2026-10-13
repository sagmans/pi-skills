# pi-skills
Better skill usage in Pi

## Development

Checks run in tracked local Git hooks. The scripts live in `.githooks/<hook>.d/` and run through the global dotf hooks: the global check runs first, then each script in name order. There is no per-clone setup and no repo-local `core.hooksPath`; if an older setup left one, remove it with `git config --local --unset core.hooksPath`. Repository hooks run only after you review this clone's `.githooks` and trust it with `githooks-trust`; until then only the global checks run. Pre-push checks test exactly each pushed commit: in place only when it is the clean, unmodified checkout, otherwise in a temporary worktree of that commit. `pre-commit` rejects whitespace errors in staged changes.
