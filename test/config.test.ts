import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveModel } from "../src/config.js";

const tmp = () => mkdtempSync(join(tmpdir(), "greenlight-config-"));

describe("loadConfig", () => {
  it("uses safe defaults when there is no config file", () => {
    const cfg = loadConfig(tmp());
    expect(cfg).toMatchObject({
      provider: "anthropic",
      mode: "pr",
      allowTestChanges: false,
      allowDependencyChanges: false,
    });
    expect(resolveModel(cfg)).toBe("claude-opus-5-5");
  });

  it("reads .greenlight.yml and lets overrides win", () => {
    const dir = tmp();
    writeFileSync(join(dir, ".greenlight.yml"), "mode: comment\nmaxIterations: 5\ncommands:\n  test: pnpm test\n");
    const cfg = loadConfig(dir, { maxIterations: 8, model: undefined });
    expect(cfg.mode).toBe("comment");
    expect(cfg.maxIterations).toBe(8);
    expect(cfg.commands.test).toBe("pnpm test");
  });

  it("reports invalid values clearly", () => {
    const dir = tmp();
    writeFileSync(join(dir, ".greenlight.yml"), "mode: yolo\n");
    expect(() => loadConfig(dir)).toThrow(/mode/);
  });
});
