import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanLog, normalizePath, parseLog } from "../src/logs/index.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/logs/${name}`, import.meta.url), "utf8");

describe("cleanLog", () => {
  it("strips timestamps, ANSI codes and group markers", () => {
    const raw = "2026-11-02T10:15:01.1234567Z \x1b[31mred\x1b[0m\n##[group]Run x\nplain";
    expect(cleanLog(raw)).toBe("red\nplain");
  });
});

describe("normalizePath", () => {
  it("removes the GitHub runner workspace prefix", () => {
    expect(normalizePath("/home/runner/work/demo/demo/src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("src\\a.ts")).toBe("src/a.ts");
  });
});

describe("parseLog", () => {
  it("parses vitest failures with location", () => {
    const { failures, detected } = parseLog(fixture("vitest.log"));
    expect(detected).toContain("vitest");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      source: "vitest",
      title: "src/math.test.ts > add > handles negatives",
      file: "src/math.test.ts",
      line: 12,
      column: 28,
    });
    expect(failures[0]!.message).toContain("expected -1 to be 1");
  });

  it("parses jest failures and points at the failing frame", () => {
    const { failures } = parseLog(fixture("jest.log"));
    expect(failures.map((f) => f.title)).toEqual([
      "src/cart.test.js › Cart › applies discount",
      "src/cart.test.js › Cart › empty cart total is zero",
    ]);
    expect(failures[0]).toMatchObject({ file: "src/cart.test.js", line: 14 });
    expect(failures[1]!.message).toContain("Cannot read properties of undefined");
  });

  it("parses both tsc output formats", () => {
    const { failures } = parseLog(fixture("tsc.log"));
    expect(failures.map((f) => `${f.file}:${f.line} ${f.title}`)).toEqual([
      "src/api/user.ts:14 TS2322",
      "src/api/user.ts:22 TS2339",
      "src/index.ts:3 TS2305",
    ]);
  });

  it("parses eslint errors and ignores warnings", () => {
    const { failures } = parseLog(fixture("eslint.log"));
    expect(failures).toEqual([
      expect.objectContaining({ file: "src/utils.ts", line: 4, title: "@typescript-eslint/no-unused-vars" }),
      expect.objectContaining({ file: "src/app.ts", line: 21, title: "eqeqeq" }),
    ]);
  });

  it("parses pytest summary and finds the source location", () => {
    const { failures } = parseLog(fixture("pytest.log"));
    expect(failures).toHaveLength(2);
    // The location is where the exception was raised, not the test line.
    expect(failures[0]).toMatchObject({ title: "tests/test_math.py::test_div", file: "src/mathlib.py", line: 6 });
    expect(failures[0]!.message).toContain("ZeroDivisionError");
    expect(failures[1]).toMatchObject({
      title: "tests/test_parse.py::TestParse::test_date",
      file: "tests/test_parse.py",
      line: 15,
    });
  });

  it("parses mypy errors", () => {
    const { failures } = parseLog(fixture("mypy.log"));
    expect(failures.map((f) => [f.file, f.line, f.title])).toEqual([
      ["src/app.py", 10, "return-value"],
      ["src/app.py", 22, "name-defined"],
    ]);
  });

  it("parses ruff concise and full formats", () => {
    const { failures } = parseLog(fixture("ruff.log"));
    expect(failures.map((f) => [f.file, f.line, f.title])).toEqual([
      ["src/app.py", 1, "F401"],
      ["src/util.py", 7, "F841"],
    ]);
  });

  it("falls back to the generic parser", () => {
    const { failures, detected } = parseLog(fixture("generic.log"));
    expect(detected).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.source).toBe("generic");
    expect(failures[0]!.message).toContain("ERESOLVE");
  });
});
