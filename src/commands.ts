import type { SkillQueue } from "./queue.ts";
import type { SkillIndex } from "./skills.ts";

// `/pi-skills` command parsing and execution.
//
// Parsing is pure (no SDK state) so it is unit-testable in isolation. Execution
// mutates the injected queue only and returns a user-facing outcome; index.ts
// applies the widget/notify side-effects after the queue has changed.

const HELP_TEXT = [
	"pi-skills commands:",
	"/pi-skills            — list attached skills",
	"/pi-skills list       — same as above",
	"/pi-skills <name>     — attach/detach a skill",
	"/pi-skills toggle <n> — attach/detach a skill",
	"/pi-skills pick       — open the fuzzy skill picker",
	"/pi-skills status   — show skill count, attached set, $-completion state",
	"/pi-skills clear      — detach all skills",
	"/pi-skills help       — this message",
	"",
	"Ctrl+Alt+k            — fuzzy multi-select picker (built-in shortcut)",
	"Ctrl+X k              — same picker (needs prefix-keybindings extension)",
].join("\n");

export type ParsedCommand =
	| { kind: "list" }
	| { kind: "pick" }
	| { kind: "status" }
	| { kind: "clear" }
	| { kind: "toggle"; name: string }
	| { kind: "help" }
	| { kind: "unknown"; value: string };

interface CommandParseContext {
	args: string;
	first: string;
	second?: string;
}

type CommandParser = (ctx: CommandParseContext) => ParsedCommand;

const literalCommand = (command: ParsedCommand): CommandParser => () => command;

const parseToggleArgs: CommandParser = ({ args, second }) =>
	second ? { kind: "toggle", name: second } : { kind: "unknown", value: args };

const parseBareSkillName: CommandParser = ({ first }) => ({ kind: "toggle", name: first });

const COMMAND_PARSERS = new Map<string, CommandParser>([
	["list", literalCommand({ kind: "list" })],
	["status", literalCommand({ kind: "status" })],
	["clear", literalCommand({ kind: "clear" })],
	["reset", literalCommand({ kind: "clear" })],
	["off", literalCommand({ kind: "clear" })],
	["help", literalCommand({ kind: "help" })],
	["?", literalCommand({ kind: "help" })],
	["toggle", parseToggleArgs],
	["pick", literalCommand({ kind: "pick" })],
]);

const parseCommandContext = (ctx: CommandParseContext): ParsedCommand =>
	(COMMAND_PARSERS.get(ctx.first) ?? parseBareSkillName)(ctx);

export const parsePiSkillsArgs = (args: string): ParsedCommand => {
	const [first, second] = args.trim().split(/\s+/).filter(Boolean);
	return first ? parseCommandContext({ args, first, second }) : { kind: "list" };
};

export interface CommandDeps {
	queue: SkillQueue;
	index: SkillIndex;
	/** Whether the `$`-completion autocomplete provider registered this session. */
	autocompleteRegistered: boolean;
	/** Opens the picker overlay (index.ts owns the SDK glue). */
	openPicker: () => void;
}

export type NoticeLevel = "info" | "warning" | "error";

export interface CommandOutcome {
	message: string;
	level: NoticeLevel;
}

interface CommandExecutionPayload {
	kind: ParsedCommand["kind"];
	name?: string;
	value?: string;
}

type CommandExecutor = (parsed: CommandExecutionPayload, deps: CommandDeps) => CommandOutcome;

const describeAttached = (names: readonly string[]): string =>
	names.length === 0
		? "No skills attached. Press Ctrl+X k to pick."
		: `Attached (${names.length}): ${names.join(", ")}`;

const listCommand: CommandExecutor = (_parsed, { queue }) => ({
	message: describeAttached(queue.list()),
	level: "info",
});

const statusCommand: CommandExecutor = (_parsed, { queue, index, autocompleteRegistered }) => {
	const attached = queue.list();
	return {
		message: [
			`pi-skills: ${index.length} skills indexed, ${attached.length} attached, `,
			`$-completion ${autocompleteRegistered ? "on" : "OFF (not registered)"}`,
		].join(""),
		level: autocompleteRegistered ? "info" : "warning",
	};
};

const pickCommand: CommandExecutor = (_parsed, { openPicker }) => {
	openPicker();
	return { message: "Skill picker opened", level: "info" };
};

const clearCommand: CommandExecutor = (_parsed, { queue }) => {
	queue.clear();
	return { message: "Skill queue cleared", level: "info" };
};

const helpCommand: CommandExecutor = () => ({ message: HELP_TEXT, level: "info" });

const hasSkillName = (index: SkillIndex, name: string): boolean =>
	index.some((skill) => skill.name === name);

const toggleCommand: CommandExecutor = ({ name = "" }, { queue, index }) => {
	if (!hasSkillName(index, name)) return { message: `Unknown skill: ${name}`, level: "warning" };
	const on = queue.toggle(name);
	return {
		message: on ? `Attached ${name}` : `Detached ${name}`,
		level: "info",
	};
};

const unknownCommand: CommandExecutor = () => ({
	message: "Usage: /pi-skills [list|clear|<name>|help]",
	level: "warning",
});

const COMMAND_EXECUTORS = new Map<ParsedCommand["kind"], CommandExecutor>([
	["list", listCommand],
	["pick", pickCommand],
	["status", statusCommand],
	["clear", clearCommand],
	["toggle", toggleCommand],
	["help", helpCommand],
	["unknown", unknownCommand],
]);

const commandExecutor = (kind: ParsedCommand["kind"]): CommandExecutor =>
	COMMAND_EXECUTORS.get(kind) ?? unknownCommand;

export const runPiSkillsCommand = (parsed: ParsedCommand, deps: CommandDeps): CommandOutcome =>
	commandExecutor(parsed.kind)(parsed, deps);
