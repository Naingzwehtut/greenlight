import { describe, expect, it } from "vitest";
import { appendCapped, runCommand } from "../src/util/exec.js";

describe("appendCapped", () => {
  it("keeps everything under the limit", () => {
    expect(appendCapped("a\n", "b\n", 100)).toBe("a\nb\n");
  });

  it("keeps the end of the output once it is too long", () => {
    const out = appendCapped("early line\n".repeat(10), "FAILED tests/x.py::test_a\n", 40);
    expect(out).toContain("FAILED tests/x.py::test_a");
    expect(out.startsWith("(earlier output dropped)")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40 + "(earlier output dropped) …\n".length);
  });
});

describe("runCommand", () => {
  it("captures output and the exit code", async () => {
    const r = await runCommand(`node -e "console.log('hi'); process.exit(3)"`, { cwd: process.cwd(), timeoutSec: 30 });
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain("hi");
    expect(r.timedOut).toBe(false);
  });
});
