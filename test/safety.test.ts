import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Budget, BudgetExceeded } from "../src/safety/budget.js";
import { createPathPolicy, PathError, resolveInRoot } from "../src/safety/paths.js";
import { findTampering } from "../src/safety/tampering.js";

describe("resolveInRoot", () => {
  it("accepts paths inside the repo", () => {
    expect(resolveInRoot("/repo", "src/a.ts").rel).toBe("src/a.ts");
    expect(resolveInRoot("/repo", "./src/../src/a.ts").rel).toBe("src/a.ts");
  });

  it.each(["../etc/passwd", "/etc/passwd", "src/../../x", "", "."])("rejects %j", (p) => {
    expect(() => resolveInRoot("/repo", p)).toThrow(PathError);
  });
});

describe("path policy", () => {
  const policy = createPathPolicy(loadConfig("/nonexistent-dir"));

  it("blocks workflows, lockfiles and secrets", () => {
    expect(policy.writeDenied(".github/workflows/ci.yml")).toMatch(/deny/);
    expect(policy.writeDenied("package-lock.json")).toMatch(/deny/);
    expect(policy.writeDenied(".env.local")).toMatch(/deny/);
    expect(policy.canRead(".env")).toBe(false);
  });

  it("blocks test files and manifests by default", () => {
    expect(policy.writeDenied("src/math.test.ts")).toMatch(/test file/);
    expect(policy.writeDenied("tests/test_math.py")).toMatch(/test file/);
    expect(policy.writeDenied("package.json")).toMatch(/manifest/);
    expect(policy.writeDenied("src/math.ts")).toBeNull();
  });

  it("allows test edits when configured", () => {
    const p = createPathPolicy({ ...loadConfig("/nonexistent-dir"), allowTestChanges: true });
    expect(p.writeDenied("src/math.test.ts")).toBeNull();
  });
});

describe("findTampering", () => {
  const isTest = (f: string) => /\.test\.ts$|^tests\//.test(f);
  const diff = (file: string, body: string) =>
    `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,3 @@\n${body}\n`;

  it("flags skipped tests", () => {
    const v = findTampering(diff("src/a.test.ts", '-it("adds", () => {\n+it.skip("adds", () => {'), isTest);
    expect(v.map((x) => x.rule)).toContain("skip-test");
  });

  it("flags removed assertions in tests", () => {
    const v = findTampering(diff("src/a.test.ts", "-  expect(add(1, 2)).toBe(3);"), isTest);
    expect(v.map((x) => x.rule)).toEqual(["remove-assertion"]);
  });

  it("ignores assertions that only moved", () => {
    const v = findTampering(diff("src/a.test.ts", "-  expect(x).toBe(1);\n+  expect(x).toBe(1);"), isTest);
    expect(v).toEqual([]);
  });

  it("flags suppression comments in source", () => {
    const v = findTampering(diff("src/a.ts", "+  // @ts-ignore\n+  // eslint-disable-next-line\n+x = 1  # type: ignore"), isTest);
    expect(v.map((x) => x.rule)).toEqual(["silence-typecheck", "silence-typecheck", "silence-lint"]);
  });

  it("flags deleted test files", () => {
    const d = "diff --git a/tests/test_a.py b/tests/test_a.py\ndeleted file mode 100644\n--- a/tests/test_a.py\n+++ /dev/null\n-def test_a():\n-    assert 1";
    expect(findTampering(d, isTest).map((x) => x.rule)).toEqual(["delete-test-file"]);
  });

  it("accepts a real fix", () => {
    expect(findTampering(diff("src/math.ts", "-  return a - b;\n+  return a + b;"), isTest)).toEqual([]);
  });
});

describe("Budget", () => {
  it("stops at the turn limit and token limit", () => {
    const b = new Budget(100, 2);
    b.record({ inputTokens: 10, outputTokens: 5 });
    expect(() => b.check()).not.toThrow();
    b.record({ inputTokens: 90, outputTokens: 5 });
    expect(() => b.check()).toThrow(BudgetExceeded);
  });
});
