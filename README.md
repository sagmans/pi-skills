# pi-skills
Better skill usage in Pi

## Development

Run once per clone to enable the tracked Git hooks:

```sh
sh scripts/setup-hooks.sh
```

The hooks in `.githooks/` run your global Git hooks first (if any), then this
repository's checks. `pre-commit` rejects whitespace errors in staged changes.
