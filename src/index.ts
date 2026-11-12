import {
	VERSION,
	type ContextEvent,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEvent,
	type InputEventResult,
	type Theme,
} from "@earendil-works/pi-coding-agent";

import { startBinding } from "./binding.ts";
import { SUPPORTED_PI_MAX_EXCLUSIVE, SUPPORTED_PI_MIN, isSupportedPiVersion } from "./compat.ts";
import { createSkillAutocompleteProvider } from "./completion.ts";
import { parsePiSkillsArgs, runPiSkillsCommand } from "./commands.ts";
import { createSkillCompletionEditorFactory } from "./editor.ts";
import { injectSkills, type SkillSnapshot } from "./inject.ts";
import { extractKnownSkillRefs } from "./parse.ts";
import { SkillPickerComponent } from "./picker.ts";
import { SkillQueue } from "./queue.ts";
import {
	loadSkillIndex,
	resolveSkillBlocks,
	type SkillDiagnostics,
	type SkillIndex,
} from "./skills.ts";
import { PI_SKILLS_WIDGET_KEY, renderQueueWidget } from "./widget.ts";

const PREFIX_KEY = "k";
// Own shortcut keeps the picker reachable without prefix-keybindings; the
// prefix claim stays as an optional alias for users who have that extension.
const PICKER_SHORTCUT = "ctrl+alt+k";

// The skill bodies are injected as a user-role message placed immediately before
// the latest user turn. Pi's `context` event (runner.emitContext →
// agent-harness transformContext) clones the message array per provider request,
// so this injection is EPHEMERAL: it reaches the model for the current turn only
// and is never written to the session, keeping the TUI clean and the attach
// one-shot (the queue is drained the moment a turn actually consumes it).

// Module-level session state. Pi reuses the extension process across reloads, so
// the attached-skill queue intentionally survives a /reload; the skill index is
// refreshed on every session_start to pick up newly added or removed skills.
const queue = new SkillQueue();
let skillIndex: SkillIndex = [];
let skillNames = new Set<string>();
let stopBinding: (() => void) | undefined;
// Status-only: reports the last autocomplete/editor registration attempt to
// /pi-skills status. It is NOT a registration gate. Pi's resetExtensionUI (a
// beforeSessionInvalidate hook) empties extension autocomplete/editor wrappers
// right before every session_start, so re-registering each time is safe and
// necessary after reloads.
let autocompleteRegistered = false;
// Skills snapshotted for the in-flight turn. Resolved once (on the first
// `context` fire of the turn, which also drains the queue) and reused for every
// subsequent provider request within the same turn so tool-use sub-requests keep
// the context. Cleared at turn_end.
let pending: SkillSnapshot | null = null;
// Set when the running Pi host is outside the supported range; every feature
// stays inert (handlers naturally no-op on empty state) and commands restate it.
let unsupportedReason: string | undefined;
// Serializes picker opens so overlapping triggers (own shortcut + prefix
// extension event) cannot stack two overlays over the same queue.
let pickerOpen = false;

type UI = NonNullable<ExtensionContext["ui"]>;
type SkillContextResult = { messages?: ContextEvent["messages"] };

const syncWidget = (ui: UI | undefined): void => {
	ui?.setWidget?.(PI_SKILLS_WIDGET_KEY, renderQueueWidget(queue.list()), {
		placement: "aboveEditor",
	});
};

const notifyMissing = (ui: UI | undefined, missing: readonly string[]): void => {
	for (const name of missing) ui?.notify?.(`Skill not found, skipped: ${name}`, "warning");
};

const notifySkillDiagnostics = (ui: UI | undefined, diagnostics: SkillDiagnostics): void => {
	if (diagnostics.length === 0) return;
	const first = diagnostics[0];
	const path = first.path ? ` (${first.path})` : "";
	ui?.notify?.(
		`pi-skills: ${diagnostics.length} skill warning(s); first: ${first.message}${path}`,
		"warning",
	);
};

