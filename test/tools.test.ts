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
