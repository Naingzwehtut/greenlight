import type { Failure, LogParser } from "../types.js";
import { normalizePath } from "../clean.js";

// mypy: src/app.py:10: error: Incompatible return value type (got "str", expected "int")  [return-value]
const MYPY = /^(?<file>[\w./\-]+\.pyi?):(?<line>\d+)(?::(?<col>\d+))?: error: (?<msg>.+?)(?:\s+\[(?<code>[\w-]+)\])?$/;

export const mypyParser: LogParser = {
  source: "mypy",
  detect: (log) => /^Found \d+ errors? in \d+ files?/m.test(log) || /\.py:\d+: error: .*\[[\w-]+\]$/m.test(log),
  parse(log) {
    const out: Failure[] = [];
    for (const line of log.split("\n")) {
      const m = MYPY.exec(line.trim());
      if (!m?.groups) continue;
      out.push({
        source: "mypy",
        title: m.groups.code ?? "mypy",
        message: m.groups.msg!,
        file: normalizePath(m.groups.file!),
        line: Number(m.groups.line),
        column: m.groups.col ? Number(m.groups.col) : undefined,
      });
    }
    return out;
  },
};

// ruff, concise format:  src/app.py:1:8: F401 [*] `os` imported but unused
// ruff, full format:     F401 [*] `os` imported but unused
//                         --> src/app.py:1:8
const RUFF_CONCISE = /^(?<file>[\w./\-]+\.pyi?):(?<line>\d+):(?<col>\d+): (?<code>[A-Z]+\d+) (?:\[\*\] )?(?<msg>.+)$/;
const RUFF_FULL_HEAD = /^(?<code>[A-Z]+\d+) (?:\[\*\] )?(?<msg>.+)$/;
const RUFF_FULL_LOC = /^\s*-->\s+(?<file>[\w./\-]+\.pyi?):(?<line>\d+):(?<col>\d+)/;

export const ruffParser: LogParser = {
  source: "ruff",
  detect: (log) => /^Found \d+ errors?\.$/m.test(log) && /\b[A-Z]{1,3}\d{3,4}\b/.test(log),
  parse(log) {
    const out: Failure[] = [];
    const lines = log.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const c = RUFF_CONCISE.exec(line);
      if (c?.groups) {
        out.push(ruff(c.groups.code!, c.groups.msg!, c.groups.file!, c.groups.line!, c.groups.col!));
        continue;
      }
      const h = RUFF_FULL_HEAD.exec(line);
      const loc = h?.groups && i + 1 < lines.length ? RUFF_FULL_LOC.exec(lines[i + 1]!) : null;
      if (h?.groups && loc?.groups) {
        out.push(ruff(h.groups.code!, h.groups.msg!, loc.groups.file!, loc.groups.line!, loc.groups.col!));
        i++;
      }
    }
    return out;
  },
};

function ruff(code: string, msg: string, file: string, line: string, col: string): Failure {
  return { source: "ruff", title: code, message: msg, file: normalizePath(file), line: Number(line), column: Number(col) };
}