const openPicker = async (ctx: ExtensionContext): Promise<void> => {
	if (pickerOpen) return;
	pickerOpen = true;
	try {
	const ui = ctx.ui;
	if (!ui?.custom) {
		ui?.notify?.("pi-skills picker unavailable in this mode", "warning");
		return;
	}
	if (skillIndex.length === 0) {
		ui.notify("No skills discovered", "warning");
		return;
	}
	// The picker works on a copy of the current queue; Enter writes the whole
	// working set back atomically (stateful re-open), Esc leaves it untouched.
	const result = await ui.custom<string[] | undefined>(
		(_tui, theme: Theme, _kb, done) =>
			new SkillPickerComponent(skillIndex, queue.list(), theme, done),
		{ overlay: true },
	);
	if (!result) return;

	queue.replace(result);
	syncWidget(ui);
	ui.notify(
		result.length > 0 ? `Attached ${result.length} skill(s)` : "Skill queue cleared",
		"info",
	);
	} finally {
		pickerOpen = false;
	}
};

const resetSkillIndex = (): void => {
	skillIndex = [];
	skillNames = new Set();
};

const refreshSkillIndex = async (ctx: ExtensionContext): Promise<void> => {
	// A malformed skill file must not break session start; keep the valid skills
	// and surface diagnostics so missing picker entries are debuggable.
	try {
		const result = await loadSkillIndex({
			cwd: ctx.cwd ?? process.cwd(),
			projectTrusted: ctx.isProjectTrusted(),
		});
		skillIndex = result.skills;
		skillNames = new Set(result.skills.map((skill) => skill.name));
		notifySkillDiagnostics(ctx.ui, result.diagnostics);
	} catch (err) {
		resetSkillIndex();
		ctx.ui?.notify?.(`pi-skills: failed to load skill index: ${String(err)}`, "warning");
	}
};

const handlePickerError = (ctx: ExtensionContext, err: unknown): void => {
	ctx.ui?.notify?.(`pi-skills picker error: ${String(err)}`, "error");
};

const bindPicker = (pi: ExtensionAPI, ctx: ExtensionContext): void => {
	stopBinding?.();
	stopBinding = startBinding({
		events: pi.events,
		prefixKey: PREFIX_KEY,
		onAction: () => {
			openPicker(ctx).catch((err) => handlePickerError(ctx, err));
		},
		onInert: () => {
			ctx.ui?.notify?.(
				"pi-skills: prefix-keybindings not detected, Ctrl+X k disabled",
				"warning",
			);
		},
	});
};

const installAutocomplete = (ctx: ExtensionContext): void => {
	// Re-stack `$` completion on every session_start. Safe because resetExtensionUI
	// clears extension UI hooks before session_start fires. The provider supplies
	// suggestions; the editor shim forces Pi's existing autocomplete UI to open
	// even when `$` is typed mid-token.
	try {
		let completionAvailable = true;
		const markCompletionUnavailable = () => {
			completionAvailable = false;
			autocompleteRegistered = false;
			ctx.ui?.notify?.(
				"pi-skills: $-completion unavailable: Pi editor autocomplete trigger API changed",
				"warning",
			);
		};
		ctx.ui.addAutocompleteProvider(createSkillAutocompleteProvider(() => skillIndex));
		ctx.ui.setEditorComponent(
			createSkillCompletionEditorFactory(ctx.ui.getEditorComponent(), {
				onAutocompleteUnavailable: markCompletionUnavailable,
			}),
		);
		autocompleteRegistered = completionAvailable;
	} catch (err) {
		autocompleteRegistered = false;
		ctx.ui?.notify?.(`pi-skills: $-completion unavailable: ${String(err)}`, "warning");
	}
};

