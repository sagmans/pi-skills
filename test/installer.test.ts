import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import installPiSkills from "../index.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PI_SKILLS_WIDGET_KEY } from "../src/widget.ts";

interface FakeUI {
	notifications: Array<{ message: string; type?: string }>;
	widgets: Array<{ key: string; content: unknown; options: unknown }>;
	autocompleteFactories: Array<(current: unknown) => unknown>;
	editorFactories: unknown[];
	notify(message: string, type?: "info" | "warning" | "error"): void;
	setWidget(key: string, content: unknown, options?: unknown): void;
	addAutocompleteProvider(factory: (current: unknown) => unknown): void;
	getEditorComponent(): unknown;
	setEditorComponent(factory: unknown): void;
}

function fakeUI(initialEditorFactory?: unknown): FakeUI {
	const notifications: Array<{ message: string; type?: string }> = [];
	const widgets: Array<{ key: string; content: unknown; options: unknown }> = [];
	const autocompleteFactories: Array<(current: unknown) => unknown> = [];
	const editorFactories: unknown[] = initialEditorFactory ? [initialEditorFactory] : [];
	return {
		notifications,
		widgets,
		autocompleteFactories,
		editorFactories,
		notify: (message, type) => notifications.push({ message, type }),
		setWidget: (key, content, options) => widgets.push({ key, content, options }),
		addAutocompleteProvider: (factory) => autocompleteFactories.push(factory),
		getEditorComponent: () => editorFactories.at(-1),
		setEditorComponent: (factory) => editorFactories.push(factory),
	};
}

function fakeCtx(ui: FakeUI, hasUI = true, cwd = process.cwd()): ExtensionContext {
	return {
		cwd,
		hasUI,
		ui: ui as unknown as ExtensionContext["ui"],
		isProjectTrusted: () => true,
	} as ExtensionContext;
}

type InputHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type FakeCommand = { description?: string; handler: (a: string, ctx: ExtensionContext) => unknown };

interface FakePi {
	handlers: Map<string, InputHandler[]>;
	commands: Map<string, FakeCommand>;
	events: { emit(e: string, p?: unknown): void; on(e: string, h: (p?: unknown) => void): () => void };
	on(event: string, handler: InputHandler): void;
	registerCommand(name: string, command: FakeCommand): void;
}

function fakePi(): FakePi {
	const handlers = new Map<string, InputHandler[]>();
	const commands = new Map<string, FakeCommand>();
	const listeners = new Map<string, Array<(p?: unknown) => void>>();
	return {
		handlers,
		commands,
		events: {
			emit(event, payload) {
				for (const h of listeners.get(event) ?? []) h(payload);
			},
			on(event, handler) {
				const arr = listeners.get(event) ?? [];
				arr.push(handler);
				listeners.set(event, arr);
				return () => {
					listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler));
				};
			},
		},
		on(event, handler) {
			const arr = handlers.get(event) ?? [];
			arr.push(handler);
			handlers.set(event, arr);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
	};
}

function piSkillsCommand(pi: FakePi): FakeCommand {
	const command = pi.commands.get("pi-skills");
	assert.ok(command, "pi-skills command must be registered");
	return command;
}

async function emit(pi: FakePi, event: string, payload: unknown, ctx: ExtensionContext) {
	let result: unknown;
	for (const handler of pi.handlers.get(event) ?? []) {
		const next = await handler(payload, ctx);
		if (next !== undefined) result = next;
	}
	return result;
}

test("installer registers the /pi-skills command without throwing", () => {
	const pi = fakePi();
	assert.doesNotThrow(() => installPiSkills(pi as unknown as ExtensionAPI));
	assert.ok(pi.commands.has("pi-skills"));
});

test("session_start registers the $-skill autocomplete provider when hasUI", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const ctx = fakeCtx(ui, true); // hasUI=true exercises the UI registration block
	await emit(pi, "session_start", {}, ctx);
	assert.equal(ui.autocompleteFactories.length, 1, "must register the provider exactly once");
	assert.equal(ui.editorFactories.length, 1, "must install the editor shim exactly once");
	// The factory must stack `$` onto the base provider's trigger characters so
	// the editor auto-triggers skill completion on `$`.
	const base = { triggerCharacters: ["/", "@"], getSuggestions: async () => null, applyCompletion: () => null };
	const wrapped = ui.autocompleteFactories[0](base) as { triggerCharacters?: string[] };
	assert.ok(wrapped.triggerCharacters?.includes("$"), "$ must be a trigger character");
});

