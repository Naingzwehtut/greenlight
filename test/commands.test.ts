import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCommandSet, detectPackageManager, projectCommands, reproduceCommand } from "../src/agent/commands.js";
import { loadConfig } from "../src/config.js";
import { parseLog } from "../src/logs/index.js";
import { makeRepo } from "./helpers.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/logs/${name}`, import.meta.url), "utf8");
const cfg = loadConfig("/nonexistent-dir");

describe("detectPackageManager", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ])("%s means %s", (lockfile, pm) => {
    expect(detectPackageManager(makeRepo({ [lockfile]: "" }))).toBe(pm);
  });
});

describe("reproduceCommand", () => {
  const root = makeRepo({ "package-lock.json": "{}" });

  it("re-runs only the failing test files", () => {
    expect(reproduceCommand(root, parseLog(fixture("vitest.log")).failures, cfg)).toBe("npx vitest run src/math.test.ts");
    expect(reproduceCommand(root, parseLog(fixture("jest.log")).failures, cfg)).toBe("npx jest src/cart.test.js");
  });

  it("uses node ids for pytest", () => {
    expect(reproduceCommand(root, parseLog(fixture("pytest.log")).failures, cfg)).toBe(
      "python -m pytest tests/test_math.py::test_div tests/test_parse.py::TestParse::test_date",
    );
  });

  it("lints only the failing files", () => {
    expect(reproduceCommand(root, parseLog(fixture("eslint.log")).failures, cfg)).toBe("npx eslint src/utils.ts src/app.ts");
    expect(reproduceCommand(root, parseLog(fixture("ruff.log")).failures, cfg)).toBe("ruff check src/app.py src/util.py");
  });

  it("uses the package manager's exec command", () => {
    const pnpmRoot = makeRepo({ "pnpm-lock.yaml": "" });
    expect(reproduceCommand(pnpmRoot, parseLog(fixture("tsc.log")).failures, cfg)).toBe("pnpm exec tsc --noEmit");
  });

  it("returns undefined for generic failures", () => {
    expect(reproduceCommand(root, parseLog(fixture("generic.log")).failures, cfg)).toBeUndefined();
  });
});

describe("projectCommands", () => {
  it("reads package.json scripts", () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } }),
    });
    expect(projectCommands(root, cfg)).toEqual({ test: "npm run test", typecheck: "npm run typecheck", lint: "npm run lint" });
  });

  it("prefers configured commands and detects Python projects", () => {
    const root = makeRepo({ "pyproject.toml": "[project]\nname='x'\n" });
    expect(projectCommands(root, { ...cfg, commands: { lint: "ruff check ." } })).toEqual({
      test: "python -m pytest",
      lint: "ruff check .",
    });
  });

  it("puts reproduce first", () => {
    const root = makeRepo({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    expect(Object.keys(buildCommandSet(root, parseLog(fixture("vitest.log")).failures, cfg))).toEqual(["reproduce", "test"]);
  });
});
