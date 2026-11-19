import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runProgram } from "../src/util/exec.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const cli = (...args: string[]) => runProgram(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: process.cwd(), timeoutSec: 60 });

describe("cli", () => {
  it.each(["--version", "-v"])("prints the package version for %s", async (flag) => {
    const r = await cli(flag);
    expect(r.exitCode).toBe(0);
    expect(r.output.trim()).toBe(pkg.version);
  });
});

describe("cli options", () => {
  it("passes --effort through config validation", async () => {
    const r = await cli("diagnose", "test/fixtures/logs/vitest.log", "--effort", "extreme");
    expect(r.exitCode).toBe(2);
    expect(r.output).toMatch(/effort/);
  });

  it("rejects a --max-tokens value below the minimum", async () => {
    const r = await cli("diagnose", "test/fixtures/logs/vitest.log", "--max-tokens", "5");
    expect(r.exitCode).toBe(2);
    expect(r.output).toMatch(/maxTokens/);
  });

  it("accepts valid values", async () => {
    const r = await cli("diagnose", "test/fixtures/logs/vitest.log", "--effort", "low", "--max-tokens", "50000");
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/^test/);
  });
});
