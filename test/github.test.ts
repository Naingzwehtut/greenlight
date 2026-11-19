import { describe, expect, it } from "vitest";
import { openPullRequest, upsertComment, type Octokit } from "../src/github/api.js";
import { COMMENT_MARKER } from "../src/report/render.js";

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

type Comment = { id: number; body: string; user: { type: string } };

function fakeComments(comments: Comment[], forbidden: number[] = []) {
  const calls: string[] = [];
  const octokit = {
    paginate: async () => comments,
    rest: {
      issues: {
        listComments: () => undefined,
        updateComment: async (p: { comment_id: number }) => {
          calls.push(`update ${p.comment_id}`);
          if (forbidden.includes(p.comment_id)) throw Object.assign(new Error("Forbidden"), { status: 403 });
          return { data: { html_url: `c/${p.comment_id}` } };
        },
        createComment: async () => {
          calls.push("create");
          return { data: { html_url: "c/new" } };
        },
      },
    },
  } as unknown as Octokit;
  return { octokit, calls };
}

describe("upsertComment", () => {
  const report = `${COMMENT_MARKER}
## greenlight`;
  const bot = (id: number): Comment => ({ id, body: report, user: { type: "Bot" } });

  it("updates greenlight's own comment", async () => {
    const { octokit, calls } = fakeComments([bot(1)]);
    expect(await upsertComment(octokit, repo, 5, report)).toBe("c/1");
    expect(calls).toEqual(["update 1"]);
  });

  it("ignores a human comment that quotes a report", async () => {
    const quote: Comment = { id: 2, body: `Why did this happen?

${report}`, user: { type: "User" } };
    const { octokit, calls } = fakeComments([quote]);
    expect(await upsertComment(octokit, repo, 5, report)).toBe("c/new");
    expect(calls).toEqual(["create"]);
  });

  it("prefers the bot's comment when a user also posted one starting with the marker", async () => {
    const { octokit, calls } = fakeComments([bot(1), { id: 3, body: report, user: { type: "User" } }]);
    await upsertComment(octokit, repo, 5, report);
    expect(calls).toEqual(["update 1"]);
  });

  it("posts a new comment when the existing one cannot be edited", async () => {
    const { octokit, calls } = fakeComments([bot(4)], [4]);
    expect(await upsertComment(octokit, repo, 5, report)).toBe("c/new");
    expect(calls).toEqual(["update 4", "create"]);
  });
});
