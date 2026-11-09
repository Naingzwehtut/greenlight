import type { Failure, LogParser } from "../types.js";
import { normalizePath } from "../clean.js";

// Vitest prints each failure as a block:
//    FAIL  src/math.test.ts > add > adds two numbers
//   AssertionError: expected 3 to be 4 // Object.is equality
//    ❯ src/math.test.ts:5:22
// Blocks are separated by lines of "⎯" characters.
const FAIL_HEADER = /^\s*FAIL\s+(?<file>\S+?\.(?:[cm]?[jt]sx?))\s+>\s+(?<name>.+?)\s*$/;
const FILE_FAIL = /^\s*FAIL\s+(?<file>\S+?\.(?:[cm]?[jt]sx?))\s+\[\s*\S+\s*\]\s*$/;
// Stack frames may carry a function name: " ❯ formatName src/users/format.ts:3:22".
// The first frame outside node_modules is where the error was raised.
const LOCATION = /^\s*❯\s+(?:\S+\s+)?(?<file>[^\s:]+\.\w+):(?<line>\d+):(?<col>\d+)/;
const SEPARATOR = /^\s*⎯{3,}/;

export const vitestParser: LogParser = {
  source: "vitest",
  detect: (log) => /Test Files\s+\d+ failed|⎯⎯⎯|\bvitest\b|❯ /.test(log) && /\bFAIL\b/.test(log),
  parse(log) {
    const lines = log.split("\n");
    const out: Failure[] = [];
    for (let i = 0; i < lines.length; i++) {
      const header = FAIL_HEADER.exec(lines[i]!) ?? FILE_FAIL.exec(lines[i]!);
      if (!header?.groups) continue;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (FAIL_HEADER.test(l) || FILE_FAIL.test(l) || SEPARATOR.test(l)) break;
        body.push(l);
      }
      // The summary list at the top repeats headers with no body; skip those.
      const meaningful = body.filter((l) => l.trim() !== "");
      if (meaningful.length === 0) continue;

      const loc = body.map((l) => LOCATION.exec(l)).find((m) => m?.groups && !m.groups.file!.includes("node_modules"));
      const message = meaningful
        .filter((l) => !LOCATION.test(l))
        .slice(0, 25)
        .join("\n")
        .trim();
      const file = normalizePath(header.groups.file!);
      out.push({
        source: "vitest",
        title: header.groups.name ? `${file} > ${header.groups.name}` : file,
        message,
        file: loc?.groups ? normalizePath(loc.groups.file!) : file,
        line: loc?.groups ? Number(loc.groups.line) : undefined,
        column: loc?.groups ? Number(loc.groups.col) : undefined,
        excerpt: body.join("\n").trim(),
      });
      i = j - 1;
    }
    return dedupeByTitle(out);
  },
};

function dedupeByTitle(fs: Failure[]): Failure[] {
  const seen = new Set<string>();
  return fs.filter((f) => (seen.has(f.title) ? false : (seen.add(f.title), true)));
}
