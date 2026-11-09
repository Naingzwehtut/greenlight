import type { Diagnosis } from "../classify/index.js";
import type { Config } from "../config.js";
import type { ChatSession, Provider, ToolResult, TurnInput } from "../providers/types.js";
import { Budget, BudgetExceeded } from "../safety/budget.js";
import { createPathPolicy } from "../safety/paths.js";
import { describeViolations, findTampering, type Violation } from "../safety/tampering.js";
import { runCommand } from "../util/exec.js";
import { silentLogger, type Logger } from "../util/logger.js";
import { buildCommandSet } from "./commands.js";
import { NUDGE_FINISH, systemPrompt, userPrompt } from "./prompts.js";
import { runTool, toolSpecs, type FinishReport, type ToolContext } from "./tools.js";

export type AttemptStatus =
  | "fixed" // changes made and every check passed
  | "partial" // changes made but some check still fails
  | "no_change" // the agent decided not to change code
  | "rejected" // changes tried to game the checks
  | "budget" // ran out of turns or tokens
  | "refused"; // the model declined the task

export interface CheckOutcome {
  name: string;
  command: string;
  passed: boolean;
  output: string;
}

export interface AttemptResult {
  status: AttemptStatus;
  report: FinishReport;
  changedFiles: string[];
  diff: string;
  checks: CheckOutcome[];
  violations: Violation[];
  usage: { inputTokens: number; outputTokens: number; turns: number };
  commands: Record<string, string>;
}

export interface AttemptOptions {
  root: string;
  diagnosis: Diagnosis;
  log: string;
  config: Config;
  provider: Provider;
  logger?: Logger;
  /** Extra context for the prompt, e.g. the PR title and description. */
  context?: string;
}

/** How many times finish may be rejected (failing checks or tampering) before we give up. */
const MAX_REJECTED_FINISHES = 2;

export async function attemptFix(opts: AttemptOptions): Promise<AttemptResult> {
  const { root, diagnosis, config, provider } = opts;
  const log = opts.logger ?? silentLogger;
  const policy = createPathPolicy(config);
  const commands = buildCommandSet(root, diagnosis.failures, config);
  const changed = new Set<string>();
  const ctx: ToolContext = { root, policy, commands, commandTimeout: config.commandTimeout, changed };
  const budget = new Budget(config.maxTokens, config.maxIterations);

  const session: ChatSession = provider.startSession({
    system: systemPrompt({ allowTestChanges: config.allowTestChanges }),
    prompt: userPrompt({ diagnosis, log: opts.log, commands, context: opts.context }),
    tools: toolSpecs(Object.keys(commands)),
  });

  let pending: TurnInput | undefined;
  let report: FinishReport | undefined;
  let status: AttemptStatus | undefined;
  let nudged = false;
  let rejectedFinishes = 0;
  let lastChecks: CheckOutcome[] = [];
  let lastViolations: Violation[] = [];

  try {
    while (!report) {
      budget.check();
      const turn = await session.next(pending);
      budget.record(turn.usage);
      if (turn.text) log.info(`model: ${turn.text.split("\n")[0]!.slice(0, 200)}`);

      if (turn.stop === "refusal") {
        status = "refused";
        report = { summary: "The model declined this request.", rootCause: "Unknown.", confidence: 0 };
        break;
      }
      if (turn.done) {
        if (nudged) {
          report = { summary: turn.text || "The agent stopped without a report.", rootCause: "Unknown.", confidence: 0.2 };
          break;
        }
        nudged = true;
        pending = { text: NUDGE_FINISH };
        continue;
      }

      const results: ToolResult[] = [];
      for (const call of turn.toolCalls) {
        log.info(`tool: ${call.name} ${summarizeInput(call.input)}`);
        const outcome = await runTool(call.name, call.input, ctx);
        if (!outcome.finish) {
          results.push({ id: call.id, content: outcome.content, isError: outcome.isError });
          continue;
        }
        // Verify before accepting the report.
        const verdict = changed.size ? await verify(root, commands, config.commandTimeout, policy.isTestFile) : undefined;
        lastChecks = verdict?.checks ?? [];
        lastViolations = verdict?.violations ?? [];
        const failing = lastChecks.filter((c) => !c.passed);
        if (verdict && (failing.length || lastViolations.length) && rejectedFinishes < MAX_REJECTED_FINISHES) {
          rejectedFinishes++;
          results.push({ id: call.id, isError: true, content: rejectionMessage(failing, lastViolations) });
          continue;
        }
        report = outcome.finish;
        results.push({ id: call.id, content: outcome.content });
      }
      pending = { results };
    }
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    log.warn(e.message);
    status = "budget";
    report = { summary: `Stopped early: ${e.message}`, rootCause: "Not determined.", confidence: 0 };
    if (changed.size) {
      const verdict = await verify(root, commands, config.commandTimeout, policy.isTestFile);
      lastChecks = verdict.checks;
      lastViolations = verdict.violations;
    }
  }

  const diff = changed.size ? await gitDiff(root, [...changed]) : "";
  if (!status) {
    if (!changed.size) status = "no_change";
    else if (lastViolations.length) status = "rejected";
    else if (lastChecks.every((c) => c.passed)) status = "fixed";
    else status = "partial";
  }

  return {
    status,
    report: report!,
    changedFiles: [...changed].sort(),
    diff,
    checks: lastChecks,
    violations: lastViolations,
    usage: { inputTokens: budget.inputTokens, outputTokens: budget.outputTokens, turns: budget.turns },
    commands,
  };
}

async function verify(
  root: string,
  commands: Record<string, string>,
  timeout: number,
  isTestFile: (f: string) => boolean,
): Promise<{ checks: CheckOutcome[]; violations: Violation[] }> {
  const checks: CheckOutcome[] = [];
  for (const [name, command] of Object.entries(commands)) {
    const r = await runCommand(command, { cwd: root, timeoutSec: timeout });
    checks.push({ name, command, passed: r.exitCode === 0, output: r.output });
  }
  const diff = await gitDiff(root, []);
  return { checks, violations: findTampering(diff, isTestFile) };
}

export async function gitDiff(root: string, newFiles: string[]): Promise<string> {
  // Intent-to-add makes new files show up in `git diff`.
  if (newFiles.length) {
    await runCommand(`git add --intent-to-add -- ${newFiles.map((f) => `"${f}"`).join(" ")}`, { cwd: root, timeoutSec: 30 });
  }
  const r = await runCommand("git diff --no-color --no-ext-diff", { cwd: root, timeoutSec: 60 });
  return r.output;
}

function rejectionMessage(failing: CheckOutcome[], violations: Violation[]): string {
  const parts: string[] = ["Not accepted yet."];
  if (violations.length) {
    parts.push(`Your changes weaken the checks instead of fixing the code. Undo these:\n${describeViolations(violations)}`);
  }
  for (const c of failing) {
    parts.push(`Check "${c.name}" still fails:\n$ ${c.command}\n${c.output.slice(-4000)}`);
  }
  parts.push("Keep working, then call finish again. If you cannot fix it, revert your changes and call finish with low confidence.");
  return parts.join("\n\n");
}

function summarizeInput(input: Record<string, unknown>): string {
  const s = JSON.stringify(input);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}
