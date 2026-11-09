import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const DEFAULT_DENY = [
  ".github/**",
  ".git/**",
  "**/node_modules/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/poetry.lock",
  "**/.env*",
  "**/*.pem",
  "**/*.key",
];

export const TEST_FILE_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test_*.py",
  "**/*_test.py",
  "**/tests/**",
  "**/test/**",
];

const ConfigSchema = z.object({
  /** Which model API to call. */
  provider: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
  model: z.string().optional(),
  /** Reasoning effort for providers that support it. */
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  /**
   * pr:      push the fix to a new branch and open a pull request (default)
   * push:    commit straight to the branch whose CI failed (same-repo PRs only)
   * comment: diagnose only; never change code
   */
  mode: z.enum(["pr", "push", "comment"]).default("pr"),
  /** Most model turns in one fix attempt. */
  maxIterations: z.number().int().min(1).max(100).default(20),
  /** Stop when the attempt has used this many input + output tokens. */
  maxTokens: z.number().int().min(10_000).default(1_000_000),
  /** Below this confidence (0-1), post a diagnosis but do not open a PR. */
  minConfidence: z.number().min(0).max(1).default(0.6),
  /** Commands used to reproduce and verify. Detected from the log and repo when omitted. */
  commands: z
    .object({
      test: z.string().optional(),
      typecheck: z.string().optional(),
      lint: z.string().optional(),
      install: z.string().optional(),
    })
    .default({}),
  paths: z
    .object({
      allow: z.array(z.string()).default(["**"]),
      deny: z.array(z.string()).default([]),
    })
    .default({ allow: ["**"], deny: [] }),
  /** Let the agent edit test files. Off by default so it cannot "fix" CI by weakening tests. */
  allowTestChanges: z.boolean().default(false),
  /** Let the agent edit dependency manifests and try dependency failures. */
  allowDependencyChanges: z.boolean().default(false),
  /** Seconds before a single command is killed. */
  commandTimeout: z.number().int().min(10).default(600),
  branchPrefix: z.string().default("greenlight/"),
  labels: z.array(z.string()).default(["greenlight"]),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_MODELS: Record<Config["provider"], string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5",
  ollama: "qwen3-coder",
};

export const CONFIG_FILES = [".greenlight.yml", ".greenlight.yaml", ".github/greenlight.yml"];

/** Read the repo's config file (if any), then apply overrides such as Action inputs. */
export function loadConfig(cwd: string, overrides: Record<string, unknown> = {}): Config {
  let fromFile: Record<string, unknown> = {};
  for (const name of CONFIG_FILES) {
    const p = join(cwd, name);
    if (existsSync(p)) {
      fromFile = (parseYaml(readFileSync(p, "utf8")) as Record<string, unknown>) ?? {};
      break;
    }
  }
  const merged = { ...fromFile, ...dropUndefined(overrides) };
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid greenlight config:\n${issues}`);
  }
  return result.data;
}

export function resolveModel(cfg: Config): string {
  return cfg.model ?? DEFAULT_MODELS[cfg.provider];
}

function dropUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
}
