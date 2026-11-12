import assert from "node:assert/strict";
import test from "node:test";

import { injectSkills, type AgentMessage } from "../src/inject.ts";

// AgentMessage is a large union; tests only exercise `role` + spread semantics,
// so minimal stand-ins are cast into place.
function msg(role: string, extra: Record<string, unknown> = {}): AgentMessage {
	return { role, timestamp: 0, ...extra } as unknown as AgentMessage;
}
function user(text: string, t = 0): AgentMessage {
	return { role: "user", content: text, timestamp: t } as unknown as AgentMessage;
}
function contentOf(m: AgentMessage): string {
	return (m as { content?: unknown }).content as string;
}

// --- injectSkills ---

test("injectSkills: prepends when there is no user message", () => {
	const a = msg("assistant");
	const out = injectSkills([a], ["A", "B"]);
	assert.equal(out.length, 2);
	assert.equal(out[0].role, "user");
	assert.equal(contentOf(out[0]), "A\n\nB");
	assert.equal(out[1], a);
});

test("injectSkills: inserts immediately before the latest user message", () => {
	const u1 = user("one", 1);
	const a1 = msg("assistant");
	const u2 = user("two", 2);
	const out = injectSkills([u1, a1, u2], ["X"]);
	assert.deepEqual(
		out.map((m) => m.role),
		["user", "assistant", "user", "user"],
	);
	assert.equal(contentOf(out[2]), "X"); // skill right before the latest user turn
	assert.equal(out[3], u2);
	assert.equal(out[0], u1); // earlier history untouched
});

test("injectSkills: single user message -> skill before it", () => {
	const u = user("hi");
	const out = injectSkills([u], ["X"]);
	assert.equal(out.length, 2);
	assert.equal(contentOf(out[0]), "X");
	assert.equal(out[1], u);
});

test("injectSkills: never splits an assistant tool-call from its tool-result", () => {
	// Placing the skill before the user turn keeps [assistant(tool_call), toolResult]
	// adjacent — the constraint every provider enforces.
	const u = user("prompt");
	const a = msg("assistant");
	const tr = msg("toolResult");
	const out = injectSkills([u, a, tr], ["X"]);
	assert.deepEqual(
		out.map((m) => m.role),
		["user", "user", "assistant", "toolResult"],
	);
	assert.equal(out[1], u); // prompt stays right after the skill, before assistant/toolResult
});

test("injectSkills: joins multiple blocks with a blank line", () => {
	const out = injectSkills([user("p")], ["<a/>", "<b/>"]);
	assert.equal(contentOf(out[0]), "<a/>\n\n<b/>");
});

test("injectSkills: does not mutate the input array", () => {
	const msgs = [user("p")];
	injectSkills(msgs, ["X"]);
	assert.equal(msgs.length, 1);
});

test("injectSkills: empty block list still yields a (empty) skill message", () => {
	// injectSkills is only called with non-empty blocks in practice (the context
	// handler guards), but it must not throw on the degenerate input.
	const out = injectSkills([user("p")], []);
	assert.equal(out.length, 2);
	assert.equal(contentOf(out[0]), "");
});
