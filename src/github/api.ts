import type { getOctokit } from "@actions/github";
import { COMMENT_MARKER } from "../report/render.js";

export type Octokit = ReturnType<typeof getOctokit>;

export interface Repo {
  owner: string;
  repo: string;
}

export interface FailedRun {
  id: number;
  url: string;
  headBranch: string;
  headSha: string;
  headRepoFullName: string;
  /** Open PR numbers in this repository whose CI this run belongs to. */
  pullRequests: number[];
  workflowName: string;
}

export interface JobLog {
  jobId: number;
  name: string;
  failedSteps: string[];
  log: string;
}

export async function getRun(octokit: Octokit, repo: Repo, runId: number): Promise<FailedRun> {
  const { data } = await octokit.rest.actions.getWorkflowRun({ ...repo, run_id: runId });
  return {
    id: data.id,
    url: data.html_url,
    headBranch: data.head_branch ?? "",
    headSha: data.head_sha,
    headRepoFullName: data.head_repository?.full_name ?? `${repo.owner}/${repo.repo}`,
    pullRequests: (data.pull_requests ?? []).map((p) => p.number),
    workflowName: data.name ?? "CI",
  };
}

/** Download the logs of every failed job in a run. */
export async function getFailedJobLogs(octokit: Octokit, repo: Repo, runId: number): Promise<JobLog[]> {
  const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
    ...repo,
    run_id: runId,
    filter: "latest",
    per_page: 100,
  });
  const failed = jobs.filter((j) => j.conclusion === "failure");
  const out: JobLog[] = [];
  for (const job of failed) {
    const res = await octokit.rest.actions.downloadJobLogsForWorkflowRun({ ...repo, job_id: job.id });
    out.push({
      jobId: job.id,
      name: job.name,
      failedSteps: (job.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => s.name),
      log: typeof res.data === "string" ? res.data : String(res.data),
    });
  }
  return out;
}

/** Create or update greenlight's comment on a PR, so repeated runs do not spam it. */
export async function upsertComment(octokit: Octokit, repo: Repo, issueNumber: number, body: string): Promise<string> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { ...repo, issue_number: issueNumber, per_page: 100 });
  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
  if (existing) {
    const { data } = await octokit.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
    return data.html_url;
  }
  const { data } = await octokit.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
  return data.html_url;
}

export async function openPullRequest(
  octokit: Octokit,
  repo: Repo,
  opts: { head: string; base: string; title: string; body: string; labels: string[] },
): Promise<{ number: number; url: string }> {
  const { data } = await octokit.rest.pulls.create({
    ...repo,
    head: opts.head,
    base: opts.base,
    title: opts.title,
    body: opts.body,
  });
  if (opts.labels.length) {
    try {
      await octokit.rest.issues.addLabels({ ...repo, issue_number: data.number, labels: opts.labels });
    } catch {
      // Labels are optional; a missing permission should not fail the run.
    }
  }
  return { number: data.number, url: data.html_url };
}

/** The open PR (if any) for a branch, used when a run's pull_requests list is empty. */
export async function findPullRequestForBranch(octokit: Octokit, repo: Repo, branch: string): Promise<number | undefined> {
  const { data } = await octokit.rest.pulls.list({ ...repo, state: "open", head: `${repo.owner}:${branch}`, per_page: 1 });
  return data[0]?.number;
}
