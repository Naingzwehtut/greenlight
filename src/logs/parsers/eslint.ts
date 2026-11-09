import type { Failure, LogParser } from "../types.js";
import { normalizePath } from "../clean.js";

// ESLint "stylish" output:
//   /home/runner/work/app/app/src/a.ts
//     3:7  error  'x' is assigned a value but never used  @typescript-eslint/no-unused-vars
const FILE_HEADER = /^(?:\/|[A-Za-z]:[\\/]|\.{0,2}\/?[\w@.-]+\/)\S*\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const PROBLEM = /^\s+(?<line>\d+):(?<col>\d+)\s+(?<sev>error|warning)\s+(?<msg>.+?)(?:\s{2,}(?<rule>[@\w/-]+))?\s*$/;

export const eslintParser: LogParser = {
  source: "eslint",
  detect: (log) => /\d+ problems? \(\d+ errors?/.test(log) || /^\s+\d+:\d+\s+error\s+/m.test(log),
  parse(log) {
    const out: Failure[] = [];
    let currentFile: string | undefined;
    for (const raw of log.split("\n")) {
      const trimmed = raw.trim();
      if (FILE_HEADER.test(trimmed)) {
        currentFile = normalizePath(trimmed);
        continue;
      }
      const m = PROBLEM.exec(raw);
      if (m?.groups && currentFile && m.groups.sev === "error") {
        out.push({
          source: "eslint",
          title: m.groups.rule ?? "eslint",
          message: m.groups.msg!.trim(),
          file: currentFile,
          line: Number(m.groups.line),
          column: Number(m.groups.col),
        });
      }
    }
    return out;
  },
};
