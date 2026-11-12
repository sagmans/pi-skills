import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
	DefaultPackageManager,
	SettingsManager,
	type LoadSkillsResult,
	type PackageSource,
	type ResolvedResource,
	type Skill,
	getAgentDir,
	loadSkills,
	stripFrontmatter,
} from "@earendil-works/pi-coding-agent";

// Loading and rendering of skills.
//
// `buildSkillBlock` reproduces Pi's built-in `/skill:name` expansion verbatim so
// that attaching a skill through pi-skills is indistinguishable from invoking
// `/skill:name` directly — the agent sees the same `<skill>` envelope with the
// same frontmatter-stripped body and the same "References are relative to …"
// hint. All attached skill blocks are combined into a single user-role message
// (joined by a blank line) and placed before the latest user turn; the injection
// is ephemeral (see inject.ts), so it is never persisted to the session or
// rendered by the TUI/export.

export type SkillIndex = readonly Skill[];
export type SkillDiagnostics = LoadSkillsResult["diagnostics"];

export interface SkillIndexOptions {
	cwd: string;
	projectTrusted: boolean;
	agentDir?: string;
}

export interface SkillIndexLoadResult {
	skills: SkillIndex;
	diagnostics: SkillDiagnostics;
}

const MISSING_PACKAGE_ACTION = "skip";

