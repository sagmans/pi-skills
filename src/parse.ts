// Pure parsing of `$<skill>` reference tokens from prompt text.
//
// `$`-completion (src/completion.ts) lets the user inline skill references in
// the editor; on submit the `input` handler strips those tokens (keeping the
// chat clean) and feeds the names into the shared skill queue. The token shape
// is shared with the completion provider so the two never drift: a `$` followed
// by a name that STARTS WITH A LETTER. Requiring a leading letter keeps dollar
// amounts like `$5` literal instead of mistaking them for skill references.

/** Matches one `$<name>` reference; <name> starts with a letter. */
export const SKILL_REF_PATTERN = "\\$([a-zA-Z][\\w-]*)";
const SKILL_REF_GLOBAL = new RegExp(SKILL_REF_PATTERN, "gu");

export interface ExtractedSkillRefs {
	/** Referenced skill names, in first-occurrence order, de-duplicated. */
	names: string[];
	/** The prompt text with known `$<name>` tokens removed and spacing tidied. */
	stripped: string;
}

export interface ExtractSkillRefsOptions {
	/** Return true only for names that should be treated as pi-skills refs. */
	isSkillName?: (name: string) => boolean;
}

/**
 * Pull known `$<name>` references out of the prompt and return the names plus
 * the text with those tokens removed. Unknown `$NAME` text is left literal so
 * shell/env prompts like `$HOME` and `$PATH` are never corrupted before the
 * model sees them. Only the whitespace immediately flanking a removed token is
 * collapsed (two surrounding runs → one space); the rest of the prompt,
 * including code-block indentation and tab-aligned tables, is preserved
 * untouched.
 */
const SKILL_REF_SENTINEL = "\uE000PI_SKILLS_REF\uE000";

export const extractSkillRefs = (
	text: string,
	options: ExtractSkillRefsOptions = {},
): ExtractedSkillRefs => {
	const isSkillName = options.isSkillName ?? (() => true);
	const names: string[] = [];
	// Mark removed tokens with a sentinel so we can clean up only the whitespace
	// they left behind, without touching formatting elsewhere in the prompt.
	const marked = text.replace(SKILL_REF_GLOBAL, (match, name: string) => {
		if (!isSkillName(name)) return match;
		if (!names.includes(name)) names.push(name);
		return SKILL_REF_SENTINEL;
	});
	const stripped = marked
		// Remove sentinels. Glued tokens ("foo$skillbar") leave no gap and stay
		// glued; spaced tokens leave a gap that is collapsed below.
		.split(SKILL_REF_SENTINEL)
		.join("")
		// Collapse runs of 2+ spaces flanked by non-whitespace on BOTH sides.
		// This catches mid-word gaps left by removed tokens ("a  d" -> "a d") while
		// preserving leading indentation (line start, no \S before), trailing
		// table padding (followed by \t/\n, no \S after), and tab-separated
		// columns (tabs are never collapsed, only space runs).
		.replace(/(?<=\S) {2,}(?=\S)/gu, " ")
		.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, "")
		.replace(/\n{3,}/gu, "\n\n");
	return { names, stripped };
};

/** Inline `$` attach policy: only known skills are stripped and queued. */
export const extractKnownSkillRefs = (
	text: string,
	skillNames: ReadonlySet<string>,
): ExtractedSkillRefs => extractSkillRefs(text, { isSkillName: (name) => skillNames.has(name) });