test("session_start re-registers after resetExtensionUI clears wrappers (reload regression)", async () => {
	// Models /reload: Pi's resetExtensionUI (a beforeSessionInvalidate hook)
	// empties autocompleteProviderWrappers, then session_start re-fires. The
	// provider must be re-registered even if module-level state survived the
	// reload — a stale `registered` gate here would silently drop `$`-completion.
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui1 = fakeUI();
	await emit(pi, "session_start", {}, fakeCtx(ui1, true));
	assert.equal(ui1.autocompleteFactories.length, 1, "first session registers");
	// Fresh UI == wrappers cleared by resetExtensionUI before the next session.
	const ui2 = fakeUI();
	await emit(pi, "session_start", {}, fakeCtx(ui2, true));
	assert.equal(ui2.autocompleteFactories.length, 1, "must re-register after wrappers cleared");
	assert.equal(ui2.editorFactories.length, 1, "must reinstall editor shim after reset");
});

test("session_start wraps an existing editor component instead of replacing it", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const previousFactory = () => ({ previous: true });
	const ui = fakeUI(previousFactory);
	await emit(pi, "session_start", {}, fakeCtx(ui, true));
	assert.equal(ui.editorFactories[0], previousFactory, "pre-existing editor factory remains recorded");
	assert.equal(ui.editorFactories.length, 2, "pi-skills must install a wrapper factory after the previous one");
	assert.notEqual(ui.editorFactories[1], previousFactory, "wrapper factory must not be the previous factory itself");
});

test("context with an empty queue passes messages through unchanged", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	// No skills attached: the handler must not inject or notify.
	const res = await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, fakeCtx(ui));
	assert.equal(res, undefined);
	assert.equal(ui.notifications.length, 0);
});

test("/pi-skills with no skill index reports empty queue", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const cmd = piSkillsCommand(pi);
	await cmd.handler("list", fakeCtx(ui));
	assert.match(ui.notifications[0]?.message ?? "", /No skills attached/);
});

test("/pi-skills toggle warns when skill is unknown", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const cmd = piSkillsCommand(pi);
	await cmd.handler("ghost", fakeCtx(ui));
	assert.equal(ui.notifications[0]?.type, "warning");
	assert.match(ui.notifications[0]?.message ?? "", /Unknown skill: ghost/);
});

test("/pi-skills clear notifies and syncs the widget", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const cmd = piSkillsCommand(pi);
	await cmd.handler("clear", fakeCtx(ui));
	assert.match(ui.notifications[0]?.message ?? "", /cleared/);
	// setWidget called with undefined content to clear the indicator.
	assert.ok(ui.widgets.some((w) => w.content === undefined));
});

test("/pi-skills help shows usage", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const cmd = piSkillsCommand(pi);
	await cmd.handler("help", fakeCtx(ui));
	assert.match(ui.notifications[0]?.message ?? "", /Ctrl\+X k/);
});

