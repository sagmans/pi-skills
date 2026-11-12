// Ordered, de-duplicated queue of selected skill names.
//
// Pure data structure with no SDK or terminal state so it is trivially unit
// testable. Insertion order is preserved so the picker's commit order matches
// the order skills are injected into the submitted prompt. Re-adding a name
// does not move it: toggling is idempotent and keeps a stable display order.

export class SkillQueue {
	private readonly names: string[] = [];

	constructor(initial: Iterable<string> = []) {
		for (const name of initial) this.add(name);
	}

	/** Append a name unless already present. Returns true if the queue changed. */
	add(name: string): boolean {
		const trimmed = name.trim();
		if (!trimmed || this.names.includes(trimmed)) return false;
		this.names.push(trimmed);
		return true;
	}

	/** Remove a name if present. Returns true if the queue changed. */
	remove(name: string): boolean {
		const index = this.names.indexOf(name.trim());
		if (index === -1) return false;
		this.names.splice(index, 1);
		return true;
	}

	/** Add when absent, remove when present. Returns the post-toggle presence. */
	toggle(name: string): boolean {
		if (this.has(name)) {
			this.remove(name);
			return false;
		}
		this.add(name);
		return true;
	}

	has(name: string): boolean {
		return this.names.includes(name.trim());
	}

	clear(): void {
		this.names.length = 0;
	}

	/** Atomically replace the queue contents (preserving order, dedup). */
	replace(items: Iterable<string>): void {
		this.names.length = 0;
		for (const name of items) this.add(name);
	}

	get size(): number {
		return this.names.length;
	}

	/** Snapshot in insertion order. */
	list(): readonly string[] {
		return [...this.names];
	}
}
