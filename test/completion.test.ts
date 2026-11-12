import assert from "node:assert/strict";
import test from "node:test";

import type { Skill } from "@earendil-works/pi-coding-agent";

import { createSkillAutocompleteProvider, extractSkillQuery } from "../src/completion.ts";

// Minimal skill fixtures (only name + description matter for filtering).
function skill(name: string, description = ""): Skill {
	return { name, description, filePath: `/s/${name}/SKILL.md`, baseDir: `/s/${name}` } as Skill;
}
const INDEX: Skill[] = [
	skill("concise", "terse replies"),
	skill("tdd", "test first"),
	skill("code-review", "review code"),
];
const SIGNAL = new AbortController().signal;

/** A recording base provider so delegation to `/` and `@` completion is verifiable. */
function fakeBase() {
	let getSuggestionsCalls = 0;
	let applyCompletionCalls = 0;
	const provider = {
		triggerCharacters: ["/", "@"] as string[],
		getSuggestions: async () => {
			getSuggestionsCalls++;
			return { items: [{ value: "base", label: "base" }], prefix: "base" };
		},
		applyCompletion: (lines: string[], cl: number, cc: number) => {
			applyCompletionCalls++;
			return { lines, cursorLine: cl, cursorCol: cc };
		},
	};
	return { provider, getSuggestionsCalls: () => getSuggestionsCalls, applyCompletionCalls: () => applyCompletionCalls };
}

// --- extractSkillQuery ---

test("extractSkillQuery: bare $ at cursor triggers with empty query", () => {
	assert.deepEqual(extractSkillQuery(["$"], 0, 1), { query: "", startCol: 0 });
});

test("extractSkillQuery: $<query> returns the query and $ column", () => {
	assert.deepEqual(extractSkillQuery(["$ca"], 0, 3), { query: "ca", startCol: 0 });
});

test("extractSkillQuery: token inline in a line", () => {
	// "explain $concise" — cursor at end (col 16); $ is at col 8.
	assert.deepEqual(extractSkillQuery(["explain $concise"], 0, 16), { query: "concise", startCol: 8 });
});

test("extractSkillQuery: cursor mid-token returns the partial query", () => {
	// "$concise" with cursor after "$con" (col 4).
	assert.deepEqual(extractSkillQuery(["$concise"], 0, 4), { query: "con", startCol: 0 });
});

test("extractSkillQuery: $5 (digit after $) is not a skill query", () => {
	assert.equal(extractSkillQuery(["$5"], 0, 2), null);
});

test("extractSkillQuery: no $ returns null", () => {
	assert.equal(extractSkillQuery(["no dollar here"], 0, 14), null);
});

test("extractSkillQuery: bare $ mid-line triggers", () => {
	// "a $ b" — cursor right after $ (col 3).
	assert.deepEqual(extractSkillQuery(["a $ b"], 0, 3), { query: "", startCol: 2 });
});

test("extractSkillQuery: multi-line targets the cursor's line only", () => {
	assert.deepEqual(extractSkillQuery(["plain", "$ca"], 1, 3), { query: "ca", startCol: 0 });
	assert.equal(extractSkillQuery(["plain", "plain"], 1, 5), null);
});

test("extractSkillQuery: out-of-range cursor line returns null", () => {
	assert.equal(extractSkillQuery([], 0, 0), null);
});

// --- createSkillAutocompleteProvider ---

test("provider: triggerCharacters union $ with the base provider's", () => {
	const { provider: base } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	assert.deepEqual(wrapped.triggerCharacters, ["$", "/", "@"]);
});

test("provider: getSuggestions returns fuzzy-matched skills for a $ query", async () => {
	const { provider: base, getSuggestionsCalls } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	const res = await wrapped.getSuggestions(["$con"], 0, 4, { signal: SIGNAL });
	assert.deepEqual(
		res?.items.map((i) => i.value),
		["concise"],
	);
	assert.equal(getSuggestionsCalls(), 0, "must not delegate to the base when $ is active");
});

test("provider: bare $ returns all skills", async () => {
	const { provider: base } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	const res = await wrapped.getSuggestions(["$"], 0, 1, { signal: SIGNAL });
	assert.equal(res?.items.length, 3);
});

test("provider: getSuggestions delegates to base when no $ token", async () => {
	const { provider: base, getSuggestionsCalls } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	const res = await wrapped.getSuggestions(["/pi"], 0, 3, { signal: SIGNAL });
	assert.equal(getSuggestionsCalls(), 1);
	assert.equal(res?.items[0]?.value, "base");
});

test("provider: $ query matching nothing returns null", async () => {
	const { provider: base } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	const res = await wrapped.getSuggestions(["$zzz"], 0, 4, { signal: SIGNAL });
	assert.equal(res, null);
});

test("provider: applyCompletion inserts $<name> mid-line and moves the cursor", () => {
	const { provider: base, applyCompletionCalls } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	const res = wrapped.applyCompletion(
		["use $co now"],
		0,
		7,
		{ value: "concise", label: "concise" },
		"$co",
	);
	assert.deepEqual(res.lines, ["use $concise now"]);
	// cursor right after "$concise", before the existing " now".
	assert.equal(res.cursorCol, 12);
	assert.equal(applyCompletionCalls(), 0, "must not delegate when $ is active");
});

test("provider: applyCompletion at end of line adds a trailing space for chaining", () => {
	const { provider: base } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	const res = wrapped.applyCompletion(
		["use $co"],
		0,
		7,
		{ value: "concise", label: "concise" },
		"$co",
	);
	assert.deepEqual(res.lines, ["use $concise "]);
	// cursor after the trailing space so the user can type the next `$ref`.
	assert.equal(res.cursorCol, 13);
});

test("provider: applyCompletion delegates to base when no $ token", () => {
	const { provider: base, applyCompletionCalls } = fakeBase();
	const wrapped = createSkillAutocompleteProvider(() => INDEX)(base);
	wrapped.applyCompletion(["/pi"], 0, 3, { value: "pi-skills", label: "pi-skills" }, "/pi");
	assert.equal(applyCompletionCalls(), 1);
});
