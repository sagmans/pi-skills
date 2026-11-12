import type { AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

import { fuzzySkillFilter } from "./picker.ts";
import type { SkillIndex } from "./skills.ts";

// `$`-triggered inline skill completion.
//
// Pi's editor wraps its base autocomplete provider (slash commands + file `@`
// completion) with extension factories via `addAutocompleteProvider`. This
// factory stacks a `$<name>` provider on top: when the token at the cursor is a
// `$`-reference it offers fuzzy-matched skills; otherwise it delegates to the
// base provider so `/` and `@` keep working unchanged. Picking a skill inserts
// `$<name> ` into the editor; the `input` handler (index.ts) later strips the
// token and feeds the name into the shared skill queue.

export interface SkillQuery {
	/** The text typed after `$` (may be empty). */
	query: string;
	/** Column of the `$` that started the reference. */
	startCol: number;
}

/**
 * If the cursor sits at the end of a `$<name>` reference, return the query text
 * and the column of the leading `$`. Otherwise null. Pure so the provider's
 * trigger/apply logic is unit-testable without the editor runtime.
 */
const isAsciiLetter = (ch: string): boolean =>
	(ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");

const isSkillQueryChar = (ch: string): boolean =>
	isAsciiLetter(ch) || (ch >= "0" && ch <= "9") || ch === "_" || ch === "-";

const isValidSkillQuery = (query: string): boolean =>
	query === "" || (isAsciiLetter(query[0] ?? "") && [...query].every(isSkillQueryChar));

export const extractSkillQuery = (
	lines: readonly string[],
	cursorLine: number,
	cursorCol: number,
): SkillQuery | null => {
	const line = lines[cursorLine];
	if (line === undefined) return null;
	const prefix = line.slice(0, cursorCol);
	const startCol = prefix.lastIndexOf("$");
	if (startCol < 0) return null;
	const query = prefix.slice(startCol + 1);
	return isValidSkillQuery(query) ? { query, startCol } : null;
};

type SuggestionsOptions = Parameters<AutocompleteProvider["getSuggestions"]>[3];
type CompletionResult = ReturnType<AutocompleteProvider["applyCompletion"]>;

const toSkillItem = (skill: SkillIndex[number]): AutocompleteItem => ({
	value: skill.name,
	label: skill.name,
	description: skill.description,
});

const skillSuggestions = (index: SkillIndex, query: string): AutocompleteSuggestions | null => {
	const skills = fuzzySkillFilter(index, query);
	if (skills.length === 0) return null;
	return { items: skills.map(toSkillItem), prefix: `$${query}` };
};

const applySkillCompletion = (
	lines: string[],
	cursorLine: number,
	item: AutocompleteItem,
	query: SkillQuery,
): CompletionResult => {
	const line = lines[cursorLine] ?? "";
	const before = line.slice(0, query.startCol);
	const after = line.slice(query.startCol + 1 + query.query.length);
	const insert = `$${item.value}`;
	// Add a trailing space only at end of line so the user can chain another
	// `$ref`; mid-line the existing separator (space/punctuation) suffices.
	const addSpace = after === "";
	const newLine = `${before}${insert}${addSpace ? " " : ""}${after}`;
	const newLines = [...lines];
	newLines[cursorLine] = newLine;
	return {
		lines: newLines,
		cursorLine,
		cursorCol: query.startCol + insert.length + (addSpace ? 1 : 0),
	};
};

class SkillAutocompleteProvider implements AutocompleteProvider {
	readonly triggerCharacters: string[];

	constructor(
		private readonly current: AutocompleteProvider,
		private readonly getIndex: () => SkillIndex,
	) {
		this.triggerCharacters = ["$", ...(current.triggerCharacters ?? [])];
	}

	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: SuggestionsOptions,
	): Promise<AutocompleteSuggestions | null> {
		const query = extractSkillQuery(lines, cursorLine, cursorCol);
		if (!query) return this.current.getSuggestions(lines, cursorLine, cursorCol, options);
		return Promise.resolve(skillSuggestions(this.getIndex(), query.query));
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): CompletionResult {
		const query = extractSkillQuery(lines, cursorLine, cursorCol);
		if (!query) return this.current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		return applySkillCompletion(lines, cursorLine, item, query);
	}

	shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
		return this.current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
	}
}

/**
 * Build an autocomplete factory that adds `$`-skill completion on top of the
 * base provider. `getIndex` is a getter so the provider always sees the freshly
 * reloaded skill index (session_start reassigns it on every session).
 */
export const createSkillAutocompleteProvider = (
	getIndex: () => SkillIndex,
): AutocompleteProviderFactory =>
	(current) => new SkillAutocompleteProvider(current, getIndex);
