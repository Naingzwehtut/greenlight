import { describe, expect, it } from "vitest";
import type { AttemptResult } from "../src/agent/loop.js";
import type { Diagnosis } from "../src/classify/index.js";
import { COMMENT_MARKER, confidenceBar, renderReport } from "../src/report/render.js";

const diagnosis: Diagnosis = {
  category: "test",
  fixable: true,
  reason: "1 test failed.",
  failures: [{ source: "vitest", title: "src/a.test.ts > adds", message: "expected 1 to be 2", file: "src/a.test.ts", line: 3 }],
};

const attempt: AttemptResult = {
  status: "fixed",
  report: { summary: "Changed - to +.", rootCause: "add() subtracted.", confidence: 0.9 },
  changedFiles: ["src/a.ts"],
  diff: "diff --git a/src/a.ts b/src/a.ts\n-  return a - b;\n+  return a + b;\n",
  checks: [{ name: "reproduce", command: "npx vitest run src/a.test.ts", passed: true, output: "" }],
  violations: [],
  usage: { inputTokens: 12000, outputTokens: 800, turns: 5 },
  commands: {},
};

describe("renderReport", () => {
  it("renders a fixed attempt", () => {
    const md = renderReport({ diagnosis, attempt, runUrl: "https://example.com/run/1", prUrl: "https://example.com/pr/2" });
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain("✅ **Fixed.**");
    expect(md).toContain("**Fix:** https://example.com/pr/2");
    expect(md).toContain("**Root cause:** add() subtracted.");
    expect(md).toContain("| `npx vitest run src/a.test.ts` | ✅ pass |");
    expect(md).toContain("+  return a + b;");
    expect(md).toContain("5 model turns · 12,800 tokens");
  });

  it("renders a diagnosis-only report", () => {
    const md = renderReport({ diagnosis: { ...diagnosis, category: "infra", fixable: false, reason: "A network request failed." }, skippedReason: "Not a code problem." });
    expect(md).toContain("Diagnosis only.** Not a code problem.");
    expect(md).toContain("infra — A network request failed.");
    expect(md).not.toContain("Confidence");
  });

  it("hides the diff of rejected attempts", () => {
    const md = renderReport({
      diagnosis,
      attempt: { ...attempt, status: "rejected", violations: [{ file: "src/a.test.ts", line: "it.skip(", rule: "skip-test" }] },
    });
    expect(md).toContain("Rejected changes");
    expect(md).not.toContain("```diff");
  });
});

describe("confidenceBar", () => {
  it("draws ten cells", () => {
    expect(confidenceBar(0.7)).toBe("███████░░░ 70%");
    expect(confidenceBar(0)).toBe("░░░░░░░░░░ 0%");
  });
});
