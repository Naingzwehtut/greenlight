import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import type { Failure, FailureSource } from "../logs/index.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  return "npm";
}

const EXEC: Record<PackageManager, string> = { npm: "npx", pnpm: "pnpm exec", yarn: "yarn", bun: "bunx" };
const RUN: Record<PackageManager, string> = { npm: "npm run", pnpm: "pnpm run", yarn: "yarn run", bun: "bun run" };

function readScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

const quote = (s: string) => (/^[\w@./:-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);
const unique = <T>(xs: T[]) => [...new Set(xs)];

/**
 * A command that re-runs only what failed in CI, so each check takes seconds.
 * Returns undefined when the failures do not point at a known tool.
 */
export function reproduceCommand(root: string, failures: Failure[], cfg: Config): string | undefined {
  const pm = detectPackageManager(root);
  const x = EXEC[pm];
  const bySource = new Map<FailureSource, Failure[]>();
  for (const f of failures) bySource.set(f.source, [...(bySource.get(f.source) ?? []), f]);
  const files = (fs: Failure[]) => unique(fs.map((f) => f.file).filter((f): f is string => !!f)).map(quote);
  // For test runners, re-run the failing test files rather than the files where errors were raised.
  const testFiles = (fs: Failure[]) =>
    unique(fs.map((f) => f.title.split(/ > | › |::/)[0]!.trim()).filter((f) => /\.\w+$/.test(f))).map(quote);

  const parts: string[] = [];
  for (const [source, fs] of bySource) {
    switch (source) {
      case "vitest":
        parts.push(`${x} vitest run ${testFiles(fs).join(" ")}`.trim());
        break;
      case "jest":
        parts.push(`${x} jest ${testFiles(fs).join(" ")}`.trim());
        break;
      case "tsc":
        parts.push(cfg.commands.typecheck ?? `${x} tsc --noEmit`);
        break;
      case "eslint":
        parts.push(`${x} eslint ${files(fs).join(" ")}`.trim());
        break;
      case "pytest":
        parts.push(`python -m pytest ${unique(fs.map((f) => quote(f.title))).join(" ")}`.trim());
        break;
      case "mypy":
        parts.push(cfg.commands.typecheck ?? `python -m mypy ${files(fs).join(" ")}`.trim());
        break;
      case "ruff":
        parts.push(`ruff check ${files(fs).join(" ")}`.trim());
        break;
      case "generic":
        break;
    }
  }
  return parts.length ? parts.join(" && ") : undefined;
}

/** The full checks for the project, from config first, then package.json or Python defaults. */
export function projectCommands(root: string, cfg: Config): Record<string, string> {
  const pm = detectPackageManager(root);
  const scripts = readScripts(root);
  const out: Record<string, string> = {};
  const fromScript = (...names: string[]) => {
    const name = names.find((n) => scripts[n]);
    return name ? `${RUN[pm]} ${name}` : undefined;
  };
  const isPython = ["pyproject.toml", "setup.py", "requirements.txt"].some((f) => existsSync(join(root, f)));

  const test = cfg.commands.test ?? fromScript("test") ?? (isPython ? "python -m pytest" : undefined);
  const typecheck = cfg.commands.typecheck ?? fromScript("typecheck", "type-check", "tsc", "check-types");
  const lint = cfg.commands.lint ?? fromScript("lint");
  if (test) out.test = test;
  if (typecheck) out.typecheck = typecheck;
  if (lint) out.lint = lint;
  return out;
}

export function buildCommandSet(root: string, failures: Failure[], cfg: Config): Record<string, string> {
  const project = projectCommands(root, cfg);
  const reproduce = reproduceCommand(root, failures, cfg);
  return reproduce ? { reproduce, ...project } : project;
}
