import type { Failure, LogParser } from "../types.js";
import { normalizePath } from "../clean.js";

// Jest output:
//   FAIL src/math.test.js
//     ● add › adds two numbers
//
//       expect(received).toBe(expected) // Object.is equality
//       ...
//         at Object.toBe (src/math.test.js:4:20)
const FILE_HEADER = /^\s*FAIL\s+(?<file>\S+\.(?:[cm]?[jt]sx?))\s*(?:\(.*\))?\s*$/;
const TEST_HEADER = /^\s*●\s+(?<name>.+?)\s*$/;
const STACK = /\(?(?<file>[^\s():]+\.(?:[cm]?[jt]sx?)):(?<line>\d+):(?<col>\d+)\)?/;

export const jestParser: LogParser = {
  source: "jest",
  detect: (log) => /^\s*●\s/m.test(log) && /Tests:\s+.*\d+ failed/.test(log),
  parse(log) {
    const lines = log.split("\n");
    const out: Failure[] = [];
    let currentFile: string | undefined;
    for (let i = 0; i < lines.length; i++) {
      const fileMatch = FILE_HEADER.exec(lines[i]!);
      if (fileMatch?.groups) {
        currentFile = normalizePath(fileMatch.groups.file!);
        continue;
      }
      const t = TEST_HEADER.exec(lines[i]!);
      if (!t?.groups || t.groups.name!.startsWith("Console")) continue;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (TEST_HEADER.test(l) || FILE_HEADER.test(l) || /^(Test Suites|Tests):/.test(l.trim())) break;
        body.push(l);
      }
      // Prefer a stack frame inside the failing test file; fall back to the first frame.
      const frames = body
        .map((l) => (/^\s*at\s/.test(l) ? STACK.exec(l) : null))
        .filter((m): m is RegExpExecArray => !!m?.groups && !m.groups.file!.includes("node_modules"));
      const frame =
        frames.find((m) => currentFile && normalizePath(m.groups!.file!).endsWith(currentFile)) ?? frames[0];
      const message = body
        .filter((l) => !/^\s*at\s/.test(l))
        .map((l) => l.replace(/^ {4}/, ""))
        .join("\n")
        .trim()
        .split("\n")
        .slice(0, 25)
        .join("\n");
      out.push({
        source: "jest",
        title: currentFile ? `${currentFile} › ${t.groups.name}` : t.groups.name!,
        message,
        file: frame?.groups ? normalizePath(frame.groups.file!) : currentFile,
        line: frame?.groups ? Number(frame.groups.line) : undefined,
        column: frame?.groups ? Number(frame.groups.col) : undefined,
        excerpt: body.join("\n").trim(),
      });
      i = j - 1;
    }
    return out;
  },
};
