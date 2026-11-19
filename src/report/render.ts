import type { AttemptResult } from "../agent/loop.js";
import type { Diagnosis } from "../classify/index.js";
import { truncate } from "../logs/clean.js";

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
    for (const c of attempt.checks) lines.push(`| ${codeCell(c.command)} | ${c.passed ? "✅ pass" : "❌ fail"} |`);
    lines.push("");
  }

  if (attempt?.violations.length) {
    lines.push("<details><summary>Rejected changes</summary>", "");
    for (const v of attempt.violations) lines.push(`- \`${v.rule}\` in \`${v.file}\`: \`${escapeMd(v.line.slice(0, 100))}\``);
    lines.push("", "</details>", "");
  }

  if (attempt?.diff && attempt.status !== "rejected") {
    const diff = truncate(attempt.diff.trimEnd(), MAX_DIFF_CHARS);
    const fence = fenceFor(diff);
    lines.push("<details><summary>Diff</summary>", "", `${fence}diff`, diff, fence, "", "</details>", "");
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

export function confidenceBar(value: number): string {
  // String.repeat throws on a negative count, so never let a bad value reach it.
  const c = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(c * 100);
  const filled = Math.round(c * 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${pct}%`;
}

const MAX_DIFF_CHARS = 15_000;

/**
 * A code fence longer than any backtick run in the text. A diff of a Markdown file has
 * context lines like " ```", which would otherwise close a three-backtick fence early.
 */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`{3,}/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Inline code inside a table cell. GitHub splits cells on "|" even inside backticks,
 * so pipes are escaped, and a command containing backticks gets a longer fence.
 */
export function codeCell(s: string): string {
  const text = s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function escapeMd(s: string): string {
  return s.replace(/([|`*_<>])/g, "\\$1");
}
