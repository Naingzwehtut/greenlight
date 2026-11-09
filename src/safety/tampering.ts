// Detects changes that make CI green without fixing anything: skipping tests,
// deleting assertions, or silencing the type checker and linter.

export interface Violation {
  file: string;
  line: string;
  rule: string;
}

interface Rule {
  id: string;
  /** Pattern applied to added lines. */
  added?: RegExp;
  /** Pattern applied to removed lines. */
  removed?: RegExp;
  /** Only check files for which this returns true. */
  appliesTo?: (file: string, isTest: boolean) => boolean;
}

const RULES: Rule[] = [
  { id: "skip-test", added: /\b(?:it|test|describe)\.(?:skip|todo)\b|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.(?:skip|xfail)|pytest\.skip\(|@unittest\.skip/ },
  { id: "focus-test", added: /\b(?:it|test|describe)\.only\b|\bf(?:it|describe)\s*\(/ },
  { id: "remove-assertion", removed: /\bexpect\s*\(|\bassert\b|\.should\b|\bassert[A-Z]\w*\s*\(/, appliesTo: (_f, isTest) => isTest },
  { id: "silence-typecheck", added: /@ts-(?:ignore|nocheck|expect-error)|#\s*type:\s*ignore|#\s*pyright:\s*ignore/ },
  { id: "silence-lint", added: /eslint-disable|#\s*noqa|#\s*ruff:\s*noqa|biome-ignore|prettier-ignore/ },
  // Deleted test files are checked separately in findTampering.
];

export interface DiffFile {
  file: string;
  added: string[];
  removed: string[];
  deleted: boolean;
}

/** Parse `git diff` output into added and removed lines per file. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(line);
      cur = { file: m?.[1] ?? "", added: [], removed: [], deleted: false };
      files.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith("deleted file mode")) {
      cur.deleted = true;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    } else if (line.startsWith("+")) {
      cur.added.push(line.slice(1));
    } else if (line.startsWith("-")) {
      cur.removed.push(line.slice(1));
    }
  }
  return files;
}

export function findTampering(diff: string, isTestFile: (f: string) => boolean): Violation[] {
  const out: Violation[] = [];
  for (const f of parseUnifiedDiff(diff)) {
    const isTest = isTestFile(f.file);
    if (f.deleted && isTest) {
      out.push({ file: f.file, line: "(file deleted)", rule: "delete-test-file" });
      continue;
    }
    // A line moved within a file shows up as removed and added; only count real removals.
    const addedSet = new Set(f.added.map((l) => l.trim()));
    for (const rule of RULES) {
      if (rule.appliesTo && !rule.appliesTo(f.file, isTest)) continue;
      if (rule.added) {
        for (const l of f.added) if (rule.added.test(l)) out.push({ file: f.file, line: l.trim(), rule: rule.id });
      }
      if (rule.removed) {
        for (const l of f.removed) {
          if (rule.removed.test(l) && !addedSet.has(l.trim())) out.push({ file: f.file, line: l.trim(), rule: rule.id });
        }
      }
    }
  }
  return out;
}

export function describeViolations(vs: Violation[]): string {
  return vs.map((v) => `- ${v.rule} in ${v.file}: \`${v.line.slice(0, 120)}\``).join("\n");
}
