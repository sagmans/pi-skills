import { type Skill } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	fuzzyFilter,
	matchesKey,
	truncateToWidth,
	type Component,
	type Focusable,
} from "@earendil-works/pi-tui";

import { SkillQueue } from "./queue.ts";

// Fuzzy multi-select overlay for attaching skills.
//
// Interaction (finalised with the user):
//   type        -> fuzzy-filter the list
//   Up / Down    -> move focus
//   Tab          -> toggle the focused skill in the working set
//   Enter        -> commit the working set and close
//   Esc / Ctrl+C -> cancel (working changes discarded, existing queue kept)
//
// The working set starts from the current queue so re-opening the picker
// (prefix+k again) lets the user review and modify what is already attached.
// Pure helpers (classifyPickerKey, fuzzySkillFilter, scrollWindow) are split
// out so they can be unit-tested without a Theme or terminal.

/** Narrow theme surface the component depends on; real Theme satisfies it. */
export interface PickerTheme {
	fg(color: string, text: string): string;
	/** Optional reverse-video for the caret; defaults to an SGR escape. */
	reverse?(text: string): string;
}

export type PickerKeyAction =
	| { kind: "noop" }
	| { kind: "type"; ch: string }
	| { kind: "backspace" }
	| { kind: "cursorLeft" }
	| { kind: "cursorRight" }
	| { kind: "up" }
	| { kind: "down" }
	| { kind: "toggle" }
	| { kind: "commit" }
	| { kind: "cancel" };

type PickerKeyId = Parameters<typeof matchesKey>[1];

const STATIC_KEY_ACTIONS: Array<{ keys: PickerKeyId[]; action: PickerKeyAction }> = [
	{ keys: ["escape", "ctrl+c"], action: { kind: "cancel" } },
	{ keys: ["return", "enter"], action: { kind: "commit" } },
	{ keys: ["tab"], action: { kind: "toggle" } },
	{ keys: ["up"], action: { kind: "up" } },
	{ keys: ["down"], action: { kind: "down" } },
	{ keys: ["backspace"], action: { kind: "backspace" } },
	{ keys: ["left"], action: { kind: "cursorLeft" } },
	{ keys: ["right"], action: { kind: "cursorRight" } },
];

const staticPickerAction = (data: string): PickerKeyAction | undefined =>
	STATIC_KEY_ACTIONS.find(({ keys }) => keys.some((key) => matchesKey(data, key)))?.action;

const typedPickerAction = (data: string): PickerKeyAction | undefined =>
	data.length === 1 && data.charCodeAt(0) >= 32 ? { kind: "type", ch: data } : undefined;

/** Map raw terminal input to a picker action. Pure: no state, no I/O. */
export const classifyPickerKey = (data: string): PickerKeyAction =>
	staticPickerAction(data) ?? typedPickerAction(data) ?? { kind: "noop" };

/** Fuzzy-filter and rank skills by query over their name + description. */
export const fuzzySkillFilter = (skills: readonly Skill[], query: string): Skill[] => {
	const trimmed = query.trim();
	if (trimmed.length === 0) return [...skills];
	return fuzzyFilter([...skills], trimmed, (skill) => `${skill.name} ${skill.description}`);
};

/** Clamp a cursor into [0, len). */
export const clampCursor = (cursor: number, len: number): number => {
	if (len <= 0) return 0;
	if (cursor < 0) return 0;
	if (cursor >= len) return len - 1;
	return cursor;
};

/** Sliding window of [start, end) around the cursor for scroll rendering. */
export const scrollWindow = (
	cursor: number,
	len: number,
	maxVisible: number,
): { start: number; end: number } => {
	if (len <= 0 || maxVisible <= 0) return { start: 0, end: 0 };
	const visible = Math.min(maxVisible, len);
	let start = Math.max(0, cursor - Math.floor(visible / 2));
	const endLimit = start + visible;
	if (endLimit > len) start = Math.max(0, len - visible);
	return { start, end: start + visible };
};

interface QueryEditState {
	query: string;
	cursor: number;
}

interface QueryEditAction {
	kind: PickerKeyAction["kind"];
	ch?: string;
}

type QueryEditHandler = (state: QueryEditState, action: QueryEditAction) => QueryEditState;

const insertQueryChar: QueryEditHandler = ({ query, cursor }, { ch = "" }) => ({
	query: query.slice(0, cursor) + ch + query.slice(cursor),
	cursor: cursor + ch.length,
});

