import type { ContextEvent } from "@earendil-works/pi-coding-agent";

// Pure helper for the ephemeral `context`-event injection. Kept separate from
// index.ts so the message-insertion logic is unit-testable without the SDK
// runtime or module-level state. The one-shot drain + snapshot lifecycle lives
// inline in the `context` handler (index.ts) — it is straightforward branching
// and is covered by an integration test rather than a parallel command-bag.

// One LLM message as seen by the provider. Derived from ContextEvent since the
// SDK does not re-export AgentMessage directly.
export type AgentMessage = ContextEvent["messages"][number];

export type SkillSnapshot = { blocks: string[]; names: string[] };

/**
 * Insert the combined skill bodies as a single user-role message right before
 * the latest user message. Placing it before a user turn (never between an
 * assistant tool-call and its tool-result) is safe for every provider and keeps
 * the skills adjacent to the prompt they augment — mirroring `/skill:name`.
 * Returns a new array; the original is untouched.
 */
export const injectSkills = (messages: readonly AgentMessage[], blocks: readonly string[]): AgentMessage[] => {
	const skillMessage: AgentMessage = {
		role: "user",
		content: blocks.join("\n\n"),
		timestamp: Date.now(),
	};
	let lastUser = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			lastUser = i;
			break;
		}
	}
	if (lastUser === -1) return [skillMessage, ...messages];
	return [...messages.slice(0, lastUser), skillMessage, ...messages.slice(lastUser)];
};
