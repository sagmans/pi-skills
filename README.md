# pi-skills

Better skill usage in Pi.

Attach multiple Agent Skills to a single prompt — via a fuzzy picker, inline
`$`-references, or slash commands — then submit.

Pi's built-in `/skill:name` loads one skill at a time. pi-skills offers three
ways to attach several skills at once and have them all injected into the
agent's context — each rendered to the same `<skill>` envelope Pi produces —
when you submit your next prompt. The injection is hidden: nothing spills into
the chat, so the TUI stays clean and the attach is one-shot.

Package: `@sagmans/pi-skills` · License: MIT

## Requirements

- Pi `>=0.84.2 <0.85` (tested against 0.84.4). The extension reflects into one
  private Pi API for `$`-completion (see *Version gate* below) and refuses to
  run on untested host ranges.
- Node `>=22.19`.
- Optional: an external `prefix-keybindings` extension adds a second picker
  shortcut (**Ctrl+X k**). Without it, everything still works via the built-in
  shortcut and commands.

## Usage

1. Press **Ctrl+Alt+k** (or **Ctrl+X k** with prefix-keybindings) to open the
   fuzzy skill picker (an overlay). `/pi-skills pick` does the same.
2. **Type** to fuzzy-filter; **Up/Down** to move focus.
3. **Tab** toggles the focused skill on/off; **Enter** commits the whole
   selection and closes; **Esc** / **Ctrl+C** cancels (keeps the prior queue).
4. Reopen anytime to review or modify the attached set (stateful — your current
   selection is preserved).
5. Type your prompt and submit. All attached skills are injected into the
   agent's context for that turn (hidden from the chat), then the queue clears
   (one-shot).

The attached set is shown as a widget above the editor (e.g. `◆ caveman ◆
review`).

### Inline `$`-completion

Type `$` anywhere in the editor to pop up a fuzzy skill list, filter as you
type, and **Tab**/**Enter** to insert a `$<skill>` reference. Several can be
inline in one prompt (`$caveman $tdd explain …`). Pi normally auto-triggers
symbol completion only at start/whitespace boundaries, so pi-skills installs a
tiny editor shim that forces Pi's existing autocomplete UI after `$` while
preserving normal editor behavior. The shim is exception-safe: if the private
trigger is missing or misbehaves, `$`-completion degrades with one warning and
the rest of the extension keeps working.

On submit, known `$<skill>` tokens are stripped from the prompt and the named
skills are fed into the same queue as the picker. Unknown `$NAME` text is left
literal, so shell/env examples like `$HOME` are not corrupted. `$5` and a bare
`$` stay literal (a reference must start with a letter).

### Slash command

```text
/pi-skills                 list attached skills
/pi-skills pick            open the fuzzy skill picker
/pi-skills <name>          attach/detach a skill
/pi-skills toggle <name>   attach/detach a skill
/pi-skills status          skills indexed, attached, $-completion state
/pi-skills clear           detach all skills
/pi-skills help            show usage
```

## Behavior

- **One-shot:** attached skills apply only to the next submitted prompt, then
  the queue drains — identical intent to inline `/skill:name` invocations.
- **Hidden context injection:** skills are delivered through Pi's `context`
  event, which clones the provider-bound messages per request. The bodies never
  reach the session or the chat; an "Injected N skill(s)" notification is the
  only visible trace.
- **Exact queue lifecycle:** prompts that never reach a provider request (slash
  commands, aborted before first context build) do not consume the queue. The
  first provider-bound context of a turn drains the queue and snapshots the
  skills; repeated provider calls within that turn reuse the snapshot. If the
  turn later fails or aborts, the selection is not restored. `turn_end` clears
  the snapshot.
- **Faithful envelope:** each skill is rendered to the same `<skill>` envelope
  Pi produces (frontmatter stripped, "References are relative to …" hint).
- **Two attach paths, one queue:** picker and inline `$<skill>` references feed
  the same queue and can be mixed freely. `$`-tokens are stripped from the
  submitted prompt (via Pi's `input` event) before it is persisted.

### Version gate

The editor shim reflects into a private Pi method. To keep untested hosts safe,
the extension checks Pi's version on every session start:

- Outside `>=0.84.2 <0.85`: one warning, then fully inert (no events, no UI,
  commands restate the reason).
- Inside the range but private trigger missing: `$`-completion turns itself
  off with one warning; picker, commands, and injection keep working.

The supported range advances only after each new Pi release is validated.

## Skill discovery

Skills are loaded from a re-derived index of Pi's resource defaults: global
`~/.pi/agent/skills/` and `~/.agents/skills/`, project `.pi/skills/` and
`.agents/skills/`, local skill settings, plus skills bundled inside configured
**packages** (`npm:`/`git:`/URL entries in `settings.json`). Package paths,
package `pi.skills` manifests, and settings filters are resolved with Pi's own
`DefaultPackageManager`; missing packages are skipped — pi-skills never
installs packages during indexing. The index is refreshed on every session
start.

Not included: skills other extensions inject via `resources_discover` (Pi's
extension API does not expose the aggregated list) and runtime `--skill` paths.

## Prior art

| Project | Difference |
| --- | --- |
| [badlogic/pi-skills](https://github.com/badlogic/pi-skills) | A collection of skill *content*; this extension is attach *tooling*. |
| [pi-skills-mention](https://pi.dev/packages/pi-skills-mention) | Codex-style `$` mentions with visible expansion; keeps prompt tokens. |
| [pi-skillrefs](https://www.npmjs.com/package/pi-skillrefs) | Keeps `$token` visible, injects visible context every turn. |
| [@tunglam/pi-inline-skills](https://www.npmjs.com/package/@tunglam/pi-inline-skills) | Visible body injection alongside the message. |

pi-skills differs by stripping known tokens, injecting **hidden one-shot**
context via the `context` event, and providing an explicit queue with a
multi-select picker and stateful re-open.

## Development

Checks run in tracked local Git hooks. Run `scripts/setup-hooks` once after
cloning; it points this clone's `core.hooksPath` at `.githooks`. Each hook runs
the generic checks first (sign-off and commit message format, a gitleaks secret
scan, and signed, signed-off commits on push), then this repository's checks in
`.githooks/<hook>.d/` in name order. Install
[gitleaks](https://github.com/gitleaks/gitleaks) first. Every check must pass
before you push; never use `--no-verify`. Pre-push checks test exactly each
pushed commit: in place only when it is the clean, unmodified checkout,
otherwise in a temporary worktree of that commit. `pre-commit` rejects
whitespace errors in staged changes.

## Validation

From this directory:

```bash
npm ci --ignore-scripts
npm test            # node --experimental-transform-types --test test/*.test.ts
npm run typecheck
```

## License

MIT — see [LICENSE](LICENSE).
