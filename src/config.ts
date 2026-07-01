import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";

export interface TierConfig {
  model?: string;
}

export interface ComposeConfig {
  explore?: TierConfig;
  "general-medium"?: TierConfig;
  "general-heavy"?: TierConfig;
}

const DEFAULT_EXPLORE_MODEL = "opencode/big-pickle";
const DEFAULT_MEDIUM_MODEL = "opencode/mimo-v2.5-free";
const DEFAULT_HEAVY_MODEL = "opencode/big-pickle";

function pathExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function injectModelIntoFrontmatter(mdPath: string, model: string): void {
  if (!pathExists(mdPath)) return;
  const content = readFileSync(mdPath, "utf8");
  const updated = content.replace(
    /^(---\n[\s\S]*?\n---)/m,
    (frontmatter) => {
      if (frontmatter.includes("model:")) {
        return frontmatter.replace(/^model:.*$/m, `model: "${model}"`);
      }
      const lines = frontmatter.split("\n");
      const descIdx = lines.findIndex((l) => l.startsWith("description:"));
      lines.splice(descIdx >= 0 ? descIdx + 1 : 1, 0, `model: "${model}"`);
      return lines.join("\n");
    }
  );
  writeFileSync(mdPath, updated, "utf8");
}

function normalizeConfigPath(tiersJsonPath: string): string {
  return existsSync(tiersJsonPath) && statSync(tiersJsonPath).isDirectory()
    ? join(tiersJsonPath, "tiers.json")
    : tiersJsonPath;
}

function validateTier(obj: unknown, name: string): void {
  if (obj !== undefined) {
    if (typeof obj !== "object" || obj === null)
      throw new Error(`${name} must be an object`);
    const t = obj as Record<string, unknown>;
    if (t.model !== undefined && typeof t.model !== "string")
      throw new Error(`${name}.model must be a string`);
  }
}

function validateConfig(config: unknown): void {
  if (config !== null && typeof config === "object" && !Array.isArray(config)) {
    const cfg = config as Record<string, unknown>;
    validateTier(cfg.explore, "explore");
    validateTier(cfg["general-medium"], "general-medium");
    validateTier(cfg["general-heavy"], "general-heavy");
  }
}

function normalizeConfig(config: unknown): ComposeConfig {
  validateConfig(config);
  const cfg = (config ?? {}) as ComposeConfig;
  return {
    explore: { model: cfg.explore?.model ?? DEFAULT_EXPLORE_MODEL },
    "general-medium": {
      model: cfg["general-medium"]?.model ?? DEFAULT_MEDIUM_MODEL,
    },
    "general-heavy": {
      model: cfg["general-heavy"]?.model ?? DEFAULT_HEAVY_MODEL,
    },
  };
}

function readConfig(path: string): ComposeConfig {
  const raw = readFileSync(path, "utf8");
  return normalizeConfig(JSON.parse(raw));
}

export function loadConfig(tiersJsonPath?: string): ComposeConfig {
  const requestedPath = tiersJsonPath ?? join(process.cwd(), "tiers.json");
  const projectPath = normalizeConfigPath(requestedPath);
  const globalPath = join(homedir(), ".config", "opencode", "tiers.json");
  if (pathExists(projectPath)) return readConfig(projectPath);
  if (pathExists(globalPath)) return readConfig(globalPath);
  return normalizeConfig({});
}

export function loadTiers(directory?: string): ComposeConfig {
  return loadConfig(directory);
}

export function createComposeAgent(input: {
  agent?: Record<string, unknown>;
}): void {
  if (!input.agent) input.agent = {};
  if (input.agent.compose) return;
  input.agent.compose = {
    mode: "primary",
    description: "Compose mode — orchestrates workflows with compose skills",
  };
}

export function createExploreAgent(
  input: { agent?: Record<string, unknown> },
  cfg: ComposeConfig,
): void {
  if (!input.agent) input.agent = {};
  const model = cfg.explore?.model ?? DEFAULT_EXPLORE_MODEL;
  input.agent.explore = {
    model,
    mode: "subagent",
    description: "Fast read-only codebase explorer",
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      bash: "allow",
      edit: "deny",
      write: "deny",
    },
  };
  injectModelIntoFrontmatter(join(process.cwd(), "agents", "explore.md"), model);
}

export function createGeneralAgent(
  input: { agent?: Record<string, unknown> },
  cfg: ComposeConfig,
): void {
  if (!input.agent) input.agent = {};
  const model = cfg["general-medium"]?.model ?? DEFAULT_MEDIUM_MODEL;
  input.agent.general = {
    model,
    mode: "subagent",
    description:
      "General-purpose worker — implements, fixes, refactors, reviews",
    permission: {
      read: "allow",
      edit: "allow",
      write: "allow",
      bash: "allow",
      glob: "allow",
      grep: "allow",
    },
  };
  injectModelIntoFrontmatter(join(process.cwd(), "agents", "general.md"), model);
}
