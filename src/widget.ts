// Compact one-line indicator of the currently attached skill queue, shown above
// the editor via `ctx.ui.setWidget`. Kept as a pure formatter so the exact
// rendering is unit-testable; index.ts owns the `setWidget` SDK call.

export const PI_SKILLS_WIDGET_KEY = "pi-skills";
const BULLET = "◆";

/**
 * Returns the widget lines, or `undefined` to clear the widget when nothing is
 * queued. Empty/whitespace names are filtered defensively.
 */
export const renderQueueWidget = (names: readonly string[]): string[] | undefined => {
	const clean = names.filter((name) => name.trim().length > 0);
	if (clean.length === 0) return undefined;
	return [`${BULLET} ${clean.join(` ${BULLET} `)}`];
};