const PACKAGE_RESOURCE_FILTER_KEYS: Array<"extensions" | "skills" | "prompts" | "themes"> = [
	"extensions",
	"skills",
	"prompts",
	"themes",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object";

const isString = (value: unknown): value is string => typeof value === "string";

const sanitizedFilterList = (value: unknown): string[] | undefined =>
	Array.isArray(value) ? value.filter(isString) : undefined;

const withPackageResourceFilters = (
	entry: Record<string, unknown>,
	sanitized: Extract<PackageSource, { source: string }>,
): Extract<PackageSource, { source: string }> => {
	for (const key of PACKAGE_RESOURCE_FILTER_KEYS) {
		const value = sanitizedFilterList(entry[key]);
		if (value) sanitized[key] = value;
	}
	return sanitized;
};

const packageSourceFromRecord = (entry: Record<string, unknown>): PackageSource | undefined => {
	const { source } = entry;
	return isString(source) ? withPackageResourceFilters(entry, { source }) : undefined;
};

const packageSourceFromUnknownObject = (entry: unknown): PackageSource | undefined =>
	isRecord(entry) ? packageSourceFromRecord(entry) : undefined;

const packageSourceFromEntry = (entry: unknown): PackageSource | undefined =>
	isString(entry) ? entry : packageSourceFromUnknownObject(entry);

const sanitizePackageSettings = <T extends { packages?: unknown }>(settings: T) => {
	if (!Array.isArray(settings.packages)) return settings;
	return {
		...settings,
		packages: settings.packages
			.map(packageSourceFromEntry)
			.filter((entry): entry is PackageSource => entry !== undefined),
	};
};

const createSettingsManager = (options: Required<SkillIndexOptions>): SettingsManager => {
	const manager = SettingsManager.create(options.cwd, options.agentDir, {
		projectTrusted: options.projectTrusted,
	});
	const getGlobalSettings = manager.getGlobalSettings.bind(manager);
	const getProjectSettings = manager.getProjectSettings.bind(manager);
	manager.getGlobalSettings = () => sanitizePackageSettings(getGlobalSettings());
	manager.getProjectSettings = () => sanitizePackageSettings(getProjectSettings());
	return manager;
};

const createPackageManager = (options: Required<SkillIndexOptions>): DefaultPackageManager =>
	new DefaultPackageManager({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager: createSettingsManager(options),
	});

/**
 * Mirror Pi ResourceLoader's package/auto-directory normalization. Resource
 * resolution may return a skill directory; loadSkills also accepts directories,
 * but mapping direct `SKILL.md` files keeps metadata and collision behavior
 * aligned with Pi's own path set.
 */
const shouldNormalizeSkillResource = (resource: ResolvedResource): boolean =>
	resource.metadata.source === "auto" || resource.metadata.origin === "package";

const isDirectory = (path: string): boolean => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const skillFilePath = (resourcePath: string): string | undefined => {
	const skillFile = join(resourcePath, "SKILL.md");
	return existsSync(skillFile) ? skillFile : undefined;
};

export const normalizeSkillResourcePath = (resource: ResolvedResource): string => {
	if (!shouldNormalizeSkillResource(resource)) return resource.path;
	if (!isDirectory(resource.path)) return resource.path;
	return skillFilePath(resource.path) ?? resource.path;
};

/** Return enabled skill paths from Pi's resolved resource graph. */
export const enabledSkillPaths = (resources: readonly ResolvedResource[]): string[] =>
	resources
		.filter((resource) => resource.enabled)
		.map((resource) => normalizeSkillResourcePath(resource));

/**
 * Load every skill Pi itself would expose from default, .agents, local, and
 * package resources. Package manifests and settings filters are resolved by
 * Pi's DefaultPackageManager, with missing packages skipped so this diagnostic
 * extension never performs installs or blanks the default skill list.
 */
export const loadSkillIndex = async (options: SkillIndexOptions): Promise<SkillIndexLoadResult> => {
	const resolvedOptions: Required<SkillIndexOptions> = {
		cwd: options.cwd,
		agentDir: options.agentDir ?? getAgentDir(),
		projectTrusted: options.projectTrusted,
	};
	const packageManager = createPackageManager(resolvedOptions);
	const resolved = await packageManager.resolve(() => Promise.resolve(MISSING_PACKAGE_ACTION));
	const result = loadSkills({
		cwd: resolvedOptions.cwd,
		agentDir: resolvedOptions.agentDir,
		skillPaths: enabledSkillPaths(resolved.skills),
		includeDefaults: false,
	});
	return {
		skills: [...result.skills].sort((a, b) => a.name.localeCompare(b.name)),
		diagnostics: result.diagnostics,
	};
};

export const findSkill = (index: SkillIndex, name: string): Skill | undefined =>
	index.find((skill) => skill.name === name);

/**
 * Build a `<skill>` block from already-read content. Split from
 * {@link buildSkillBlock} so the exact envelope shape is unit-testable without
 * touching the filesystem.
 */
export const buildSkillBlockFromContent = (
	skill: Pick<Skill, "name" | "filePath" | "baseDir">,
	content: string,
): string => {
	const body = stripFrontmatter(content).trim();
	const openTag = ['<skill name="', skill.name, '" location="', skill.filePath, '">'].join("");
	const referenceLine = ["References are relative to ", skill.baseDir, "."].join("");
	return [openTag, referenceLine, "", body, "</skill>"].join("\n");
};

/** Read the skill file and build its `<skill>` block (matches `/skill:name`).
 * Returns `undefined` if the file cannot be read (deleted, permissions, etc.)
 * so the caller can treat it as missing instead of crashing the context hook. */
export const buildSkillBlock = (skill: Skill): string | undefined => {
	try {
		return buildSkillBlockFromContent(skill, readFileSync(skill.filePath, "utf-8"));
	} catch {
		return undefined;
	}
};

/**
 * Resolve queued skill names to `<skill>` blocks in order. Names absent from the
 * index, or whose files cannot be read, are skipped and returned as `missing`
 * so the caller can warn; `names` holds the resolved (present) names in order
 * so callers can report exactly which skills were injected. Pure aside from the
 * (injectable) block builder, so ordering/skip logic is unit-testable without
 * filesystem access.
 */
export const resolveSkillBlocks = (
	queued: readonly string[],
	index: SkillIndex,
	buildBlock: (skill: Skill) => string | undefined = buildSkillBlock,
): { blocks: string[]; names: string[]; missing: string[] } => {
	const blocks: string[] = [];
	const names: string[] = [];
	const missing: string[] = [];
	for (const name of queued) {
		const skill = findSkill(index, name);
		if (!skill) {
			missing.push(name);
			continue;
		}
		const block = buildBlock(skill);
		if (block === undefined) {
			missing.push(name);
			continue;
		}
		blocks.push(block);
		names.push(name);
	}
	return { blocks, names, missing };
};
