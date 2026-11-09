import type { Diagnosis } from "../classify/index.js";
import type { Failure } from "../logs/index.js";
import { tail, truncate } from "../logs/index.js";

export function systemPrompt(opts: { allowTestChanges: boolean }): string {
  return `You are greenlight, an engineer who fixes failing CI builds. You work inside a checkout of the repository with tools to read, search and edit files and to run the project's checks.

How to work:
1. Read the failure details. Run the "reproduce" check first to see the failure for yourself.
2. Read the code involved and find the root cause before editing. Look at how the code is used elsewhere when that helps.
3. Make the smallest change that fixes the root cause. Match the surrounding code style. Do not refactor or reformat unrelated code.
4. Run "reproduce" again, then the other checks, to confirm the fix and make sure nothing else broke.
5. Call finish with a short summary, the root cause, and an honest confidence.

Rules:
- Fix the code, not the evidence. Never skip, delete or weaken tests or assertions, and never add suppression comments such as @ts-ignore, eslint-disable, "# type: ignore" or "# noqa". These changes are detected and rejected.
${opts.allowTestChanges ? "- You may edit a test only when the test itself is clearly wrong, for example it asserts behaviour the code was deliberately changed away from. Explain why in your summary." : "- Test files are read-only. Treat the tests as the specification of the expected behaviour."}
- If the failure is not caused by the code (network, credentials, a flaky timing issue) or you cannot find a safe fix, change nothing and explain what you found in finish, with low confidence.
- Confidence means: 0.9 or higher only when the checks pass and you understand the cause; around 0.5 when the checks pass but you are unsure the fix is right; below 0.3 when you made no fix.
- Keep your messages short. The developer reads only your final report.`;
}

export function userPrompt(opts: {
  diagnosis: Diagnosis;
  log: string;
  commands: Record<string, string>;
  context?: string;
}): string {
  const { diagnosis, log, commands } = opts;
  const failures = diagnosis.failures.slice(0, 20).map(formatFailure).join("\n\n");
  const more = diagnosis.failures.length > 20 ? `\n\n(${diagnosis.failures.length - 20} more failures not shown)` : "";
  const cmdList = Object.entries(commands)
    .map(([k, v]) => `- ${k}: \`${v}\``)
    .join("\n");
  return `CI failed. Category: ${diagnosis.category}. ${diagnosis.reason}
${opts.context ? `\n${opts.context}\n` : ""}
## Failures

${failures || "(no structured failures; see the log below)"}${more}

## Checks you can run

${cmdList || "(none detected)"}

## End of the CI log

\`\`\`
${tail(log, 8000)}
\`\`\`

Fix the root cause, verify with the checks, then call finish.`;
}

function formatFailure(f: Failure, i: number): string {
  const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""}${f.column ? `:${f.column}` : ""})` : "";
  return `### ${i + 1}. [${f.source}] ${f.title}${where}\n\`\`\`\n${truncate(f.message, 1500)}\n\`\`\``;
}

export const NUDGE_FINISH =
  "You stopped without calling finish. If you are done, call finish now with your summary, root cause and confidence. If not, continue working.";