const deleteQueryChar: QueryEditHandler = ({ query, cursor }) => {
	if (cursor <= 0) return { query, cursor };
	return {
		query: query.slice(0, cursor - 1) + query.slice(cursor),
		cursor: cursor - 1,
	};
};

const moveQueryCursorLeft: QueryEditHandler = ({ query, cursor }) => ({
	query,
	cursor: Math.max(0, cursor - 1),
});

const moveQueryCursorRight: QueryEditHandler = ({ query, cursor }) => ({
	query,
	cursor: Math.min(query.length, cursor + 1),
});

const keepQueryState: QueryEditHandler = ({ query, cursor }) => ({ query, cursor });

const QUERY_EDIT_HANDLERS = new Map<PickerKeyAction["kind"], QueryEditHandler>([
	["type", insertQueryChar],
	["backspace", deleteQueryChar],
	["cursorLeft", moveQueryCursorLeft],
	["cursorRight", moveQueryCursorRight],
	["noop", keepQueryState],
	["up", keepQueryState],
	["down", keepQueryState],
	["toggle", keepQueryState],
	["commit", keepQueryState],
	["cancel", keepQueryState],
]);

const queryEditHandler = (kind: PickerKeyAction["kind"]): QueryEditHandler =>
	QUERY_EDIT_HANDLERS.get(kind) ?? keepQueryState;

/** Insert/replace at a cursor position; returns new value + new cursor. Pure. */
const applyQueryEdit = (
	query: string,
	cursor: number,
	action: QueryEditAction,
): QueryEditState => queryEditHandler(action.kind)({ query, cursor }, action);

export { applyQueryEdit as editQuery };

export interface PickerComponentOptions {
	maxVisible?: number;
	width?: number;
}

const DEFAULT_PICKER_WIDTH = 64;
// Absolute floor for pathological terminal widths; the TUI contract requires
// every rendered line to fit the width Pi hands us, so the floor never exceeds
// the real available width (see layout).
const MIN_PICKER_INNER_WIDTH = 2;
const DEFAULT_MAX_VISIBLE = 12;
const DEFAULT_TRUNCATION_ELLIPSIS = "...";
const QUERY_EDIT_ACTION_KINDS = new Set<PickerKeyAction["kind"]>([
	"type",
	"backspace",
	"cursorLeft",
	"cursorRight",
]);

interface PickerLayout {
	innerWidth: number;
	maxVisible: number;
}

type PickerRowRenderer = (content: string) => string;

const isQueryEditAction = (action: PickerKeyAction): boolean =>
	QUERY_EDIT_ACTION_KINDS.has(action.kind);

const sameQueryState = (left: QueryEditState, right: QueryEditState): boolean =>
	left.query === right.query && left.cursor === right.cursor;

const pickerBorder = (theme: PickerTheme, left: string, innerWidth: number, right: string): string =>
	theme.fg("border", `${left}${"─".repeat(innerWidth)}${right}`);

const pickerRow = (theme: PickerTheme, innerWidth: number): PickerRowRenderer =>
	(content) =>
		`${theme.fg("border", "│")}${truncateToWidth(content, innerWidth, DEFAULT_TRUNCATION_ELLIPSIS, true)}${theme.fg("border", "│")}`;

const selectedText = (theme: PickerTheme, focused: boolean, text: string): string =>
	focused ? theme.fg("accent", text) : theme.fg("text", text);

export class SkillPickerComponent implements Component, Focusable {
	/** Focusable interface - set by TUI when focus changes. */
	focused = false;

	private query = "";
	private cursor = 0;
	private viewCursor = 0;
	private readonly work: SkillQueue;
	private filtered: readonly Skill[];

	constructor(
		private readonly skills: readonly Skill[],
		current: readonly string[],
		private readonly theme: PickerTheme,
		private readonly done: (result?: string[]) => void,
		private readonly options: PickerComponentOptions = {},
	) {
		// Only carry over names that still exist; stale entries would render as
		// phantom toggles with no matching skill.
		this.work = new SkillQueue(current.filter((name) => skills.some((s) => s.name === name)));
		this.filtered = fuzzySkillFilter(skills, "");
	}

	handleInput(data: string): void {
		const action = classifyPickerKey(data);
		if (this.handleDoneAction(action)) return;
		if (this.handleMoveAction(action)) return;
		this.handleQueryAction(action);
	}

