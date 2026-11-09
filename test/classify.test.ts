import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "../src/classify/index.js";
import { parseLog } from "../src/logs/index.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/logs/${name}`, import.meta.url), "utf8");

describe("classify", () => {
  it.each([
    ["vitest.log", "test"],
    ["jest.log", "test"],
    ["pytest.log", "test"],
    ["tsc.log", "type"],
    ["mypy.log", "type"],
    ["eslint.log", "lint"],
    ["ruff.log", "lint"],
  ])("%s is a fixable %s failure", (file, category) => {
    const d = classify(parseLog(fixture(file)));
    expect(d.category).toBe(category);
    expect(d.fixable).toBe(true);
  });

  it("treats npm resolution errors as dependency problems that are off by default", () => {
    const parsed = parseLog(fixture("generic.log"));
    expect(classify(parsed)).toMatchObject({ category: "dependency", fixable: false });
    expect(classify(parsed, { allowDependencyChanges: true }).fixable).toBe(true);
  });

  it("never tries to fix infrastructure failures, even if tests also failed", () => {
    const log = fixture("vitest.log") + "\nError: getaddrinfo ENOTFOUND registry.npmjs.org\n";
    expect(classify(parseLog(log))).toMatchObject({ category: "infra", fixable: false });
  });

  it("flags timeouts as flaky when they are the only failure", () => {
    const log = [
      " FAIL  src/api.test.ts > fetches users",
      "Error: Test timed out in 5000ms.",
      " ❯ src/api.test.ts:4:3",
      " Test Files  1 failed (1)",
    ].join("\n");
    expect(classify(parseLog(log))).toMatchObject({ category: "flaky", fixable: false });
  });

  it("returns unknown for logs it cannot read", () => {
    expect(classify(parseLog("something odd happened\n"))).toMatchObject({ category: "unknown", fixable: false });
  });
});
