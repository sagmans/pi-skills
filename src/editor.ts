import {
	CustomEditor,
	type AppKeybinding,
	type ExtensionUIContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteProvider,
	EditorComponent,
	EditorTheme,
	TUI,
} from "@earendil-works/pi-tui";

/** Printable trigger that starts inline skill completion. */
export const SKILL_COMPLETION_TRIGGER = "$";

// Pi does not expose a public "open autocomplete now" method to extensions.
// The editor shim delegates all real editing behavior to the existing editor,
// then uses this private method name only to remove Pi's built-in
// start/whitespace boundary restriction for `$`.
const TRY_TRIGGER_AUTOCOMPLETE_METHOD = "tryTriggerAutocomplete";
const WRAPPED_EDITOR_INNER_KEY = "inner";
const MAX_EDITOR_UNWRAP_DEPTH = 8;

type EditorComponentFactory = NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]>;

type WrappedEditor = EditorComponent & {
	actionHandlers?: Map<AppKeybinding, () => void>;
	disableSubmit?: boolean;
	focused?: boolean;
	onCtrlD?: () => void;
	onEscape?: () => void;
	onExtensionShortcut?: (data: string) => boolean;
	onPasteImage?: () => void;
};

export interface SkillCompletionEditorOptions {
	onAutocompleteUnavailable?(): void;
}

/** Only a single `$` keystroke should force skill completion. */
export const shouldForceSkillAutocomplete = (data: string): boolean =>
	data === SKILL_COMPLETION_TRIGGER;

/**
 * Follow common editor-wrapper chains to the editor that owns cursor state.
 * Existing Pi editor wrappers store their delegated editor in an `inner` field;
 * this bounded walk keeps `$` completion compatible with those wrappers without
 * depending on a specific extension.
 */
export const findAutocompleteTarget = (editor: object): object => {
	let target = editor;
	const seen = new Set<object>();
	for (let depth = 0; depth < MAX_EDITOR_UNWRAP_DEPTH; depth += 1) {
		if (seen.has(target)) return target;
		seen.add(target);
		const inner = Reflect.get(target, WRAPPED_EDITOR_INNER_KEY);
		if (inner === null || typeof inner !== "object") return target;
		target = inner;
	}
	return target;
};

/**
 * Invoke Pi's private autocomplete trigger if the current editor exposes it.
 * Returns whether the hook was found; callers can silently fall back otherwise.
 */
export const hasAutocompleteTrigger = (target: object): boolean =>
	typeof Reflect.get(target, TRY_TRIGGER_AUTOCOMPLETE_METHOD) === "function";

export const forceAutocompleteIfAvailable = (target: object): boolean => {
	// Reflection on private shape can throw on exotic objects (proxies, sealed);
	// failing closed keeps the editor usable and reports degradation once.
	try {
		const trigger = Reflect.get(target, TRY_TRIGGER_AUTOCOMPLETE_METHOD);
		if (typeof trigger !== "function") return false;
		Reflect.apply(trigger, target, []);
		return true;
	} catch {
		return false;
	}
};

class SkillCompletionEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly inner: WrappedEditor,
		private readonly options: SkillCompletionEditorOptions,
	) {
		super(tui, theme, keybindings);
	}

	private syncEditorState(): void {
		// Best-effort mirroring: a throwing getter on an exotic prior editor must
		// not take down rendering — skipping sync only loses cosmetic state.
		try {
		if (this.inner.actionHandlers instanceof Map) {
			this.inner.actionHandlers.clear();
			for (const [action, handler] of this.actionHandlers) {
				this.inner.actionHandlers.set(action, handler);
			}
		}
		this.inner.borderColor = this.borderColor;
		this.inner.disableSubmit = this.disableSubmit;
		this.inner.focused = this.focused;
		this.inner.onChange = this.onChange;
		this.inner.onCtrlD = this.onCtrlD;
		this.inner.onEscape = this.onEscape;
		this.inner.onExtensionShortcut = this.onExtensionShortcut;
		this.inner.onPasteImage = this.onPasteImage;
		this.inner.onSubmit = this.onSubmit;
		} catch {
			// Deliberately silent; see comment at top of syncEditorState.
		}
	}

	override render(width: number): string[] {
		this.syncEditorState();
		return this.inner.render(width);
	}

	override handleInput(data: string): void {
		const shouldForce = shouldForceSkillAutocomplete(data);
		this.syncEditorState();
		this.inner.handleInput(data);
		if (!shouldForce) return;
		if (!forceAutocompleteIfAvailable(findAutocompleteTarget(this.inner))) {
			this.options.onAutocompleteUnavailable?.();
		}
	}

	override invalidate(): void {
		this.inner.invalidate();
	}

	override getText(): string {
		return this.inner.getText();
	}

	override setText(text: string): void {
		this.inner.setText(text);
	}

	override addToHistory(text: string): void {
		this.inner.addToHistory?.(text);
	}

	override insertTextAtCursor(text: string): void {
		this.inner.insertTextAtCursor?.(text);
	}

	override getExpandedText(): string {
		return this.inner.getExpandedText?.() ?? this.inner.getText();
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.inner.setAutocompleteProvider?.(provider);
	}

	override setPaddingX(padding: number): void {
		this.inner.setPaddingX?.(padding);
	}

	override setAutocompleteMaxVisible(maxVisible: number): void {
		this.inner.setAutocompleteMaxVisible?.(maxVisible);
	}
}

/** Build an editor wrapper that preserves existing editor behavior and adds `$` completion. */
export const createSkillCompletionEditorFactory = (
	previousFactory: EditorComponentFactory | undefined,
	options: SkillCompletionEditorOptions = {},
): EditorComponentFactory => {
	let unavailableReported = false;
	const reportUnavailable = () => {
		if (unavailableReported) return;
		unavailableReported = true;
		options.onAutocompleteUnavailable?.();
	};
	return (tui, theme, keybindings) => {
		// Pi clears the previous editor before invoking a replacement factory, so
		// any throw here would leave the app with NO editor. Every path below must
		// return a usable editor.
		let inner: WrappedEditor;
		try {
			inner = previousFactory
				? previousFactory(tui, theme, keybindings)
				: new CustomEditor(tui, theme, keybindings);
		} catch {
			inner = new CustomEditor(tui, theme, keybindings);
		}
		if (!hasAutocompleteTrigger(findAutocompleteTarget(inner))) reportUnavailable();
		try {
			return new SkillCompletionEditor(tui, theme, keybindings, inner, {
				onAutocompleteUnavailable: reportUnavailable,
			});
		} catch {
			return inner;
		}
	};
};
