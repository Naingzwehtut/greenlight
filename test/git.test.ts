import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitAndPush } from "../src/github/git.js";
import { runProgram } from "../src/util/exec.js";
import { makeRepo } from "./helpers.js";

describe("runProgram", () => {
  it("passes arguments without shell expansion", async () => {
    const r = await runProgram("node", ["-e", "console.log(process.argv[1])", "$(echo hi) `x` \"q\""], { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.output.trim()).toBe("$(echo hi) `x` \"q\"");
  });
});

describe("commitAndPush", () => {
  it("never runs shell syntax from file names or the commit message", async () => {
    const root = makeRepo({ "a.ts": "1\n" });
    const remote = mkdtempSync(join(tmpdir(), "greenlight-remote-"));
    execSync("git init -q --bare", { cwd: remote });
    execSync(`git remote add origin "${remote}"`, { cwd: root });

    const name = "b$(touch pwned-file).ts";
    writeFileSync(join(root, name), "2\n");
    writeFileSync(join(root, "a.ts"), "3\n");
    const message = 'fix: handle "$HOME" and `touch pwned-msg`';
    await commitAndPush(root, { branch: "greenlight/run-1", files: ["a.ts", name], message, createBranch: true });

    expect(existsSync(join(root, "pwned-file"))).toBe(false);
    expect(existsSync(join(root, "pwned-msg"))).toBe(false);
    const log = execSync("git log -1 --format=%B greenlight/run-1", { cwd: remote, encoding: "utf8" }).trim();
    expect(log).toBe(message);
    const files = execSync("git show --name-only --format= greenlight/run-1", { cwd: remote, encoding: "utf8" });
    expect(files).toContain(name);
  });
});

describe("gitDiff", () => {
  it("includes new files with shell characters in their names, without running them", async () => {
    const { gitDiff } = await import("../src/agent/loop.js");
    const root = makeRepo({ "a.ts": "1\n" });
    const name = "c$(touch pwned-diff).ts";
    writeFileSync(join(root, name), "new\n");
    const diff = await gitDiff(root, [name]);
    expect(diff).toContain(`b/${name}`);
    expect(existsSync(join(root, "pwned-diff"))).toBe(false);
  });
});
