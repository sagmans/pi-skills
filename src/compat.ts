// Pi host-version gate.
//
// src/editor.ts reflects into private Pi internals, so an untested Pi host must
// never silently run this extension: breakage would surface as a dead editor
// instead of a warning. The gate degrades loudly (warn once, stay inert) while
// the range below is advanced only after each Pi release is validated.

export const SUPPORTED_PI_MIN = "0.84.2";
export const SUPPORTED_PI_MAX_EXCLUSIVE = "0.85.0";

const VERSION_PART_COUNT = 3;

/** Parse "1.2.3" into [1, 2, 3]; missing parts count as 0. NaN junk -> undefined. */
export const parseVersionParts = (version: string): number[] | undefined => {
	const parts = version.trim().replace(/^[vV]/u, "").split(".");
	const numbers: number[] = [];
	for (const part of parts) {
		const parsed = Number.parseInt(part, 10);
		if (Number.isNaN(parsed)) return undefined;
		numbers.push(parsed);
	}
	if (numbers.length === 0 || numbers.length > VERSION_PART_COUNT) return undefined;
	while (numbers.length < VERSION_PART_COUNT) numbers.push(0);
	return numbers;
};

export const compareVersions = (left: string, right: string): number => {
	const a = parseVersionParts(left);
	const b = parseVersionParts(right);
	// Unparseable input sorts below everything so it never passes the gate.
	if (!a && !b) return 0;
	if (!a) return -1;
	if (!b) return 1;
	for (let i = 0; i < VERSION_PART_COUNT; i += 1) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
};

export const isSupportedPiVersion = (version: string): boolean =>
	compareVersions(version, SUPPORTED_PI_MIN) >= 0 &&
	compareVersions(version, SUPPORTED_PI_MAX_EXCLUSIVE) < 0;
