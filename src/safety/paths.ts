import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { DEFAULT_DENY, TEST_FILE_GLOBS, type Config } from "../config.js";

export class PathError extends Error {}

/**
 * Turn a model-supplied path into an absolute path inside `root`.
 * Model output is untrusted: reject anything that escapes the repository.
 */
export function resolveInRoot(root: string, p: string): { abs: string; rel: string } {
  if (!p || p.includes("\0")) throw new PathError("Empty or invalid path.");
  const absRoot = resolve(root);
  const abs = resolve(absRoot, p);
  const rel = relative(absRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathError(`Path "${p}" is outside the repository.`);
  }
  // A symlink inside the repo could point outside it; check the real location too.
  const real = realOrNearestParent(abs);
  const realRoot = existsSync(absRoot) ? realpathSync(absRoot) : absRoot;
  const realRel = relative(realRoot, real);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new PathError(`Path "${p}" resolves outside the repository.`);
  }
  return { abs, rel: rel.split(sep).join("/") };
}

/** realpath of the path, or of its closest existing parent for files not created yet. */
function realOrNearestParent(abs: string): string {
  let cur = abs;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...rest);
}

export interface PathPolicy {
  canRead(rel: string): boolean;
  /** Returns null when the write is allowed, or a reason it is not. */
  writeDenied(rel: string): string | null;
  isTestFile(rel: string): boolean;
}

const MANIFESTS = [
  "**/package.json",
  "**/requirements*.txt",
  "**/pyproject.toml",
  "**/setup.py",
  "**/setup.cfg",
  "**/Cargo.toml",
  "**/go.mod",
];

export function createPathPolicy(cfg: Pick<Config, "paths" | "allowTestChanges" | "allowDependencyChanges">): PathPolicy {
  const opts = { dot: true };
  const allow = picomatch(cfg.paths.allow, opts);
  const deny = picomatch([...DEFAULT_DENY, ...cfg.paths.deny], opts);
  const test = picomatch(TEST_FILE_GLOBS, opts);
  const manifest = picomatch(MANIFESTS, opts);
  const secret = picomatch(["**/.env*", "**/*.pem", "**/*.key"], opts);

  return {
    canRead: (rel) => !secret(rel) && !rel.startsWith(".git/"),
    isTestFile: (rel) => test(rel),
    writeDenied(rel) {
      if (deny(rel)) return `"${rel}" is on the deny list.`;
      if (!allow(rel)) return `"${rel}" is not in paths.allow.`;
      if (!cfg.allowTestChanges && test(rel)) {
        return `"${rel}" is a test file. Fix the code under test instead; tests describe the expected behaviour.`;
      }
      if (!cfg.allowDependencyChanges && manifest(rel)) return `"${rel}" is a dependency manifest.`;
      return null;
    },
  };
}