test("session_start surfaces skill diagnostics without throwing", async () => {
	const tmp = mkdtempSync(join(tmpdir(), "pi-skills-bad-"));
	try {
		const skillDir = join(tmp, ".pi", "skills", "bad-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: bad-skill\n---\nMissing description.\n");
		const pi = fakePi();
		installPiSkills(pi as unknown as ExtensionAPI);
		const ui = fakeUI();
		await emit(pi, "session_start", {}, fakeCtx(ui, false, tmp));
		assert.ok(ui.notifications.some((n) => /skill warning\(s\)/.test(n.message)));
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});

// --- integration: the inject+drain+notify+widget wiring (context handler) ---
//
// The pure helpers (injectSkills, resolveSkillBlocks) are unit-tested in their
// own files; these tests cover the WIRING in the `context` handler end-to-end
// against a real, temp-dir-backed discovered skill — the gap left by removing
// the planContextTurn command-bag.

const TEMP_SKILL_NAME = "injected-test";

/** Install pi-skills against a temp project containing one discoverable skill
 * and run session_start so the skill is loaded into the index. hasUI=false keeps
 * prefix-keybinding setup out of injection-path notifications. */
async function setupWithDiscoveredSkill(name: string): Promise<{
	pi: FakePi;
	ui: FakeUI;
	ctx: ExtensionContext;
	cleanup: () => void;
}> {
	const tmp = mkdtempSync(join(tmpdir(), "pi-skills-it-"));
	mkdirSync(join(tmp, ".pi", "skills", name), { recursive: true });
	writeFileSync(
		join(tmp, ".pi", "skills", name, "SKILL.md"),
		`---\nname: ${name}\ndescription: test skill\n---\nDo the test thing.\n`,
	);
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const ctx = fakeCtx(ui, false, tmp);
	await emit(pi, "session_start", {}, ctx);
	return { pi, ui, ctx, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Queue the temp skill via `/pi-skills toggle`. */
async function setupWithQueuedSkill(): Promise<{
	pi: FakePi;
	ui: FakeUI;
	ctx: ExtensionContext;
	cleanup: () => void;
}> {
	const setup = await setupWithDiscoveredSkill(TEMP_SKILL_NAME);
	const cmd = piSkillsCommand(setup.pi);
	await cmd.handler(`toggle ${TEMP_SKILL_NAME}`, setup.ctx);
	return setup;
}

test("context injects queued skills before the user turn, drains, notifies, and syncs the widget", async () => {
	const { pi, ui, ctx, cleanup } = await setupWithQueuedSkill();
	try {
		assert.ok(
			ui.notifications.some((n) => /Attached injected-test/.test(n.message)),
			"toggle must attach the discovered skill",
		);
		const res = (await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx)) as {
			messages?: Array<{ role: string; content: string }>;
		};
		const messages = res.messages;
		assert.ok(messages, "context must return modified messages");
		assert.equal(messages.length, 2);
		assert.equal(messages[0]?.role, "user");
		assert.match(messages[0]?.content ?? "", /<skill name="injected-test"/);
		assert.equal(messages[1]?.role, "user");
		assert.equal(messages[1]?.content, "hi");
		assert.ok(
			ui.notifications.some((n) => /Injected 1 skill\(s\): injected-test/.test(n.message)),
			"must notify exactly which skills were injected",
		);
		assert.ok(
			ui.widgets.some((w) => w.key === PI_SKILLS_WIDGET_KEY),
			"queue widget must be refreshed after draining",
		);
	} finally {
		await emit(pi, "turn_end", {}, ctx);
		cleanup();
	}
});

test("snapshot lifecycle: re-inject within a turn, cleared at turn_end (one-shot)", async () => {
	const { pi, ui, ctx, cleanup } = await setupWithQueuedSkill();
	try {
		// First fire of the turn: resolve, drain, snapshot, inject, notify.
		const first = (await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx)) as {
			messages?: Array<{ role: string; content: string }>;
		};
		assert.ok(first.messages);
		const notifiedAfterFirst = ui.notifications.filter((n) => /Injected 1 skill/.test(n.message)).length;
		assert.equal(notifiedAfterFirst, 1);

		// Subsequent fire (tool-use sub-request): re-inject from the snapshot,
		// with no new drain or notify.
		const second = (await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx)) as {
			messages?: Array<{ role: string; content: string }>;
		};
		const secondMessages = second.messages;
		assert.ok(secondMessages, "subsequent fire must re-inject from the snapshot");
		assert.match(secondMessages[0]?.content ?? "", /<skill name="injected-test"/);
		const notifiedAfterSecond = ui.notifications.filter((n) => /Injected 1 skill/.test(n.message)).length;
		assert.equal(notifiedAfterSecond, 1, "subsequent fire must not re-notify");

		// turn_end drops the snapshot; the next turn with an empty queue passes through.
		await emit(pi, "turn_end", {}, ctx);
		const third = await emit(pi, "context", { messages: [{ role: "user", content: "next" }] }, ctx);
		assert.equal(third, undefined, "after turn_end with an empty queue, context passes through");
	} finally {
		cleanup();
	}
});

test("snapshot lifecycle: session_start clears stale pending injection", async () => {
	const { pi, ctx, cleanup } = await setupWithQueuedSkill();
	try {
		const first = (await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx)) as {
			messages?: Array<{ role: string; content: string }>;
		};
		assert.ok(first.messages, "first context fire must inject");
		await emit(pi, "session_start", {}, ctx);
		const second = await emit(pi, "context", { messages: [{ role: "user", content: "next" }] }, ctx);
		assert.equal(second, undefined, "reload/session start must not leak stale pending skills");
	} finally {
		cleanup();
	}
});

