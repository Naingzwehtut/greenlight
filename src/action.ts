import * as core from "@actions/core";
import * as github from "@actions/github";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectPackageManager } from "./agent/commands.js";
import { loadConfig, type Config } from "./config.js";
import {
  findPullRequestForBranch,
  getFailedJobLogs,
  getRun,
  openPullRequest,
  upsertComment,
  type FailedRun,
  type Octokit,
  type Repo,
} from "./github/api.js";
import { commitAndPush } from "./github/git.js";
import { createProvider } from "./providers/index.js";
import { renderReport } from "./report/render.js";
import { runGreenlight, shouldPublish } from "./run.js";
import { runCommand } from "./util/exec.js";
import type { Logger } from "./util/logger.js";

const logger: Logger = {
  info: (m) => core.info(m),
  warn: (m) => core.warning(m),
  error: (m) => core.error(m),
  debug: (m) => core.debug(m),
};

function input(name: string): string | undefined {
  const v = core.getInput(name);
  return v === "" ? undefined : v;
}
function numberInput(name: string): number | undefined {
  const v = input(name);
  return v === undefined ? undefined : Number(v);
}

async function main(): Promise<void> {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const repo: Repo = github.context.repo;

  // Secrets reach the providers through the environment.
  const anthropicKey = input("anthropic-api-key");
  const openaiKey = input("openai-api-key");
  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;
  if (openaiKey) process.env.OPENAI_API_KEY = openaiKey;

  const config = loadConfig(root, {
    provider: input("provider"),
    model: input("model"),
    mode: input("mode"),
    effort: input("effort"),
    maxIterations: numberInput("max-iterations"),
    minConfidence: numberInput("min-confidence"),
  });

  const octokit = github.getOctokit(core.getInput("github-token", { required: true }));
  const runId = numberInput("run-id") ?? (github.context.payload.workflow_run?.id as number | undefined);
  if (!runId) {
    core.setFailed("No workflow run to inspect. Trigger greenlight on workflow_run, or pass the run-id input.");
    return;
  }
  const conclusion = github.context.payload.workflow_run?.conclusion as string | undefined;
  if (conclusion && conclusion !== "failure") {
    core.info(`The run concluded with "${conclusion}", nothing to fix.`);
    return;
  }

  const run = await getRun(octokit, repo, runId);
  core.info(`Inspecting ${run.workflowName} run ${run.id} on ${run.headBranch} (${run.headSha.slice(0, 7)})`);

  // Never try to fix greenlight's own branches; that could loop.
  if (run.headBranch.startsWith(config.branchPrefix)) {
    core.info(`Skipping: ${run.headBranch} is a greenlight branch.`);
    return;
  }
  const isFork = run.headRepoFullName.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase();
  const effective: Config = isFork ? { ...config, mode: "comment" } : config;
  if (isFork) core.info("The run comes from a fork, so greenlight will only comment.");

  await checkoutSha(root, run.headSha);
  if (effective.mode !== "comment") await installDependencies(root, effective);

  const jobs = await getFailedJobLogs(octokit, repo, run.id);
  if (!jobs.length) {
    core.info("No failed jobs found in this run.");
    return;
  }
  const log = jobs
    .map((j) => `### Job: ${j.name}${j.failedSteps.length ? ` (failed step: ${j.failedSteps.join(", ")})` : ""}\n${j.log}`)
    .join("\n\n");

  const prNumbers = run.pullRequests.length
    ? run.pullRequests
    : [await findPullRequestForBranch(octokit, repo, run.headBranch)].filter((n): n is number => !!n);

  const result = await runGreenlight({
    root,
    log,
    config: effective,
    provider: () => createProvider(effective),
    logger,
    context: `Workflow "${run.workflowName}" failed on branch "${run.headBranch}"${prNumbers.length ? ` (pull request #${prNumbers[0]})` : ""}. Failed jobs: ${jobs.map((j) => j.name).join(", ")}.`,
  });

  let prUrl: string | undefined;
  const attempt = result.attempt;
  if (attempt && shouldPublish(attempt, effective)) {
    const body = renderReport({ ...result, runUrl: run.url });
    prUrl = await publish(octokit, repo, root, run, effective, attempt.changedFiles, body, attempt.report.summary);
  } else if (attempt?.changedFiles.length) {
    core.info("The attempt did not meet the bar for publishing (status, checks or confidence); posting a report only.");
  }

  const report = renderReport({ ...result, runUrl: run.url, prUrl });
  for (const n of prNumbers) {
    const url = await upsertComment(octokit, repo, n, report);
    core.info(`Commented: ${url}`);
  }
  await core.summary.addRaw(report).write();

  core.setOutput("category", result.diagnosis.category);
  core.setOutput("status", result.attempt?.status ?? "skipped");
  core.setOutput("confidence", String(result.attempt?.report.confidence ?? 0));
  core.setOutput("pr-url", prUrl ?? "");
}

async function publish(
  octokit: Octokit,
  repo: Repo,
  root: string,
  run: FailedRun,
  cfg: Config,
  files: string[],
  body: string,
  summary: string,
): Promise<string | undefined> {
  const title = `fix: ${firstSentence(summary)}`.slice(0, 72);
  const message = `${title}\n\nFixes the failing ${run.workflowName} run ${run.url}`;
  if (cfg.mode === "push") {
    await commitAndPush(root, { branch: run.headBranch, files, message, createBranch: false });
    core.info(`Pushed the fix to ${run.headBranch}.`);
    return undefined;
  }
  const branch = `${cfg.branchPrefix}run-${run.id}`;
  await commitAndPush(root, { branch, files, message, createBranch: true });
  const pr = await openPullRequest(octokit, repo, { head: branch, base: run.headBranch, title, body, labels: cfg.labels });
  core.info(`Opened ${pr.url}`);
  return pr.url;
}

async function checkoutSha(root: string, sha: string): Promise<void> {
  const head = await runCommand("git rev-parse HEAD", { cwd: root, timeoutSec: 30 });
  if (head.output.trim() === sha) return;
  core.info(`Checking out ${sha.slice(0, 7)}`);
  await runCommand(`git fetch --no-tags --depth=1 origin ${sha}`, { cwd: root, timeoutSec: 300 });
  const co = await runCommand(`git checkout --force ${sha}`, { cwd: root, timeoutSec: 60 });
  if (co.exitCode !== 0) throw new Error(`Could not check out ${sha}:\n${co.output}`);
}

async function installDependencies(root: string, cfg: Config): Promise<void> {
  const cmd = cfg.commands.install ?? detectInstall(root);
  if (!cmd || cmd === "none") return;
  core.startGroup(`Installing dependencies: ${cmd}`);
  const r = await runCommand(cmd, { cwd: root, timeoutSec: cfg.commandTimeout });
  core.info(r.output.slice(-5000));
  core.endGroup();
  if (r.exitCode !== 0) core.warning(`Dependency install exited with ${r.exitCode}; continuing.`);
}

function detectInstall(root: string): string | undefined {
  if (existsSync(join(root, "package.json")) && !existsSync(join(root, "node_modules"))) {
    const pm = detectPackageManager(root);
    if (pm === "pnpm") return "pnpm install --frozen-lockfile";
    if (pm === "yarn") return "yarn install --frozen-lockfile";
    if (pm === "bun") return "bun install --frozen-lockfile";
    return existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install";
  }
  if (existsSync(join(root, "requirements.txt"))) return "python -m pip install -r requirements.txt";
  return undefined;
}

function firstSentence(s: string): string {
  const one = s.split(/(?<=[.!?])\s/)[0] ?? s;
  const trimmed = one.replace(/[.!?]$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

main().catch((e: unknown) => {
  core.setFailed(e instanceof Error ? e.message : String(e));
});
