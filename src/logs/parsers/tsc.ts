import type { Failure, LogParser } from "../types.js";
import { normalizePath } from "../clean.js";

// Two formats:
//   src/a.ts(3,10): error TS2322: Type 'string' is not assignable to type 'number'.
//   src/a.ts:3:10 - error TS2322: Type 'string' is not assignable to type 'number'.
const PAREN = /^(?<file>[^\s(][^(]*?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.*)$/;
const PRETTY = /^(?<file>[^\s:][^:]*?):(?<line>\d+):(?<col>\d+) - error (?<code>TS\d+): (?<msg>.*)$/;

export const tscParser: LogParser = {
  source: "tsc",
  detect: (log) => /error TS\d{3,5}:/.test(log),
  parse(log) {
    const lines = log.split("\n");
    const out: Failure[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const m = PAREN.exec(line) ?? PRETTY.exec(line);
      if (!m?.groups) continue;
      const g = m.groups;
      // TypeScript continues long messages on indented lines that follow.
      let message = g.msg!;
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]!) && !PAREN.test(lines[i + 1]!.trim())) {
        const next = lines[i + 1]!.trim();
        if (/^\d+\s/.test(next) || /^~+$/.test(next)) break; // code frame of pretty output
        message += "\n" + next;
        i++;
      }
      out.push({
        source: "tsc",
        title: g.code!,
        message,
        file: normalizePath(g.file!),
        line: Number(g.line),
        column: Number(g.col),
      });
    }
    return dedupe(out);
  },
};

function dedupe(fs: Failure[]): Failure[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.file}:${f.line}:${f.column}:${f.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
