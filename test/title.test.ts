import { describe, expect, it } from "vitest";
import { fixTitle, MAX_TITLE } from "../src/report/title.js";

describe("fixTitle", () => {
  it("uses the first sentence, lower-cased", () => {
    expect(fixTitle("Changed add() to return a + b. All checks pass.")).toBe("fix: changed add() to return a + b");
  });

  it("keeps acronyms and identifiers as written", () => {
    expect(fixTitle("API client now retries on 503.")).toBe("fix: API client now retries on 503");
    expect(fixTitle("TypeError in parseDate is handled.")).toBe("fix: TypeError in parseDate is handled");
  });

  it("falls back to a generic title when the summary is empty", () => {
    expect(fixTitle("   ")).toBe("fix: repair the failing CI checks");
  });

  it("cuts long titles at a word boundary with an ellipsis", () => {
    const t = fixTitle("Replaced the hand-written date parser with the standard library implementation to handle leap years.");
    expect(t.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(t.endsWith("…")).toBe(true);
    expect(t).toMatch(/ \w+…$/);
  });

  it("collapses newlines in the summary", () => {
    expect(fixTitle("Fixed the\nimport path")).toBe("fix: fixed the import path");
  });
});