const handleSessionStart = async (pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> => {
	pending = null;
	// Private-API reliance (editor shim) makes untested hosts unsafe; degrade
	// loudly instead of risking a broken editor on an unvalidated Pi build.
	if (!isSupportedPiVersion(VERSION)) {
		unsupportedReason =
			"pi-skills: Pi " + VERSION + " is unsupported (supported " +
			SUPPORTED_PI_MIN + "..<" + SUPPORTED_PI_MAX_EXCLUSIVE + "); extension is inert";
		ctx.ui?.notify?.(unsupportedReason, "warning");
		return;
	}
	unsupportedReason = undefined;
	await refreshSkillIndex(ctx);
	if (!ctx.hasUI) return;
	bindPicker(pi, ctx);
	syncWidget(ctx.ui);
	installAutocomplete(ctx);
};

const handleSessionShutdown = (): void => {
	pending = null;
	stopBinding?.();
	stopBinding = undefined;
};

const attachInlineSkillRefs = (event: InputEvent): InputEventResult => {
	const { names, stripped } = extractKnownSkillRefs(event.text, skillNames);
	if (names.length === 0) return { action: "continue" };
	for (const name of names) queue.add(name);
	return { action: "transform", text: stripped };
};

const prepareSnapshot = (ctx: ExtensionContext): SkillSnapshot | undefined => {
	// Subsequent fire in the same turn: re-inject from the snapshot so tool-use
	// sub-requests keep the skills, with no queue/UI/notify churn.
	if (pending) return pending;
	if (queue.size === 0) return undefined;
	// First fire of the turn: resolve queued skills, drain, snapshot, notify.
	const resolved = resolveSkillBlocks(queue.list(), skillIndex);
	queue.clear();
	syncWidget(ctx.ui);
	notifyMissing(ctx.ui, resolved.missing);
	if (resolved.blocks.length === 0) return undefined;
	pending = { blocks: resolved.blocks, names: resolved.names };
	ctx.ui?.notify?.(
		`Injected ${resolved.names.length} skill(s): ${resolved.names.join(", ")}`,
		"info",
	);
	return pending;
};

const injectQueuedSkills = (
	event: ContextEvent,
	ctx: ExtensionContext,
): SkillContextResult | undefined => {
	try {
		const snapshot = prepareSnapshot(ctx);
		return snapshot ? { messages: injectSkills(event.messages, snapshot.blocks) } : undefined;
	} catch (err) {
		// Never crash the provider request; surface and degrade to passthrough.
		ctx.ui?.notify?.(`pi-skills: injection failed: ${String(err)}`, "warning");
		return undefined;
	}
};

const clearPendingSnapshot = (): void => {
	pending = null;
};

const runCommand = (args: string, ctx: ExtensionContext): void => {
	if (unsupportedReason) {
		ctx.ui?.notify?.(unsupportedReason, "warning");
		return;
	}
	const outcome = runPiSkillsCommand(parsePiSkillsArgs(args), {
		queue,
		index: skillIndex,
		autocompleteRegistered,
		openPicker: () => {
			openPicker(ctx).catch((err) => handlePickerError(ctx, err));
		},
	});
	ctx.ui?.notify?.(outcome.message, outcome.level);
	syncWidget(ctx.ui);
};

const installPiSkills = (pi: ExtensionAPI): void => {
	pi.on("session_start", (_event, ctx) => handleSessionStart(pi, ctx));
	pi.on("session_shutdown", handleSessionShutdown);
	pi.on("input", attachInlineSkillRefs);
	pi.on("context", injectQueuedSkills);
	pi.on("turn_end", clearPendingSnapshot);
	pi.registerShortcut?.(PICKER_SHORTCUT, {
		description: "pi-skills: open the skill picker",
		handler: (ctx) => {
			openPicker(ctx).catch((err) => handlePickerError(ctx, err));
		},
	});
	pi.registerCommand("pi-skills", {
		description: "List, clear, or toggle skills attached to the next prompt",
		handler: (args, ctx) => {
			runCommand(args, ctx);
			return Promise.resolve();
		},
	});
};

export default installPiSkills;
