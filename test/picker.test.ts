import assert from "node:assert/strict";
import test from "node:test";

import type { Skill } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

import {
	classifyPickerKey,
	clampCursor,
	editQuery,
	fuzzySkillFilter,
	scrollWindow,
	SkillPickerComponent,
} from "../src/picker.ts";
import { SkillQueue } from "../src/queue.ts";

function fakeSkill(name: string, description = "d"): Skill {
	return {
		name,
		description,
		filePath: `/${name}/SKILL.md`,
		baseDir: `/${name}`,
		sourceInfo: { source: "test" },
		disableModelInvocation: false,
	} as Skill;
}

const passthroughTheme = { fg: (_color: string, text: string) => text };

const stripAnsi = (line: string): string =>
	line.replace(/\u001b\[[0-9;]*m/gu, "").replaceAll(CURSOR_MARKER, "");

test("classifyPickerKey maps raw bytes to actions", () => {
	assert.equal(classifyPickerKey("\x1b").kind, "cancel");
	assert.equal(classifyPickerKey("\x03").kind, "cancel");
	assert.equal(classifyPickerKey("\r").kind, "commit");
	assert.equal(classifyPickerKey("\t").kind, "toggle");
	assert.equal(classifyPickerKey("\x1b[A").kind, "up");
	assert.equal(classifyPickerKey("\x1b[B").kind, "down");
	assert.equal(classifyPickerKey("\x7f").kind, "backspace");
	assert.equal(classifyPickerKey("\x1b[D").kind, "cursorLeft");
	assert.equal(classifyPickerKey("\x1b[C").kind, "cursorRight");
	assert.equal(classifyPickerKey("a").kind, "type");
	assert.equal(classifyPickerKey("\x01").kind, "noop"); // ctrl-a, not routed
});

test("classifyPickerKey type carries the character", () => {
	const r = classifyPickerKey("z");
	assert.equal(r.kind, "type");
	if (r.kind === "type") assert.equal(r.ch, "z");
});

test("clampCursor bounds into [0,len)", () => {
	assert.equal(clampCursor(-1, 3), 0);
	assert.equal(clampCursor(5, 3), 2);
	assert.equal(clampCursor(1, 3), 1);
	assert.equal(clampCursor(0, 0), 0);
});

test("scrollWindow centers then clamps to the tail", () => {
	assert.deepEqual(scrollWindow(5, 10, 4), { start: 3, end: 7 });
	assert.deepEqual(scrollWindow(0, 10, 4), { start: 0, end: 4 });
	assert.deepEqual(scrollWindow(9, 10, 4), { start: 6, end: 10 });
	assert.deepEqual(scrollWindow(0, 0, 4), { start: 0, end: 0 });
});

test("editQuery types, deletes, and moves the cursor", () => {
	assert.deepEqual(editQuery("", 0, { kind: "type", ch: "x" }), { query: "x", cursor: 1 });
	assert.deepEqual(editQuery("ab", 1, { kind: "type", ch: "X" }), { query: "aXb", cursor: 2 });
	assert.deepEqual(editQuery("ab", 0, { kind: "backspace" }), { query: "ab", cursor: 0 });
	assert.deepEqual(editQuery("ab", 2, { kind: "backspace" }), { query: "a", cursor: 1 });
	assert.deepEqual(editQuery("ab", 2, { kind: "cursorLeft" }), { query: "ab", cursor: 1 });
	assert.deepEqual(editQuery("ab", 0, { kind: "cursorRight" }), { query: "ab", cursor: 1 });
	assert.deepEqual(editQuery("ab", 1, { kind: "up" }), { query: "ab", cursor: 1 }); // noop
});

test("fuzzySkillFilter returns all on empty query and narrows otherwise", () => {
	const skills = [fakeSkill("alpha"), fakeSkill("beta"), fakeSkill("gamma")];
	assert.equal(fuzzySkillFilter(skills, "").length, 3);
	assert.deepEqual(fuzzySkillFilter(skills, "al").map((s) => s.name), ["alpha"]);
	assert.deepEqual(fuzzySkillFilter(skills, "g").map((s) => s.name), ["gamma"]);
	// "a" appears in all three (alph**a**, bet**a**, gamm**a**).
	assert.equal(fuzzySkillFilter(skills, "a").length, 3);
});

test("component: Enter commits the current working set unchanged", () => {
	const skills = [fakeSkill("a"), fakeSkill("b")];
	let captured: string[] | undefined = undefined;
	const c = new SkillPickerComponent(skills, ["b"], passthroughTheme, (r) => {
		captured = r;
	});
	c.handleInput("\r");
	assert.deepEqual(captured, ["b"]);
});

test("component: Tab toggles the focused skill then Enter commits", () => {
	const skills = [fakeSkill("a"), fakeSkill("b"), fakeSkill("c")];
	let captured: string[] | undefined = undefined;
	const c = new SkillPickerComponent(skills, [], passthroughTheme, (r) => {
		captured = r;
	});
	c.handleInput("\t"); // toggle focused = skills[0] = "a" -> on
	c.handleInput("\x1b[B"); // down -> focus skills[1]
	c.handleInput("\t"); // toggle "b" -> on
	c.handleInput("\r"); // commit
	assert.deepEqual(captured, ["a", "b"]);
});

test("component: typing filters before toggling the focused match", () => {
	const skills = [fakeSkill("alpha"), fakeSkill("beta"), fakeSkill("gamma")];
	let captured: string[] | undefined = undefined;
	const c = new SkillPickerComponent(skills, [], passthroughTheme, (r) => {
		captured = r;
	});
	c.handleInput("b"); // filter -> ["beta"]
	c.handleInput("\t"); // toggle "beta"
	c.handleInput("\r");
	assert.deepEqual(captured, ["beta"]);
});

test("component: Escape cancels and commits nothing", () => {
	const skills = [fakeSkill("a")];
	let captured: string[] | undefined = "untouched" as unknown as string[];
	const c = new SkillPickerComponent(skills, ["a"], passthroughTheme, (r) => {
		captured = r;
	});
	c.handleInput("\t"); // would detach "a" in the working copy...
	c.handleInput("\x1b"); // ...but cancel discards working changes
	assert.equal(captured, undefined);
});

test("component: pre-selected current queue survives only existing skills", () => {
	const skills = [fakeSkill("a")];
	let captured: string[] | undefined = undefined;
	// "ghost" is dropped because it is not in the skill list.
	const c = new SkillPickerComponent(skills, ["a", "ghost"], passthroughTheme, (r) => {
		captured = r;
	});
	c.handleInput("\r");
	assert.deepEqual(captured, ["a"]);
});

// Sanity: SkillQueue (used as the working set) ordering is insertion-stable.
test("component working set preserves current-queue order then appended toggles", () => {
	const skills = [fakeSkill("a"), fakeSkill("b"), fakeSkill("c")];
	let captured: string[] | undefined = undefined;
	const c = new SkillPickerComponent(skills, ["c"], passthroughTheme, (r) => {
		captured = r;
	});
	c.handleInput("\t"); // toggle focused "a" -> appended after "c"
	c.handleInput("\r");
	assert.deepEqual(captured, ["c", "a"]);
	assert.deepEqual(new SkillQueue(["c"]).toggle("a"), true);
});

test("render: every line fits the supplied terminal width", () => {
	const skills = [fakeSkill("alpha", "a fairly long description that must be truncated")];
	const c = new SkillPickerComponent(skills, [], passthroughTheme, () => undefined);
	for (const width of [80, 64, 40, 20, 8, 4]) {
		for (const line of c.render(width)) {
			assert.ok(
				stripAnsi(line).length <= width,
				"width " + width + " got " + stripAnsi(line).length + ": " + stripAnsi(line),
			);
		}
	}
});

test("render: focused query emits CURSOR_MARKER, unfocused does not", () => {
	const c = new SkillPickerComponent([fakeSkill("a")], [], passthroughTheme, () => undefined);
	c.handleInput("a");
	assert.equal(c.render(64).join("\n").includes(CURSOR_MARKER), false);
	c.focused = true;
	assert.equal(c.render(64).join("\n").includes(CURSOR_MARKER), true);
});
