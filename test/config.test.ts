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

describe("config file errors", () => {
  const withConfig = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), "greenlight-config-"));
    writeFileSync(join(dir, ".greenlight.yml"), text);
    return dir;
  };

  it("names the file when the YAML does not parse", () => {
    expect(() => loadConfig(withConfig("mode: [pr\n"))).toThrow(/Could not parse \.greenlight\.yml/);
  });

  it("rejects a file that is a list instead of a mapping", () => {
    expect(() => loadConfig(withConfig("- mode: pr\n"))).toThrow(/must be a mapping .* not a list/);
  });

  it("rejects a file that is a plain string", () => {
    expect(() => loadConfig(withConfig("just some text\n"))).toThrow(/must be a mapping .* not a string/);
  });

  it("treats a comments-only file as defaults", () => {
    expect(loadConfig(withConfig("# nothing yet\n")).mode).toBe("pr");
  });

  it("names the file in validation errors", () => {
    expect(() => loadConfig(withConfig("mode: yolo\n"))).toThrow(/\(\.greenlight\.yml and inputs\)[\s\S]*mode/);
  });
});
