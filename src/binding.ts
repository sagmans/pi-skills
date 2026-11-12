// Event-bus protocol that claims the `k` prefix slot from prefix-keybindings and
// routes the claimed key to the skill picker.
//
// NOTE: this is a deliberate fork of `../pi-nvim/src/binding.ts` (comments + the
// three pi-skills constants differ; the settlement/cleanup body is identical).
// The canonical home would be the SDK (`createPrefixKeyBinding`), but the SDK is
// an external package and prefix-keybindings is private with no exports, so a
// per-extension copy is the pragmatic choice today. Keep this in sync with
// pi-nvim's copy if the handshake semantics change.
//
// No SDK or terminal state lives here: the event bus, the action callback, and
// the scheduler are injected so the protocol is unit-testable without a TUI or
// process. src/index.ts supplies the real SDK glue (events bus, picker opener).
//
// Lifecycle:
//   session_start  -> emit `prefix-keybindings:query`
//                  -> on `prefix-keybindings:available` emit
//                     `prefix-keybindings:register { requester, key, eventId }`
//                  -> on `pi-skills:open` invoke `onAction` (-> open picker)
//   no `available` -> after the window, invoke `onInert` once and stay dormant
//   cleanup        -> detach every listener and cancel the timer

export const PI_SKILLS_REQUESTER = "pi-skills";
export const PI_SKILLS_ACTION_EVENT = "pi-skills:open";

const PREFIX_KEYBINDINGS_QUERY_EVENT = "prefix-keybindings:query";
const PREFIX_KEYBINDINGS_AVAILABLE_EVENT = "prefix-keybindings:available";
const PREFIX_KEYBINDINGS_REGISTER_EVENT = "prefix-keybindings:register";

// Window to hear back from prefix-keybindings before concluding it is absent.
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 2000;

export type EventBus = {
	emit(event: string, payload?: unknown): void;
	on(event: string, handler: (payload?: unknown) => void): () => void;
};

export type Scheduler = (fn: () => void, ms: number) => () => void;

export type BindingOptions = {
	events: EventBus;
	prefixKey: string;
	/** Invoked when the claimed prefix key fires. index.ts wires this to the picker. */
	onAction: () => void;
	/** Invoked once if prefix-keybindings never answers (extension stays inert). */
	onInert: () => void;
	schedule?: Scheduler;
	availabilityTimeoutMs?: number;
};

const defaultScheduler: Scheduler = (fn, ms) => {
	const handle = setTimeout(fn, ms);
	return () => clearTimeout(handle);
};

type BindingOutcome = "claimed" | "inert";

interface BindingState {
	outcome: BindingOutcome | null;
	cleaned: boolean;
	cleanups: Array<() => void>;
}

const createBindingState = (): BindingState => ({ outcome: null, cleaned: false, cleanups: [] });

const settleBinding = (
	state: BindingState,
	outcome: BindingOutcome,
	afterSettle: () => void,
): void => {
	if (state.outcome) return;
	state.outcome = outcome;
	afterSettle();
};

const registerPrefixKey = (opts: BindingOptions): void => {
	opts.events.emit(PREFIX_KEYBINDINGS_REGISTER_EVENT, {
		requester: PI_SKILLS_REQUESTER,
		key: opts.prefixKey,
		eventId: PI_SKILLS_ACTION_EVENT,
	});
};

const cleanupBinding = (state: BindingState): void => {
	if (state.cleaned) return;
	state.cleaned = true;
	while (state.cleanups.length) state.cleanups.shift()?.();
};

const queryPrefixKeybindings = (events: EventBus): void => {
	events.emit(PREFIX_KEYBINDINGS_QUERY_EVENT, {
		requester: PI_SKILLS_REQUESTER,
	});
};

/**
 * Start the handshake and return a cleanup function that detaches all listeners
 * and cancels the availability timer. Safe to call cleanup multiple times.
 */
export const startBinding = (opts: BindingOptions): (() => void) => {
	const schedule = opts.schedule ?? defaultScheduler;
	const timeoutMs = opts.availabilityTimeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS;
	const state = createBindingState();

	const cancelAvailabilityTimer = schedule(() => {
		settleBinding(state, "inert", opts.onInert);
	}, timeoutMs);

	const offAvailable = opts.events.on(PREFIX_KEYBINDINGS_AVAILABLE_EVENT, () => {
		settleBinding(state, "claimed", () => {
			cancelAvailabilityTimer();
			registerPrefixKey(opts);
		});
	});

	const offAction = opts.events.on(PI_SKILLS_ACTION_EVENT, () => {
		opts.onAction();
	});

	state.cleanups.push(offAvailable, offAction, cancelAvailabilityTimer);
	queryPrefixKeybindings(opts.events);

	return () => cleanupBinding(state);
};