	render(width: number): string[] {
		const layout = this.layout(width);
		const row = pickerRow(this.theme, layout.innerWidth);
		return [
			pickerBorder(this.theme, "╭", layout.innerWidth, "╮"),
			...this.renderHeader(row, layout.innerWidth),
			...this.renderQuery(row, layout.innerWidth),
			...this.renderSkillRows(row, layout.maxVisible),
			pickerBorder(this.theme, "╰", layout.innerWidth, "╯"),
		];
	}

	invalidate(): void {
		this.filtered = fuzzySkillFilter(this.skills, this.query);
	}

	private layout(width: number): PickerLayout {
		const desired = this.options.width ?? DEFAULT_PICKER_WIDTH;
		// Never exceed the width Pi supplies; the configured width is only a cap
		// for wide terminals. The floor is clamped to that width as well so the
		// narrowest terminals still render lines that fit.
		const effective = Math.min(desired, Math.max(width, MIN_PICKER_INNER_WIDTH + 2));
		return {
			innerWidth: Math.max(MIN_PICKER_INNER_WIDTH, effective - 2),
			maxVisible: this.options.maxVisible ?? DEFAULT_MAX_VISIBLE,
		};
	}

	private handleDoneAction(action: PickerKeyAction): boolean {
		if (action.kind === "cancel") return this.cancel();
		if (action.kind === "commit") return this.commit();
		if (action.kind === "toggle") return this.toggleFocused();
		return false;
	}

	private handleMoveAction(action: PickerKeyAction): boolean {
		if (action.kind === "up") return this.moveViewCursor(-1);
		if (action.kind === "down") return this.moveViewCursor(1);
		return false;
	}

	private handleQueryAction(action: PickerKeyAction): void {
		if (!isQueryEditAction(action)) return;
		const current = { query: this.query, cursor: this.cursor };
		const next = applyQueryEdit(this.query, this.cursor, action);
		if (sameQueryState(next, current)) return;
		this.query = next.query;
		this.cursor = next.cursor;
		this.filtered = fuzzySkillFilter(this.skills, this.query);
		this.viewCursor = clampCursor(this.viewCursor, this.filtered.length);
	}

	private cancel(): true {
		this.done();
		return true;
	}

	private commit(): true {
		this.done([...this.work.list()]);
		return true;
	}

	private toggleFocused(): true {
		const item = this.filtered[this.viewCursor];
		if (item) this.work.toggle(item.name);
		return true;
	}

	private moveViewCursor(delta: number): true {
		this.viewCursor = clampCursor(this.viewCursor + delta, this.filtered.length);
		return true;
	}

	private renderHeader(row: PickerRowRenderer, innerWidth: number): string[] {
		const title = ` ${this.theme.fg("accent", "Skills")} ${this.theme.fg("dim", "— Tab toggle • Enter attach • Esc cancel")}`;
		return [row(title), pickerBorder(this.theme, "├", innerWidth, "┤")];
	}

	private renderQuery(row: PickerRowRenderer, innerWidth: number): string[] {
		const before = this.query.slice(0, this.cursor);
		const cursorChar = this.cursor < this.query.length ? this.query[this.cursor] : " ";
		const after = this.query.slice(this.cursor + 1);
		// Focused overlays must tell Pi where the cursor is via CURSOR_MARKER,
		// placed immediately before the fake caret (docs/tui.md contract).
		const caret = (this.focused ? CURSOR_MARKER : "") + this.reverse(cursorChar);
		return [
			row(` ${this.theme.fg("dim", "filter:")} ${before}${caret}${after}`),
			row(""),
			pickerBorder(this.theme, "├", innerWidth, "┤"),
		];
	}

	private renderSkillRows(row: PickerRowRenderer, maxVisible: number): string[] {
		if (this.filtered.length === 0) return [row(` ${this.theme.fg("dim", "no skills match")}`)];
		const { start, end } = scrollWindow(this.viewCursor, this.filtered.length, maxVisible);
		return this.filtered
			.slice(start, end)
			.map((skill, offset) => this.renderSkillRow(row, skill, start + offset === this.viewCursor));
	}

	private renderSkillRow(row: PickerRowRenderer, skill: Skill, focused: boolean): string {
		const on = this.work.has(skill.name);
		const bullet = on ? this.theme.fg("success", "●") : this.theme.fg("dim", "○");
		const pointer = focused ? this.theme.fg("accent", "▶") : " ";
		const name = selectedText(this.theme, focused, skill.name);
		return row(` ${pointer} ${bullet} ${name} ${this.theme.fg("dim", skill.description)}`);
	}

	private reverse(text: string): string {
		return this.theme.reverse?.(text) ?? `\x1b[7m${text}\x1b[27m`;
	}
}
