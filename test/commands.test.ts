import assert from "node:assert/strict";
import test from "node:test";

import type { Skill } from "@earendil-works/pi-coding-agent";

import { parsePiSkillsArgs, runPiSkillsCommand } from "../src/commands.ts";
import { SkillQueue } from "../src/queue.ts";
import type { SkillIndex } from "../src/skills.ts";

function fakeIndex(names: string[]): SkillIndex {
	return names.map(
		(name) =>
			({
				name,
				description: `${name} desc`,
				filePath: `/${name}/SKILL.md`,
				baseDir: `/${name}`,
				sourceInfo: { source: "test" },
				disableModelInvocation: false,
			}) as Skill,
	);
}

test("parse: empty/list -> list", () => {
	assert.equal(parsePiSkillsArgs("").kind, "list");
	assert.equal(parsePiSkillsArgs("list").kind, "list");
});

test("parse: status -> status", () => {
	assert.equal(parsePiSkillsArgs("status").kind, "status");
});

test("parse: pick -> pick", () => {
	assert.equal(parsePiSkillsArgs("pick").kind, "pick");
});

test("command pick opens the picker overlay", () => {
	let opened = 0;
	const out = runPiSkillsCommand(parsePiSkillsArgs("pick"), { queue: new SkillQueue(), index: fakeIndex(["a"]), autocompleteRegistered: true, openPicker: () => {
		opened += 1;
	} });
	assert.equal(opened, 1);
	assert.equal(out.level, "info");
	assert.match(out.message, /picker/i);
});

test("parse: clear/reset/off -> clear", () => {
	assert.equal(parsePiSkillsArgs("clear").kind, "clear");
	assert.equal(parsePiSkillsArgs("reset").kind, "clear");
	assert.equal(parsePiSkillsArgs("off").kind, "clear");
});

test("parse: help/? -> help", () => {
	assert.equal(parsePiSkillsArgs("help").kind, "help");
	assert.equal(parsePiSkillsArgs("?").kind, "help");
});

test("parse: bare name -> toggle", () => {
	const r = parsePiSkillsArgs("concise");
	assert.equal(r.kind, "toggle");
	assert.equal(r.kind === "toggle" ? r.name : "", "concise");
});

test("parse: toggle <name> -> toggle", () => {
	const r = parsePiSkillsArgs("toggle pdf");
	assert.equal(r.kind, "toggle");
	if (r.kind === "toggle") assert.equal(r.name, "pdf");
});

test("parse: toggle without name -> unknown", () => {
	assert.equal(parsePiSkillsArgs("toggle").kind, "unknown");
});

test("command list reports empty queue", () => {
	const out = runPiSkillsCommand(parsePiSkillsArgs(""), { queue: new SkillQueue(), index: fakeIndex(["a"]), autocompleteRegistered: true, openPicker: () => {} });
	assert.equal(out.level, "info");
	assert.match(out.message, /No skills attached/);
});

test("command clear empties the queue", () => {
	const q = new SkillQueue(["a", "b"]);
	const out = runPiSkillsCommand(parsePiSkillsArgs("clear"), { queue: q, index: fakeIndex(["a", "b"]), autocompleteRegistered: false, openPicker: () => {} });
	assert.equal(q.size, 0);
	assert.match(out.message, /cleared/);
});

test("command toggle attaches then detaches an existing skill", () => {
	const q = new SkillQueue();
	const index = fakeIndex(["concise"]);
	const on = runPiSkillsCommand(parsePiSkillsArgs("concise"), { queue: q, index, autocompleteRegistered: false, openPicker: () => {} });
	assert.equal(q.has("concise"), true);
	assert.match(on.message, /Attached/);
	const off = runPiSkillsCommand(parsePiSkillsArgs("concise"), { queue: q, index, autocompleteRegistered: false, openPicker: () => {} });
	assert.equal(q.has("concise"), false);
	assert.match(off.message, /Detached/);
});

test("command toggle warns on unknown skill", () => {
	const out = runPiSkillsCommand(parsePiSkillsArgs("ghost"), { queue: new SkillQueue(), index: fakeIndex(["a"]), autocompleteRegistered: false, openPicker: () => {} });
	assert.equal(out.level, "warning");
	assert.match(out.message, /Unknown skill: ghost/);
});

test("command status reports index/attached counts and registration state", () => {
	const q = new SkillQueue(["concise"]);
	const index = fakeIndex(["concise", "tdd"]);
	const on = runPiSkillsCommand(parsePiSkillsArgs("status"), { queue: q, index, autocompleteRegistered: true, openPicker: () => {} });
	assert.equal(on.level, "info");
	assert.match(on.message, /2 skills indexed, 1 attached/);
	assert.match(on.message, /\$-completion on/);

	const off = runPiSkillsCommand(parsePiSkillsArgs("status"), { queue: new SkillQueue(), index, autocompleteRegistered: false, openPicker: () => {} });
	assert.equal(off.level, "warning");
	assert.match(off.message, /\$-completion OFF/);
});