test("snapshot lifecycle: session_shutdown clears stale pending injection", async () => {
	const { pi, ctx, cleanup } = await setupWithQueuedSkill();
	try {
		const first = (await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx)) as {
			messages?: Array<{ role: string; content: string }>;
		};
		assert.ok(first.messages, "first context fire must inject");
		await emit(pi, "session_shutdown", {}, ctx);
		const second = await emit(pi, "context", { messages: [{ role: "user", content: "next" }] }, ctx);
		assert.equal(second, undefined, "shutdown must not leak stale pending skills");
	} finally {
		cleanup();
	}
});

// --- integration: the `$<name>` input transform (inline skill references) ---

test("input handler strips known $refs, feeds the shared queue, and transforms the text", async () => {
	const { pi, ui, ctx, cleanup } = await setupWithDiscoveredSkill("concise");
	try {
		const cmd = piSkillsCommand(pi);
		await cmd.handler("clear", ctx); // hermetic: start from an empty queue

		const res = (await emit(pi, "input", { text: "$concise explain this", source: "interactive" }, ctx)) as {
			action: string;
			text?: string;
		};
		assert.equal(res.action, "transform");
		assert.equal(res.text, "explain this");

		// The stripped reference must have fed the same queue the picker uses.
		await cmd.handler("list", ctx);
		assert.match(ui.notifications.at(-1)?.message ?? "", /Attached \(1\): concise/);
	} finally {
		cleanup();
	}
});

test("input handler leaves unknown $NAME text literal", async () => {
	const { pi, ctx, cleanup } = await setupWithDiscoveredSkill("concise");
	try {
		const res = (await emit(pi, "input", { text: "run echo $HOME", source: "interactive" }, ctx)) as {
			action: string;
		};
		assert.equal(res.action, "continue");
	} finally {
		cleanup();
	}
});

test("input handler passes prompts without $refs through unchanged", async () => {
	const pi = fakePi();
	installPiSkills(pi as unknown as ExtensionAPI);
	const ui = fakeUI();
	const ctx = fakeCtx(ui);
	const cmd = piSkillsCommand(pi);
	await cmd.handler("clear", ctx);

	const res = (await emit(pi, "input", { text: "just a normal prompt", source: "interactive" }, ctx)) as {
		action: string;
	};
	assert.equal(res.action, "continue");

	await cmd.handler("list", ctx);
	assert.match(ui.notifications.at(-1)?.message ?? "", /No skills attached/);
});

test("context notifies missing and does not throw when a queued skill file becomes unreadable", async () => {
	const { pi, ui, ctx, cleanup } = await setupWithQueuedSkill();
	try {
		// Simulate the skill file vanishing between queueing and injection
		// (e.g. removed or reloaded away in a prior session).
		const cwd = ctx.cwd;
		assert.ok(cwd, "test context must include a working directory");
		const skillFile = join(cwd, ".pi", "skills", TEMP_SKILL_NAME, "SKILL.md");
		rmSync(skillFile, { force: true });

		// Must not throw; resolves to missing, notifies, and passes messages through.
		const res = await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx);
		assert.equal(res, undefined, "unreadable skill must not inject and must pass through");
		assert.ok(
			ui.notifications.some((n) => /Skill not found, skipped: injected-test/.test(n.message)),
			"must notify the missing/unreadable skill",
		);
	} finally {
		await emit(pi, "turn_end", {}, ctx);
		cleanup();
	}
});

test("context notifies missing when a queued skill is absent from the index after reload", async () => {
	const { pi, ui, ctx, cleanup } = await setupWithQueuedSkill();
	try {
		// Reload the index against an empty project so the previously queued
		// skill is no longer in the index (e.g. it was removed between sessions).
		const emptyCwd = mkdtempSync(join(tmpdir(), "pi-skills-reloaded-"));
		try {
			mkdirSync(join(emptyCwd, ".pi"), { recursive: true });
			const reloadedCtx = fakeCtx(ui, false, emptyCwd);
			await emit(pi, "session_start", {}, reloadedCtx);
		} finally {
			rmSync(emptyCwd, { recursive: true, force: true });
		}

		const res = await emit(pi, "context", { messages: [{ role: "user", content: "hi" }] }, ctx);
		assert.equal(res, undefined, "missing skill must not inject");
		assert.ok(
			ui.notifications.some((n) => /Skill not found, skipped: injected-test/.test(n.message)),
			"must notify the missing skill",
		);
	} finally {
		await emit(pi, "turn_end", {}, ctx);
		cleanup();
	}
});
