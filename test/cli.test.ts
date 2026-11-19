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
