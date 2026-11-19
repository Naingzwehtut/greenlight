import { describe, expect, it } from "vitest";
import { openPullRequest, type Octokit } from "../src/github/api.js";

const repo = { owner: "o", repo: "r" };
const opts = { head: "greenlight/run-1", base: "main", title: "fix: x", body: "report", labels: ["greenlight"] };

/** A minimal stand-in for the Octokit REST client that records calls. */
function fakeOctokit(openPrs: number[]) {
  const calls: string[] = [];
  const octokit = {
    rest: {
      pulls: {
        list: async (p: { head: string; base: string }) => {
          calls.push(`list ${p.head} ${p.base}`);
          return { data: openPrs.map((number) => ({ number })) };
        },
        create: async () => {
          calls.push("create");
          return { data: { number: 7, html_url: "https://github.com/o/r/pull/7" } };
        },
        update: async (p: { pull_number: number; body: string }) => {
          calls.push(`update ${p.pull_number} ${p.body}`);
          return { data: { number: p.pull_number, html_url: `https://github.com/o/r/pull/${p.pull_number}` } };
        },
      },
      issues: {
        addLabels: async (p: { issue_number: number }) => {
          calls.push(`label ${p.issue_number}`);
          return { data: [] };
        },
      },
    },
  } as unknown as Octokit;
  return { octokit, calls };
}

describe("openPullRequest", () => {
  it("creates a PR when none is open for the branch", async () => {
    const { octokit, calls } = fakeOctokit([]);
    const pr = await openPullRequest(octokit, repo, opts);
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
    expect(calls).toEqual(["list o:greenlight/run-1 main", "create", "label 7"]);
  });

  it("updates the open PR on a re-run instead of creating a duplicate", async () => {
    const { octokit, calls } = fakeOctokit([3]);
    const pr = await openPullRequest(octokit, repo, opts);
    expect(pr.number).toBe(3);
    expect(calls).toEqual(["list o:greenlight/run-1 main", "update 3 report", "label 3"]);
  });
});
