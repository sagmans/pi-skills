import assert from "node:assert/strict";
import test from "node:test";

import { extractKnownSkillRefs, extractSkillRefs } from "../src/parse.ts";

test("extractSkillRefs: no tokens leaves text unchanged", () => {
	const result = extractSkillRefs("just a normal prompt");
	assert.deepEqual(result.names, []);
	assert.equal(result.stripped, "just a normal prompt");
});

test("extractSkillRefs: single token is removed and named", () => {
	const result = extractSkillRefs("$concise do the thing");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "do the thing");
});

test("extractSkillRefs: multiple tokens keep first-occurrence order", () => {
	const result = extractSkillRefs("$tdd then $review then $concise");
	assert.deepEqual(result.names, ["tdd", "review", "concise"]);
	assert.equal(result.stripped, "then then");
});

test("extractSkillRefs: repeated token is de-duplicated", () => {
	const result = extractSkillRefs("$concise and $concise again");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "and again");
});

test("extractSkillRefs: token inline in a sentence keeps it readable", () => {
	const result = extractSkillRefs("explain $concise now please");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "explain now please");
});

test("extractSkillRefs: dollar amounts stay literal ($5 is not a ref)", () => {
	const result = extractSkillRefs("cost is $5 and $10 total");
	assert.deepEqual(result.names, []);
	assert.equal(result.stripped, "cost is $5 and $10 total");
});

test("extractSkillRefs: bare $ is not a reference", () => {
	const result = extractSkillRefs("pay $ at the door");
	assert.deepEqual(result.names, []);
	assert.equal(result.stripped, "pay $ at the door");
});

test("extractSkillRefs: $ followed by space is not a reference", () => {
	const result = extractSkillRefs("use $ concise");
	assert.deepEqual(result.names, []);
	assert.equal(result.stripped, "use $ concise");
});

test("extractSkillRefs: unresolved names are still extracted by default", () => {
	const result = extractSkillRefs("$concise $ghost");
	assert.deepEqual(result.names, ["concise", "ghost"]);
	assert.equal(result.stripped, "");
});

test("extractKnownSkillRefs: unknown names stay literal", () => {
	const result = extractKnownSkillRefs("run echo $HOME with $concise", new Set(["concise"]));
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "run echo $HOME with");
});

test("extractSkillRefs: collapses leftover spacing but keeps newlines", () => {
	const result = extractSkillRefs("a $b  $c   d");
	assert.deepEqual(result.names, ["b", "c"]);
	assert.equal(result.stripped, "a d");
});

test("extractSkillRefs: token-only prompt strips to empty", () => {
	const result = extractSkillRefs("$concise");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "");
});

test("extractSkillRefs: hyphenated skill names match", () => {
	const result = extractSkillRefs("use $code-review here");
	assert.deepEqual(result.names, ["code-review"]);
	assert.equal(result.stripped, "use here");
});

test("extractSkillRefs: preserves code-block indentation and tab-aligned tables", () => {
	// A token on one line must not collapse spaces/tabs on other lines.
	const prompt = [
		"fix this with $concise",
		"```",
		"const x = {",
		"  a: 1,",
		"    b: 2,",
		"};",
		"```",
		"col1\tcol2\tcol3",
		"v1   \tv2   \tv3",
	].join("\n");
	const result = extractSkillRefs(prompt);
	assert.deepEqual(result.names, ["concise"]);
	// The token line keeps a single trailing space (harmless, matches prior
	// behavior); code-block indentation and tab-aligned tables are preserved.
	const expected = [
		"fix this with ",
		"```",
		"const x = {",
		"  a: 1,",
		"    b: 2,",
		"};",
		"```",
		"col1\tcol2\tcol3",
		"v1   \tv2   \tv3",
	].join("\n");
	assert.equal(result.stripped, expected);
});

test("extractSkillRefs: token at start of line collapses trailing gap", () => {
	const result = extractSkillRefs("$concise   then go");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "then go");
});

test("extractSkillRefs: token at end of line collapses leading gap", () => {
	const result = extractSkillRefs("go   $concise");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "go");
});

test("extractSkillRefs: glue-adjacent token keeps words separate", () => {
	const result = extractSkillRefs("foo$concise bar");
	assert.deepEqual(result.names, ["concise"]);
	assert.equal(result.stripped, "foo bar");
});

test("extractSkillRefs: glue-adjacent token on both sides stays glued", () => {
	const result = extractSkillRefs("foo$concise bar $tdd baz");
	assert.deepEqual(result.names, ["concise", "tdd"]);
	assert.equal(result.stripped, "foo bar baz");
});
