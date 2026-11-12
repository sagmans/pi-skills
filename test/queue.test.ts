import assert from "node:assert/strict";
import test from "node:test";

import { SkillQueue } from "../src/queue.ts";

test("add appends and dedups, preserving insertion order", () => {
	const q = new SkillQueue();
	assert.equal(q.add("concise"), true);
	assert.equal(q.add("review"), true);
	assert.equal(q.add("concise"), false); // dup, no move
	assert.deepEqual([...q.list()], ["concise", "review"]);
});

test("add trims and rejects empty/whitespace names", () => {
	const q = new SkillQueue();
	assert.equal(q.add("  pdf  "), true);
	assert.equal(q.has("pdf"), true);
	assert.equal(q.add(""), false);
	assert.equal(q.add("   "), false);
	assert.equal(q.size, 1);
});

test("toggle flips presence and returns post-state", () => {
	const q = new SkillQueue(["a"]);
	assert.equal(q.toggle("a"), false); // was present -> removed
	assert.equal(q.has("a"), false);
	assert.equal(q.toggle("a"), true); // absent -> added
	assert.equal(q.has("a"), true);
	assert.equal(q.toggle("b"), true);
	assert.deepEqual([...q.list()], ["a", "b"]);
});

test("remove returns whether the queue changed", () => {
	const q = new SkillQueue(["a", "b"]);
	assert.equal(q.remove("a"), true);
	assert.equal(q.remove("a"), false);
	assert.deepEqual([...q.list()], ["b"]);
});

test("clear empties the queue", () => {
	const q = new SkillQueue(["a", "b"]);
	q.clear();
	assert.equal(q.size, 0);
	assert.deepEqual([...q.list()], []);
});

test("replace swaps contents atomically, deduping and preserving order", () => {
	const q = new SkillQueue(["a", "b"]);
	q.replace(["b", "c", "b"]);
	assert.deepEqual([...q.list()], ["b", "c"]);
	q.replace([]);
	assert.equal(q.size, 0);
});

test("initial iterable seeds order and dedups", () => {
	const q = new SkillQueue(["b", "a", "b"]);
	assert.deepEqual([...q.list()], ["b", "a"]);
});

test("list returns a snapshot, not mutable internal state", () => {
	const q = new SkillQueue(["a"]);
	(q.list() as string[]).push("b");
	assert.deepEqual([...q.list()], ["a"]);
});
