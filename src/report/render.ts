import type { AttemptResult } from "../agent/loop.js";
import type { Diagnosis } from "../classify/index.js";

export const COMMENT_MARKER = "<!-- greenlight:report -->";

const STATUS_LINE: Record<AttemptResult["status"], string> = {
  fixed: "✅ **Fixed.** All checks pass with the change below.",
  partial: "🟡 **Partly fixed.** Some checks still fail; review carefully.",
  no_change: "🔍 **Diagnosed, no code change.**",
  rejected: "⛔ **No fix proposed.** The only changes found would have weakened the checks.",
  budget: "⏱️ **Stopped early** after reaching the configured limit.",
  refused: "⚠️ **The model declined this request.**",
};

export interface RenderInput {
  diagnosis: Diagnosis;
  attempt?: AttemptResult;
  runUrl?: string;
  prUrl?: string;
  /** Why no attempt was made, when attempt is undefined. */
  skippedReason?: string;
}

/** Markdown for the PR comment, the fix PR body and the job summary. */
export function renderReport(input: RenderInput): string {
  const { diagnosis, attempt } = input;
  const lines: string[] = [COMMENT_MARKER, "## 🚦 greenlight", ""];

  if (attempt) lines.push(STATUS_LINE[attempt.status], "");
  else lines.push(`🔍 **Diagnosis only.** ${input.skippedReason ?? ""}`.trim(), "");

  if (input.prUrl) lines.push(`**Fix:** ${input.prUrl}`, "");

  lines.push(`**What failed:** ${diagnosis.category} — ${diagnosis.reason}`);
  if (attempt) {
    lines.push(`**Root cause:** ${attempt.report.rootCause}`);
    lines.push(`**What changed:** ${attempt.report.summary}`);
    lines.push(`**Confidence:** ${confidenceBar(attempt.report.confidence)}`);
  }
  lines.push("");

  const shown = diagnosis.failures.slice(0, 10);
  if (shown.length) {
    lines.push("<details><summary>Failures (" + diagnosis.failures.length + ")</summary>", "");
    for (const f of shown) {
      const where = f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
      lines.push(`- **${escapeMd(f.title)}**${where}`);
    }
    if (diagnosis.failures.length > shown.length) lines.push(`- …and ${diagnosis.failures.length - shown.length} more`);
    lines.push("", "</details>", "");
  }

  if (attempt?.checks.length) {
    lines.push("| Check | Result |", "| --- | --- |");
    for (const c of attempt.checks) lines.push(`| \`${c.command}\` | ${c.passed ? "✅ pass" : "❌ fail"} |`);
    lines.push("");
  }

  if (attempt?.violations.length) {
    lines.push("<details><summary>Rejected changes</summary>", "");
    for (const v of attempt.violations) lines.push(`- \`${v.rule}\` in \`${v.file}\`: \`${escapeMd(v.line.slice(0, 100))}\``);
    lines.push("", "</details>", "");
  }

  if (attempt?.diff && attempt.status !== "rejected") {
    const diff = attempt.diff.length > 15000 ? attempt.diff.slice(0, 15000) + "\n… (diff truncated)" : attempt.diff;
    lines.push("<details><summary>Diff</summary>", "", "```diff", diff.trimEnd(), "```", "", "</details>", "");
  }

  if (attempt) {
    const tokens = attempt.usage.inputTokens + attempt.usage.outputTokens;
    lines.push(
      `<sub>${attempt.usage.turns} model turns · ${tokens.toLocaleString("en-US")} tokens${input.runUrl ? ` · [failed run](${input.runUrl})` : ""}</sub>`,
    );
  } else if (input.runUrl) {
    lines.push(`<sub>[failed run](${input.runUrl})</sub>`);
  }
  return lines.join("\n");
}

export function confidenceBar(c: number): string {
  const pct = Math.round(c * 100);
  const filled = Math.round(c * 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${pct}%`;
}

function escapeMd(s: string): string {
  return s.replace(/([|`*_<>])/g, "\\$1");
}
