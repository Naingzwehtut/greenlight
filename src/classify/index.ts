import type { Failure, ParsedLog } from "../logs/index.js";

export type Category =
  | "test" // an assertion or runtime error inside a test run
  | "type" // the type checker rejected the code
  | "lint" // a linter rule failed
  | "build" // compilation or bundling failed
  | "dependency" // installing or resolving packages failed
  | "infra" // the runner, network or credentials failed; not a code problem
  | "flaky" // signs of timing-dependent behaviour
  | "unknown";

export interface Diagnosis {
  category: Category;
  /** Whether greenlight should try to change code for this failure. */
  fixable: boolean;
  /** One sentence a human can read in the PR comment. */
  reason: string;
  failures: Failure[];
}

interface Signal {
  category: Category;
  pattern: RegExp;
  reason: string;
}

// Checked in order; the first match wins. Infra comes first because a network
// error can also make tests fail, and editing code would not help.
const SIGNALS: Signal[] = [
  { category: "infra", pattern: /No space left on device/i, reason: "The runner ran out of disk space." },
  { category: "infra", pattern: /received a shutdown signal|The operation was canceled/i, reason: "The runner was shut down or the job was cancelled." },
  { category: "infra", pattern: /Bad credentials|Resource not accessible by integration|HTTP 401|HTTP 403/i, reason: "A credential or permission is missing." },
  { category: "infra", pattern: /API rate limit exceeded|\b429 Too Many Requests/i, reason: "An external service rate-limited the job." },
  { category: "infra", pattern: /Could not resolve host|getaddrinfo (?:ENOTFOUND|EAI_AGAIN)|ECONNRESET|socket hang up|503 Service Unavailable/i, reason: "A network request failed." },
  { category: "dependency", pattern: /ERESOLVE|npm ERR! code E404|No matching version found|Could not find a version that satisfies|ResolutionImpossible/i, reason: "Package installation or resolution failed." },
  { category: "flaky", pattern: /Test timed out in \d+ms|Exceeded timeout of \d+ ?ms|timeout of \d+ms exceeded/i, reason: "A test timed out, which is often timing-dependent." },
  { category: "build", pattern: /Build failed|ERROR in |\[vite\]:? .*failed|Module build failed|Could not resolve ".*" from/i, reason: "The build step failed." },
];

export interface ClassifyOptions {
  /** Allow changes to dependency manifests (package.json, requirements.txt, ...). */
  allowDependencyChanges?: boolean;
}

export function classify(parsed: ParsedLog, opts: ClassifyOptions = {}): Diagnosis {
  const { failures, cleaned } = parsed;

  for (const s of SIGNALS) {
    if (!s.pattern.test(cleaned)) continue;
    // A timeout mentioned in passing should not hide real assertion failures.
    if (s.category === "flaky" && failures.some((f) => f.source !== "generic" && !/timed? ?out/i.test(f.message))) continue;
    if (s.category === "build" && failures.some((f) => f.source !== "generic")) continue;
    const fixable = s.category === "build" || (s.category === "dependency" && !!opts.allowDependencyChanges);
    return { category: s.category, fixable, reason: s.reason, failures };
  }

  const sources = new Set(failures.map((f) => f.source));
  if (sources.has("vitest") || sources.has("jest") || sources.has("pytest")) {
    return { category: "test", fixable: true, reason: plural(failures, "test failed", "tests failed"), failures };
  }
  if (sources.has("tsc") || sources.has("mypy")) {
    return { category: "type", fixable: true, reason: plural(failures, "type error", "type errors"), failures };
  }
  if (sources.has("eslint") || sources.has("ruff")) {
    return { category: "lint", fixable: true, reason: plural(failures, "lint error", "lint errors"), failures };
  }
  return {
    category: "unknown",
    fixable: false,
    reason: "The log did not match a known tool, so greenlight will not change code.",
    failures,
  };
}

function plural(fs: Failure[], one: string, many: string): string {
  return fs.length === 1 ? `1 ${one}.` : `${fs.length} ${many}.`;
}
