# Contributing

Thanks for improving pi-skills.

## Development

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
```

`npm test` runs the Node test runner over `test/*.test.ts`; no other tooling is
required. Keep modules pure where practical — SDK/terminal glue stays in
`src/index.ts`.

Run `scripts/setup-hooks` once per clone. The local Git hooks are the only
gate: there is no hosted CI, and `pre-push` runs the type check, the tests and
the dependency checks on each pushed commit. The hooks also need gitleaks,
osv-scanner, semgrep, lizard and markdownlint-cli2 installed; a missing tool
blocks the hook. Never use `--no-verify`.

## Committing

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …).
- Sign commits and include DCO sign-off: `git commit -s -S`.
- Keep changes atomic; one purpose per commit.

## Compatibility

The extension reflects into one private Pi API (editor autocomplete trigger).
Any change to `src/editor.ts` or the supported range in `src/compat.ts` must
state how it was validated against the pinned Pi version in
`package.json` devDependencies.
