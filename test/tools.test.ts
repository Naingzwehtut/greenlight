import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTool, type ToolContext } from "../src/agent/tools.js";
import { loadConfig } from "../src/config.js";
import { createPathPolicy } from "../src/safety/paths.js";
import { makeRepo } from "./helpers.js";

const ctx = (root: string): ToolContext => ({
  root,
  policy: createPathPolicy(loadConfig("/nonexistent-dir")),
  commands: {},
  commandTimeout: 30,
  changed: new Set(),
});

describe("search", () => {
  it("does not follow symlinks out of the repository", async () => {
    const outside = mkdtempSync(join(tmpdir(), "greenlight-outside-"));
    writeFileSync(join(outside, "secret.txt"), "TOKEN=abc123\n");
    const root = makeRepo({ "src/a.ts": "const TOKEN = process.env.TOKEN;\n" });
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "src/linked.txt"), "file");
      symlinkSync(outside, join(root, "linked-dir"), "junction");
    } catch {
      return; // symlinks not permitted on this machine
    }
    const r = await runTool("search", { pattern: "TOKEN", glob: null }, ctx(root));
    expect(r.content).toContain("src/a.ts:1:");
    expect(r.content).not.toContain("abc123");
    expect(r.content).not.toContain("linked");
  });
});

describe("read_file", () => {
  const root = makeRepo({ "a.txt": "one\ntwo\nthree\n", "empty.txt": "" });
  const read = (path: string, start: number | null = null, end: number | null = null) =>
    runTool("read_file", { path, start_line: start, end_line: end }, ctx(root));

  it("does not count the final newline as an extra line", async () => {
    const r = await read("a.txt");
    expect(r.content).toContain("(lines 1-3 of 3)");
    expect(r.isError).toBeFalsy();
  });

  it("explains a start line past the end of the file", async () => {
    const r = await read("a.txt", 10);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/has 3 lines; start_line 10 is past the end/);
  });

  it("rejects an end line before the start line", async () => {
    const r = await read("a.txt", 3, 1);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/end_line \(1\) is before start_line \(3\)/);
  });

  it("reports an empty file", async () => {
    expect((await read("empty.txt")).content).toBe("empty.txt is empty.");
  });
});
