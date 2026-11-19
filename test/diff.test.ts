import { describe, expect, it } from "vitest";
import { findTampering, parseUnifiedDiff } from "../src/safety/tampering.js";

describe("parseUnifiedDiff", () => {
  it("treats lines that look like headers inside a hunk as content", () => {
    const d = [
      "diff --git a/src/a.c b/src/a.c",
      "--- a/src/a.c",
      "+++ b/src/a.c",
      "@@ -1,2 +1,2 @@",
      "---counter;",
      "+++counter;",
    ].join("\n");
    const [f] = parseUnifiedDiff(d);
    expect(f!.removed).toEqual(["--counter;"]);
    expect(f!.added).toEqual(["++counter;"]);
  });

  it("still flags a removed assertion that starts with dashes", () => {
    const d = [
      "diff --git a/tests/test_a.py b/tests/test_a.py",
      "--- a/tests/test_a.py",
      "+++ b/tests/test_a.py",
      "@@ -1,2 +1,1 @@",
      "--- assert total == 3",
    ].join("\n");
    expect(findTampering(d, () => true).map((v) => v.rule)).toEqual(["remove-assertion"]);
  });

  it("reads several files", () => {
    const one = (f: string) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-a\n+b`;
    expect(parseUnifiedDiff(`${one("x.ts")}\n${one("y.ts")}`).map((f) => [f.file, f.added, f.removed])).toEqual([
      ["x.ts", ["b"], ["a"]],
      ["y.ts", ["b"], ["a"]],
    ]);
  });
});

describe("skip-test rule", () => {
  const added = (line: string) =>
    findTampering(`diff --git a/a.test.ts b/a.test.ts\n--- a/a.test.ts\n+++ b/a.test.ts\n@@ -1 +1 @@\n+${line}`, () => true).map((v) => v.rule);

  it.each([
    'it.skipIf(process.env.CI)("adds", () => {',
    'describe.skipIf(true)("math", () => {',
    "    this.skip();",
    'it.skip("adds", () => {',
  ])("flags %j", (line) => {
    expect(added(line)).toContain("skip-test");
  });

  it("does not flag ordinary code", () => {
    expect(added("const skipped = items.filter(skipIfEmpty);")).toEqual([]);
  });
});

describe("silence-lint rule", () => {
  const added = (file: string, line: string) =>
    findTampering(`diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n+${line}`, () => false).map((v) => v.rule);

  it.each([
    ["src/app.py", "def f():  # pylint: disable=unused-argument"],
    ["main.go", "x := y //nolint:errcheck"],
    ["main.go", "x := y // nolint"],
    ["lib/a.rb", "# rubocop:disable Style/StringLiterals"],
    ["src/a.ts", "// oxlint-disable-next-line no-unused-vars"],
  ])("flags a suppression in %s", (file, line) => {
    expect(added(file, line)).toEqual(["silence-lint"]);
  });

  it("does not flag the word nolint inside an identifier", () => {
    expect(added("main.go", "useNolintCache := true")).toEqual([]);
  });
});
