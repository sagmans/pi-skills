import assert from "node:assert/strict";
import test from "node:test";

import { renderQueueWidget } from "../src/widget.ts";

test("returns undefined when queue is empty", () => {
	assert.equal(renderQueueWidget([]), undefined);
	assert.equal(renderQueueWidget(["", "  "]), undefined);
});

test("renders a single bullet for one skill", () => {
	assert.deepEqual(renderQueueWidget(["concise"]), ["◆ concise"]);
});

test("joins multiple skills with bullets", () => {
	assert.deepEqual(renderQueueWidget(["concise", "review"]), ["◆ concise ◆ review"]);
});

test("filters empty/whitespace entries defensively", () => {
	assert.deepEqual(renderQueueWidget(["a", "", "  ", "b"]), ["◆ a ◆ b"]);
});
