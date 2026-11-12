import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ResolvedResource, Skill } from "@earendil-works/pi-coding-agent";

import {
	buildSkillBlockFromContent,
	enabledSkillPaths,
	findSkill,
	loadSkillIndex,
	normalizeSkillResourcePath,
	resolveSkillBlocks,
	type SkillIndex,
} from "../src/skills.ts";

function fakeSkill(over: Partial<Skill> = {}): Skill {
	return {
		name: "pdf",
		description: "d",
		filePath: "/skills/pdf/SKILL.md",
		baseDir: "/skills/pdf",
		sourceInfo: { source: "test" } as Skill["sourceInfo"],
		disableModelInvocation: false,
		...over,
	} as Skill;
}

function nameIndex(names: string[]): SkillIndex {
	return names.map(
		(name) =>
			({
				name,
				description: `${name} desc`,
				filePath: `/${name}/SKILL.md`,
				baseDir: `/${name}`,
				sourceInfo: { source: "test" },
				disableModelInvocation: false,
			}) as Skill,
	);
}

function tempRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "pi-skills-test-"));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir: string, name: string, description = "test skill"): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\nSkill body.\n`,
	);
}

function writeAgentSettings(agentDir: string, settings: unknown): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings, null, 2));
}

const stubBlock = (skill: Skill) => `<${skill.name}>`;

test("buildSkillBlockFromContent matches builtin /skill:name envelope", () => {
	const skill = fakeSkill();
	const content = "---\nname: pdf\ndescription: x\n---\n\n# PDF\n\nBody line.\n";
	// Byte-identical to Pi's _expandSkillCommand output.
	const expected =
		"<skill name=\"pdf\" location=\"/skills/pdf/SKILL.md\">\n" +
		"References are relative to /skills/pdf.\n\n" +
		"# PDF\n\nBody line.\n" +
		"</skill>";
	assert.equal(buildSkillBlockFromContent(skill, content), expected);
});

test("buildSkillBlockFromContent strips no frontmatter when absent", () => {
	const skill = fakeSkill({ name: "plain", filePath: "/p/SKILL.md", baseDir: "/p" });
	const block = buildSkillBlockFromContent(skill, "  Hello body  \n");
	assert.match(block, /^<skill name="plain" location="\/p\/SKILL.md">/);
	assert.match(block, /\n\nHello body\n<\/skill>$/);
});

test("findSkill locates by name and is undefined when absent", () => {
	const index = [fakeSkill({ name: "a" }), fakeSkill({ name: "b" })];
	assert.equal(findSkill(index, "b")?.name, "b");
	assert.equal(findSkill(index, "zzz"), undefined);
});

test("resolveSkillBlocks returns empty for empty input", () => {
	assert.deepEqual(resolveSkillBlocks([], nameIndex(["a"]), stubBlock), { blocks: [], names: [], missing: [] });
});

test("resolveSkillBlocks preserves queue order", () => {
	const out = resolveSkillBlocks(["c", "a"], nameIndex(["a", "b", "c"]), stubBlock);
	assert.deepEqual(out.blocks, ["<c>", "<a>"]);
	assert.deepEqual(out.names, ["c", "a"]);
	assert.deepEqual(out.missing, []);
});

test("resolveSkillBlocks skips and reports missing skills", () => {
	const out = resolveSkillBlocks(["a", "ghost"], nameIndex(["a"]), stubBlock);
	assert.deepEqual(out.blocks, ["<a>"]);
	assert.deepEqual(out.names, ["a"]);
	assert.deepEqual(out.missing, ["ghost"]);
});

test("resolveSkillBlocks with all missing yields no blocks", () => {
	const out = resolveSkillBlocks(["ghost"], nameIndex(["a"]), stubBlock);
	assert.deepEqual(out.blocks, []);
	assert.deepEqual(out.names, []);
	assert.deepEqual(out.missing, ["ghost"]);
});

test("normalizeSkillResourcePath maps package skill directories to SKILL.md", () => {
	const { root, cleanup } = tempRoot();
	try {
		const skillDir = join(root, "pkg", "skills", "pi-skills-normalize-test");
		writeSkill(skillDir, "pi-skills-normalize-test");
		const resource: ResolvedResource = {
			path: skillDir,
			enabled: true,
			metadata: { source: root, scope: "user", origin: "package" },
		};
		assert.equal(normalizeSkillResourcePath(resource), join(skillDir, "SKILL.md"));
	} finally {
		cleanup();
	}
});

test("enabledSkillPaths filters disabled resources", () => {
	const resources: ResolvedResource[] = [
		{ path: "/enabled.md", enabled: true, metadata: { source: "test", scope: "user", origin: "top-level" } },
		{ path: "/disabled.md", enabled: false, metadata: { source: "test", scope: "user", origin: "top-level" } },
	];
	assert.deepEqual(enabledSkillPaths(resources), ["/enabled.md"]);
});

test("loadSkillIndex includes project .agents skills", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		writeAgentSettings(agentDir, {});
		writeSkill(join(cwd, ".agents", "skills", "pi-skills-agents-test"), "pi-skills-agents-test");
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: true });
		assert.ok(result.skills.some((skill) => skill.name === "pi-skills-agents-test"));
	} finally {
		cleanup();
	}
});

test("loadSkillIndex honors package manifests outside conventional skills/", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		const pkg = join(root, "pkg");
		writeSkill(join(pkg, "custom", "pi-skills-manifest-test"), "pi-skills-manifest-test");
		writeSkill(join(pkg, "skills", "pi-skills-convention-should-not-load"), "pi-skills-convention-should-not-load");
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ pi: { skills: ["custom"] } }, null, 2));
		writeAgentSettings(agentDir, { packages: [pkg] });
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: true });
		assert.ok(result.skills.some((skill) => skill.name === "pi-skills-manifest-test"));
		assert.ok(!result.skills.some((skill) => skill.name === "pi-skills-convention-should-not-load"));
	} finally {
		cleanup();
	}
});

test("loadSkillIndex honors package filters that disable skills", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		const pkg = join(root, "pkg");
		writeSkill(join(pkg, "skills", "pi-skills-disabled-package-test"), "pi-skills-disabled-package-test");
		writeAgentSettings(agentDir, { packages: [{ source: pkg, skills: [] }] });
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: true });
		assert.ok(!result.skills.some((skill) => skill.name === "pi-skills-disabled-package-test"));
	} finally {
		cleanup();
	}
});

test("loadSkillIndex skips missing project packages without losing default skills", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		writeAgentSettings(agentDir, {});
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({ packages: ["npm:pi-skills-definitely-missing-package"] }, null, 2),
		);
		writeSkill(join(agentDir, "skills", "pi-skills-default-survives-test"), "pi-skills-default-survives-test");
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: true });
		assert.ok(result.skills.some((skill) => skill.name === "pi-skills-default-survives-test"));
	} finally {
		cleanup();
	}
});

test("loadSkillIndex ignores malformed package entries without losing default skills", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		writeAgentSettings(agentDir, { packages: [{ skills: [] }, { source: 7 }, null] });
		writeSkill(join(agentDir, "skills", "pi-skills-invalid-package-entry-test"), "pi-skills-invalid-package-entry-test");
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: true });
		assert.ok(result.skills.some((skill) => skill.name === "pi-skills-invalid-package-entry-test"));
	} finally {
		cleanup();
	}
});

test("loadSkillIndex respects untrusted project boundary", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		const pkg = join(root, "project-pkg");
		writeAgentSettings(agentDir, {});
		writeSkill(join(agentDir, "skills", "pi-skills-user-trust-test"), "pi-skills-user-trust-test");
		writeSkill(join(cwd, ".pi", "skills", "pi-skills-project-pi-trust-test"), "pi-skills-project-pi-trust-test");
		writeSkill(join(cwd, ".agents", "skills", "pi-skills-project-agents-trust-test"), "pi-skills-project-agents-trust-test");
		writeSkill(join(pkg, "skills", "pi-skills-project-package-trust-test"), "pi-skills-project-package-trust-test");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [pkg] }, null, 2));
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: false });
		assert.ok(result.skills.some((skill) => skill.name === "pi-skills-user-trust-test"));
		assert.ok(!result.skills.some((skill) => skill.name === "pi-skills-project-pi-trust-test"));
		assert.ok(!result.skills.some((skill) => skill.name === "pi-skills-project-agents-trust-test"));
		assert.ok(!result.skills.some((skill) => skill.name === "pi-skills-project-package-trust-test"));
	} finally {
		cleanup();
	}
});

test("loadSkillIndex returns diagnostics for malformed skills while keeping valid skills", async () => {
	const { root, cleanup } = tempRoot();
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		writeAgentSettings(agentDir, {});
		writeSkill(join(agentDir, "skills", "pi-skills-valid-diagnostic-test"), "pi-skills-valid-diagnostic-test");
		const badDir = join(agentDir, "skills", "pi-skills-bad-diagnostic-test");
		mkdirSync(badDir, { recursive: true });
		writeFileSync(join(badDir, "SKILL.md"), "---\nname: pi-skills-bad-diagnostic-test\n---\nBody.\n");
		const result = await loadSkillIndex({ cwd, agentDir, projectTrusted: true });
		assert.ok(result.skills.some((skill) => skill.name === "pi-skills-valid-diagnostic-test"));
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path?.includes("pi-skills-bad-diagnostic-test")));
	} finally {
		cleanup();
	}
});
