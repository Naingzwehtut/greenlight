import { attemptFix, type AttemptResult } from "./agent/loop.js";
import { classify, type Diagnosis } from "./classify/index.js";
import type { Config } from "./config.js";
import { parseLog } from "./logs/index.js";
import type { Provider } from "./providers/types.js";
import { silentLogger, type Logger } from "./util/logger.js";

export interface RunInput {
  root: string;
  log: string;
  config: Config;
  /** Created lazily so diagnosis-only runs need no API key. */
  provider: () => Provider;
  logger?: Logger;
  context?: string;
}

export interface RunOutput {
  diagnosis: Diagnosis;
  attempt?: AttemptResult;
  skippedReason?: string;
}

/** The whole pipeline, independent of GitHub: parse, classify, then try a fix if it makes sense. */
export async function runGreenlight(input: RunInput): Promise<RunOutput> {
  const log = input.logger ?? silentLogger;
  const parsed = parseLog(input.log);
  const diagnosis = classify(parsed, { allowDependencyChanges: input.config.allowDependencyChanges });
  log.info(`diagnosis: ${diagnosis.category} (${diagnosis.failures.length} failures) — ${diagnosis.reason}`);

  if (input.config.mode === "comment") {
    return { diagnosis, skippedReason: "Running in comment mode, so no code was changed." };
  }
  if (!diagnosis.fixable) {
    return { diagnosis, skippedReason: skipReason(diagnosis) };
  }

  const attempt = await attemptFix({
    root: input.root,
    diagnosis,
    log: parsed.cleaned,
    config: input.config,
    provider: input.provider(),
    logger: log,
    context: input.context,
  });
  log.info(`attempt: ${attempt.status} (confidence ${attempt.report.confidence}, ${attempt.usage.turns} turns)`);
  return { diagnosis, attempt };
}

function skipReason(d: Diagnosis): string {
  switch (d.category) {
    case "infra":
      return "This looks like an infrastructure problem, not a code problem. Re-running the job may help.";
    case "flaky":
      return "This looks like a flaky, timing-dependent failure. Re-run the job before changing code.";
    case "dependency":
      return "Dependency changes are turned off. Set allowDependencyChanges: true to let greenlight try.";
    default:
      return "greenlight could not identify the failing tool, so it did not change code.";
  }
}

/** Whether an attempt is good enough to publish as a commit or PR. */
export function shouldPublish(attempt: AttemptResult | undefined, cfg: Config): attempt is AttemptResult {
  return (
    !!attempt &&
    attempt.changedFiles.length > 0 &&
    (attempt.status === "fixed" || attempt.status === "partial") &&
    attempt.violations.length === 0 &&
    attempt.report.confidence >= cfg.minConfidence
  );
}
