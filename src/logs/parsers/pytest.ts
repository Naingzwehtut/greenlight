import type { Failure, LogParser } from "../types.js";
import { normalizePath } from "../clean.js";

// pytest's "short test summary info" is the most reliable list of failures:
//   FAILED tests/test_math.py::test_add - assert 3 == 4
//   ERROR tests/test_io.py - ModuleNotFoundError: No module named 'foo'
// The FAILURES section above it gives the location: "tests/test_math.py:5: AssertionError".
const SUMMARY = /^(?<kind>FAILED|ERROR)\s+(?<id>\S+?)(?:\s+-\s+(?<msg>.*))?$/;
const SECTION_TITLE = /^_{3,}\s+(?<name>.+?)\s+_{3,}$/;
const LOCATION = /^(?<file>[\w./\-]+\.py):(?<line>\d+):\s+(?<err>\w+)/;

export const pytestParser: LogParser = {
  source: "pytest",
  detect: (log) => /={3,} (?:FAILURES|ERRORS|short test summary info) ={3,}/.test(log) || /^FAILED \S+::/m.test(log),
  parse(log) {
    const lines = log.split("\n");
    const blocks = collectBlocks(lines);
    const out: Failure[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const m = SUMMARY.exec(line.trim());
      if (!m?.groups || seen.has(m.groups.id!)) continue;
      seen.add(m.groups.id!);
      const id = m.groups.id!;
      const [filePart, ...rest] = id.split("::");
      const testName = rest.join("::");
      const block = blocks.get(testName.replace(/::/g, ".")) ?? blocks.get(testName.split("::").pop() ?? "");
      const loc = block?.map((l) => LOCATION.exec(l.trim())).find((x) => x?.groups);
      const eLines = block?.filter((l) => /^E\s/.test(l)).map((l) => l.slice(1).trim()) ?? [];
      out.push({
        source: "pytest",
        title: id,
        message: eLines.length ? eLines.slice(0, 20).join("\n") : m.groups.msg ?? m.groups.kind!,
        file: loc?.groups ? normalizePath(loc.groups.file!) : normalizePath(filePart!),
        line: loc?.groups ? Number(loc.groups.line) : undefined,
        excerpt: block?.join("\n").trim(),
      });
    }
    return out;
  },
};

/** Map "test_add" (or "TestClass.test_add") to the lines of its FAILURES block. */
function collectBlocks(lines: string[]): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  let name: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (name) blocks.set(name, body);
  };
  for (const line of lines) {
    const t = SECTION_TITLE.exec(line.trim());
    if (t?.groups) {
      flush();
      name = t.groups.name!.replace(/^ERROR (?:at \w+ of )?/, "");
      body = [];
    } else if (/^={3,}/.test(line.trim())) {
      flush();
      name = undefined;
    } else if (name) {
      body.push(line);
    }
  }
  flush();
  return blocks;
}
