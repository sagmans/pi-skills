import assert from "node:assert/strict";
import test from "node:test";

import {
	createSkillCompletionEditorFactory,
	findAutocompleteTarget,
	forceAutocompleteIfAvailable,
	hasAutocompleteTrigger,
	SKILL_COMPLETION_TRIGGER,
	shouldForceSkillAutocomplete,
} from "../src/editor.ts";

test("shouldForceSkillAutocomplete only matches the single $ trigger", () => {
	assert.equal(shouldForceSkillAutocomplete(SKILL_COMPLETION_TRIGGER), true);
	assert.equal(shouldForceSkillAutocomplete(""), false);
	assert.equal(shouldForceSkillAutocomplete("$$"), false);
	assert.equal(shouldForceSkillAutocomplete("x"), false);
});

test("findAutocompleteTarget walks common inner-editor wrapper chains", () => {
	const leaf = { id: "leaf" };
	const middle = { inner: leaf };
	const root = { inner: middle };
	assert.equal(findAutocompleteTarget(root), leaf);
});

test("hasAutocompleteTrigger detects Pi's private autocomplete trigger", () => {
	assert.equal(hasAutocompleteTrigger({ tryTriggerAutocomplete: () => undefined }), true);
	assert.equal(hasAutocompleteTrigger({}), false);
	assert.equal(hasAutocompleteTrigger({ tryTriggerAutocomplete: "not a function" }), false);
});

test("forceAutocompleteIfAvailable calls Pi's autocomplete trigger when present", () => {
	let calls = 0;
	const target = {
		tryTriggerAutocomplete: () => {
			calls += 1;
		},
	};
	assert.equal(forceAutocompleteIfAvailable(target), true);
	assert.equal(calls, 1);
});

test("forceAutocompleteIfAvailable falls back when the private trigger is absent", () => {
	assert.equal(forceAutocompleteIfAvailable({}), false);
	assert.equal(forceAutocompleteIfAvailable({ tryTriggerAutocomplete: "not a function" }), false);
});

test("skill completion editor delegates input then forces autocomplete on $", () => {
	const handled: string[] = [];
	let triggerCalls = 0;
	const leaf = { tryTriggerAutocomplete: () => (triggerCalls += 1) };
	const previousFactory = () => ({
		inner: leaf,
		handleInput: (data: string) => handled.push(data),
		render: () => [],
		invalidate: () => undefined,
		getText: () => "",
		setText: () => undefined,
	});
	const editor = createSkillCompletionEditorFactory(previousFactory)(
		{ requestRender: () => undefined } as never,
		{ borderColor: (s: string) => s } as never,
		{ matches: () => false } as never,
	);

	editor.handleInput("x");
	editor.handleInput(SKILL_COMPLETION_TRIGGER);

	assert.deepEqual(handled, ["x", SKILL_COMPLETION_TRIGGER]);
	assert.equal(triggerCalls, 1);
});

test("skill completion editor syncs focus before delegated render", () => {
	let focusedDuringRender: boolean | undefined;
	const inner = {
		focused: false,
		handleInput: () => undefined,
		render: () => {
			focusedDuringRender = inner.focused;
			return [];
		},
		invalidate: () => undefined,
		getText: () => "",
		setText: () => undefined,
	};
	const editor = createSkillCompletionEditorFactory(() => inner)(
		{ requestRender: () => undefined } as never,
		{ borderColor: (s: string) => s } as never,
		{ matches: () => false } as never,
	);
	Reflect.set(editor, "focused", true);
	editor.render(80);
	assert.equal(focusedDuringRender, true);
});

test("factory falls back when the previous editor factory throws", () => {
	const editor = createSkillCompletionEditorFactory(() => {
		throw new Error("previous factory broke");
	})(
		{ requestRender: () => undefined } as never,
		{ borderColor: (s: string) => s } as never,
		{ matches: () => false } as never,
	);
	assert.equal(typeof editor.handleInput, "function");
	editor.handleInput("x"); // must not throw
});

test("forceAutocompleteIfAvailable fails closed on throwing reflection targets", () => {
	const hostile = new Proxy({}, {
		get() {
			throw new Error("nope");
		},
	});
	assert.equal(forceAutocompleteIfAvailable(hostile), false);
});
