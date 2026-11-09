import { cleanLog } from "./clean.js";
import { eslintParser } from "./parsers/eslint.js";
import { genericParser } from "./parsers/generic.js";
import { jestParser } from "./parsers/jest.js";
import { mypyParser, ruffParser } from "./parsers/python-lint.js";
import { pytestParser } from "./parsers/pytest.js";
import { tscParser } from "./parsers/tsc.js";
import { vitestParser } from "./parsers/vitest.js";
import type { LogParser, ParsedLog } from "./types.js";

export * from "./types.js";
export { cleanLog, normalizePath, tail, truncate } from "./clean.js";

/** Specific parsers, in the order they are tried. The generic parser is the fallback. */
export const parsers: LogParser[] = [
  vitestParser,
  jestParser,
  tscParser,
  eslintParser,
  pytestParser,
  mypyParser,
  ruffParser,
];

export function parseLog(raw: string): ParsedLog {
  const cleaned = cleanLog(raw);
  const detected: ParsedLog["detected"] = [];
  const failures: ParsedLog["failures"] = [];
  for (const p of parsers) {
    if (!p.detect(cleaned)) continue;
    detected.push(p.source);
    failures.push(...p.parse(cleaned));
  }
  if (failures.length === 0) failures.push(...genericParser.parse(cleaned));
  return { failures, detected, cleaned };
}
