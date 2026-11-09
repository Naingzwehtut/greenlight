// Offline benchmark: how well does greenlight read CI logs?
//
// Each folder in bench/cases holds a CI log and the answer a careful human would give:
// the failure category, whether it is worth fixing, how many failures there are and
// which files they point at. No model is called, so the numbers are free and repeatable.
//
//   npm run bench            print a table
//   npm run bench -- --json  machine-readable output

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "../src/classify/index.js";
import { parseLog } from "../src/logs/index.js";

interface Expected {
  category: string;
  fixable: boolean;
  count: number;
  files: string[];
  messageIncludes?: string;
}

interface CaseResult {
  name: string;
  category: boolean;
  fixable: boolean;
  count: boolean;
  files: boolean;
  message: boolean;
  got: { category: string; fixable: boolean; count: number; files: string[] };
}

const casesDir = join(import.meta.dirname, "cases");
const results: CaseResult[] = [];

for (const name of readdirSync(casesDir).sort()) {
  const dir = join(casesDir, name);
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected;
  const d = classify(parseLog(readFileSync(join(dir, "log.log"), "utf8")));
  const files = [...new Set(d.failures.map((f) => f.file).filter((f): f is string => !!f))].sort();
  results.push({
    name,
    category: d.category === expected.category,
    fixable: d.fixable === expected.fixable,
    count: d.failures.length === expected.count,
    files: JSON.stringify(files) === JSON.stringify([...expected.files].sort()),
    message: !expected.messageIncludes || d.failures.some((f) => f.message.includes(expected.messageIncludes!)),
    got: { category: d.category, fixable: d.fixable, count: d.failures.length, files },
  });
}

const pct = (key: keyof Omit<CaseResult, "name" | "got">) =>
  Math.round((results.filter((r) => r[key]).length / results.length) * 100);
const allPass = results.filter((r) => r.category && r.fixable && r.count && r.files && r.message).length;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ cases: results.length, allPass, results }, null, 2));
} else {
  const mark = (b: boolean) => (b ? "✓" : "✗");
  console.log("case".padEnd(26) + "category  fixable  count  files  message");
  for (const r of results) {
    console.log(
      r.name.padEnd(26) +
        `${mark(r.category)}         ${mark(r.fixable)}        ${mark(r.count)}      ${mark(r.files)}      ${mark(r.message)}` +
        (r.category && r.fixable && r.count && r.files && r.message ? "" : `   got ${JSON.stringify(r.got)}`),
    );
  }
  console.log(
    `\n${results.length} cases · category ${pct("category")}% · fixable ${pct("fixable")}% · count ${pct("count")}% · files ${pct("files")}% · fully correct ${allPass}/${results.length}`,
  );
}

process.exitCode = allPass === results.length ? 0 : 1;
