import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attemptFix } from "../src/agent/loop.js";
import { runTool, type ToolContext } from "../src/agent/tools.js";
import type { Diagnosis } from "../src/classify/index.js";
import { loadConfig, type Config } from "../src/config.js";
import { createPathPolicy } from "../src/safety/paths.js";
import { call, makeRepo, ScriptedProvider } from "./helpers.js";

// A tiny project with no dependencies: `npm test` runs a plain Node script.
const project = {
  "package.json": JSON.stringify({ name: "demo", private: true, scripts: { test: "node test/math.test.js" } }),
  "src/math.js": "export function add(a, b) {\n  return a - b;\n}\n",
  "test/math.test.js":
    'import assert from "node:assert";\nimport { add } from "../src/math.js";\nassert.strictEqual(add(2, 3), 5);\nconsole.log("ok");\n',
};
const pkgWithModule = { ...project, "package.json": JSON.stringify({ ...JSON.parse(project["package.json"]), type: "module" }) };

const diagnosis: Diagnosis = {
  category: "test",
  fixable: true,
  reason: "1 test failed.",
  failures: [{ source: "generic", title: "AssertionError: 5 !== -1", message: "Expected 5, got -1", file: "test/math.test.js" }],
};

const config = (overrides: Partial<Config> = {}): Config => ({ ...loadConfig("/nonexistent-dir"), ...overrides });

describe("tools", () => {
  const ctx = (root: string, cfg = config()): ToolContext => ({
    root,
    policy: createPathPolicy(cfg),
    commands: { test: "npm test" },
    commandTimeout: 60,
    changed: new Set(),
  });

  it("reads files with line numbers and refuses to leave the repo", async () => {
    const root = makeRepo(pkgWithModule);
    const ok = await runTool("read_file", { path: "src/math.js", start_line: null, end_line: null }, ctx(root));
    expect(ok.content).toContain("    2    return a - b;");
    const bad = await runTool("read_file", { path: "../outside.txt", start_line: null, end_line: null }, ctx(root));
    expect(bad.isError).toBe(true);
  });

  it("edits only unique matches and tracks changed files", async () => {
    const root = makeRepo(pkgWithModule);
    const c = ctx(root);
    const r = await runTool("edit_file", { path: "src/math.js", old_text: "a - b", new_text: "a + b" }, c);
    expect(r.isError).toBeFalsy();
    expect(readFileSync(join(root, "src/math.js"), "utf8")).toContain("a + b");
    expect([...c.changed]).toEqual(["src/math.js"]);
    const missing = await runTool("edit_file", { path: "src/math.js", old_text: "nope", new_text: "x" }, c);
    expect(missing.content).toMatch(/not found/);
  });

  it("refuses to edit test files by default", async () => {
    const root = makeRepo(pkgWithModule);
    const r = await runTool("edit_file", { path: "test/math.test.js", old_text: "5", new_text: "-1" }, ctx(root));
    expect(r).toMatchObject({ isError: true });
    expect(r.content).toMatch(/test file/);
  });

  it("searches file contents", async () => {
    const root = makeRepo(pkgWithModule);
    const r = await runTool("search", { pattern: "export function", glob: null }, ctx(root));
    expect(r.content).toBe("src/math.js:1: export function add(a, b) {");
  });

  it("runs only named checks", async () => {
    const root = makeRepo(pkgWithModule);
    const r = await runTool("run_check", { name: "test" }, ctx(root));
    expect(r.content).toMatch(/FAILED/);
    const unknown = await runTool("run_check", { name: "rm -rf /" }, ctx(root));
    expect(unknown.isError).toBe(true);
  });
});

describe("attemptFix", () => {
  it("accepts a fix once the checks pass", async () => {
    const root = makeRepo(pkgWithModule);
    const provider = new ScriptedProvider([
      [call("run_check", { name: "test" })],
      [call("read_file", { path: "src/math.js", start_line: null, end_line: null })],
      [call("edit_file", { path: "src/math.js", old_text: "a - b", new_text: "a + b" })],
      [call("finish", { summary: "Fixed add().", root_cause: "add subtracted.", confidence: 0.95 })],
    ]);
    const result = await attemptFix({ root, diagnosis, log: "AssertionError", config: config(), provider });
    expect(result.status).toBe("fixed");
    expect(result.changedFiles).toEqual(["src/math.js"]);
    expect(result.diff).toContain("+  return a + b;");
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.report.confidence).toBe(0.95);
    expect(provider.session?.prompt).toContain("Category: test");
  });

  it("rejects finish while checks still fail, then reports partial", async () => {
    const root = makeRepo(pkgWithModule);
    const provider = new ScriptedProvider([
      [call("edit_file", { path: "src/math.js", old_text: "a - b", new_text: "a * b" })],
      [call("finish", { summary: "Done.", root_cause: "?", confidence: 0.9 })],
      [call("finish", { summary: "Done.", root_cause: "?", confidence: 0.9 })],
      [call("finish", { summary: "Gave up.", root_cause: "?", confidence: 0.2 })],
    ]);
    const result = await attemptFix({ root, diagnosis, log: "", config: config(), provider });
    expect(result.status).toBe("partial");
    // The first two finishes were sent back as errors with the failing output.
    const rejected = provider.inputs.flatMap((i) => i?.results ?? []).filter((r) => r.isError);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.content).toMatch(/still fails/);
  });

  it("rejects changes that skip tests", async () => {
    const root = makeRepo({
      ...pkgWithModule,
      "package.json": JSON.stringify({ name: "demo", type: "module", scripts: { test: "node --test test/" } }),
      "test/math.test.js":
        'import { test } from "node:test";\nimport assert from "node:assert";\nimport { add } from "../src/math.js";\ntest("adds", () => {\n  assert.strictEqual(add(2, 3), 5);\n});\n',
    });
    const provider = new ScriptedProvider([
      [call("edit_file", { path: "test/math.test.js", old_text: 'test("adds"', new_text: 'test.skip("adds"' })],
      [call("finish", { summary: "Skipped it.", root_cause: "-", confidence: 0.9 })],
    ]);
    const result = await attemptFix({ root, diagnosis, log: "", config: config({ allowTestChanges: true }), provider });
    expect(result.status).toBe("rejected");
    expect(result.violations.map((v) => v.rule)).toContain("skip-test");
  });

  it("reports no_change when the agent decides not to edit", async () => {
    const root = makeRepo(pkgWithModule);
    const provider = new ScriptedProvider([
      [call("finish", { summary: "No code change needed.", root_cause: "Network outage.", confidence: 0.1 })],
    ]);
    const result = await attemptFix({ root, diagnosis, log: "", config: config(), provider });
    expect(result).toMatchObject({ status: "no_change", changedFiles: [], diff: "" });
  });

  it("nudges once when the model stops without finish", async () => {
    const root = makeRepo(pkgWithModule);
    const provider = new ScriptedProvider([{ text: "I think it is fine." }, { text: "Still fine." }]);
    const result = await attemptFix({ root, diagnosis, log: "", config: config(), provider });
    expect(provider.inputs[1]?.text).toMatch(/call finish/);
    expect(result.status).toBe("no_change");
  });

  it("stops at the turn budget", async () => {
    const root = makeRepo(pkgWithModule);
    const provider = new ScriptedProvider([[call("list_files", { path: ".", depth: null })]]);
    const result = await attemptFix({ root, diagnosis, log: "", config: config({ maxIterations: 3 }), provider });
    expect(result.status).toBe("budget");
    expect(result.usage.turns).toBe(3);
  });
});
