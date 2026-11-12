import assert from "node:assert/strict";
import test from "node:test";

import { PI_SKILLS_ACTION_EVENT, PI_SKILLS_REQUESTER, startBinding } from "../src/binding.ts";
import type { EventBus, Scheduler } from "../src/binding.ts";

interface FakeBus extends EventBus {
	emitted: Array<{ event: string; payload?: unknown }>;
}

function fakeBus(): FakeBus {
	const listeners = new Map<string, Array<(payload?: unknown) => void>>();
	const emitted: Array<{ event: string; payload?: unknown }> = [];
	return {
		emitted,
		emit(event, payload) {
			emitted.push({ event, payload });
			for (const handler of listeners.get(event) ?? []) handler(payload);
		},
		on(event, handler) {
			const arr = listeners.get(event) ?? [];
			arr.push(handler);
			listeners.set(event, arr);
			return () => {
				const next = (listeners.get(event) ?? []).filter((h) => h !== handler);
				listeners.set(event, next);
			};
		},
	};
}

function fakeScheduler(): { schedule: Scheduler; fire(): void } {
	let timer: (() => void) | undefined;
	return {
		schedule: (fn) => {
			timer = fn;
			return () => {
				if (timer === fn) timer = undefined;
			};
		},
		fire() {
			if (timer) {
				const fn = timer;
				timer = undefined;
				fn();
			}
		},
	};
}

test("claims the key on `available` and routes the action event", () => {
	const bus = fakeBus();
	const sched = fakeScheduler();
	let actions = 0;
	let inert = 0;
	const cleanup = startBinding({
		events: bus,
		prefixKey: "k",
		onAction: () => {
			actions += 1;
		},
		onInert: () => {
			inert += 1;
		},
		schedule: sched.schedule,
	});

	// Handshake kicked off with a query.
	assert.ok(bus.emitted.some((e) => e.event === "prefix-keybindings:query"));

	// prefix-keybindings answers availability.
	bus.emit("prefix-keybindings:available", { available: true });

	const register = bus.emitted.find((e) => e.event === "prefix-keybindings:register");
	assert.deepEqual(register?.payload, {
		requester: PI_SKILLS_REQUESTER,
		key: "k",
		eventId: PI_SKILLS_ACTION_EVENT,
	});

	// Firing the claimed action invokes onAction.
	bus.emit(PI_SKILLS_ACTION_EVENT);
	assert.equal(actions, 1);

	// Already claimed: firing the availability timer must not go inert.
	sched.fire();
	assert.equal(inert, 0);

	cleanup();
});

test("goes inert when prefix-keybindings never answers", () => {
	const bus = fakeBus();
	const sched = fakeScheduler();
	let inert = 0;
	startBinding({
		events: bus,
		prefixKey: "k",
		onAction: () => {},
		onInert: () => {
			inert += 1;
		},
		schedule: sched.schedule,
	});

	sched.fire();
	assert.equal(inert, 1);

	// First-wins: a late `available` after going inert cannot belatedly register.
	bus.emit("prefix-keybindings:available", { available: true });
	assert.ok(!bus.emitted.some((e) => e.event === "prefix-keybindings:register"));
});

test("cleanup detaches listeners so action no longer fires", () => {
	const bus = fakeBus();
	const sched = fakeScheduler();
	let actions = 0;
	const cleanup = startBinding({
		events: bus,
		prefixKey: "k",
		onAction: () => {
			actions += 1;
		},
		onInert: () => {},
		schedule: sched.schedule,
	});

	bus.emit("prefix-keybindings:available", { available: true });
	cleanup();

	bus.emit(PI_SKILLS_ACTION_EVENT);
	assert.equal(actions, 0);
	// A second availability after cleanup must not re-register.
	bus.emit("prefix-keybindings:available", { available: true });
	const registers = bus.emitted.filter((e) => e.event === "prefix-keybindings:register");
	assert.equal(registers.length, 1);
});

test("cleanup is idempotent", () => {
	const bus = fakeBus();
	const sched = fakeScheduler();
	const cleanup = startBinding({
		events: bus,
		prefixKey: "k",
		onAction: () => {},
		onInert: () => {},
		schedule: sched.schedule,
	});
	assert.doesNotThrow(() => {
		cleanup();
		cleanup();
	});
});
