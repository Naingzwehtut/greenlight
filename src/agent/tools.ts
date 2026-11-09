import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import picomatch from "picomatch";
import { tail } from "../logs/index.js";
import { PathError, resolveInRoot, type PathPolicy } from "../safety/paths.js";
import type { ToolSpec } from "../providers/types.js";
import { runCommand, type CommandResult } from "../util/exec.js";

export interface ToolContext {
  root: string;
  policy: PathPolicy;
  /** Named commands the agent may run, e.g. { reproduce: "npx vitest run src/a.test.ts" }. */
  commands: Record<string, string>;
  commandTimeout: number;
  /** Files changed during this attempt (repo-relative). */
  changed: Set<string>;
  /** Called after every command so the loop can track the latest results. */
  onCommand?: (name: string, result: CommandResult) => void;
}

export interface FinishReport {
  summary: string;
  rootCause: string;
  confidence: number;
}

export type ToolOutcome = { content: string; isError?: boolean; finish?: FinishReport };

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", "__pycache__", ".venv", "venv", ".tox", "target"]);
const MAX_READ_LINES = 800;
const MAX_FILE_BYTES = 1_000_000;

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

export function toolSpecs(commandNames: string[]): ToolSpec[] {
  return [
    {
      name: "read_file",
      description: `Read a text file. Lines are numbered. Reads at most ${MAX_READ_LINES} lines per call; use start_line and end_line for long files.`,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repo-relative path." },
          start_line: nullable("integer", "First line to read (1-based), or null for the start."),
          end_line: nullable("integer", "Last line to read, or null."),
        },
        required: ["path", "start_line", "end_line"],
        additionalProperties: false,
      },
    },
    {
      name: "list_files",
      description: "List files and folders under a directory, skipping node_modules, .git and build output.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: 'Repo-relative directory; "." for the root.' },
          depth: nullable("integer", "How many levels to descend (default 2, max 5)."),
        },
        required: ["path", "depth"],
        additionalProperties: false,
      },
    },
    {
      name: "search",
      description: "Search file contents with a regular expression. Returns matching lines as path:line: text.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript regular expression." },
          glob: nullable("string", 'Only search files matching this glob, e.g. "src/**/*.ts".'),
        },
        required: ["pattern", "glob"],
        additionalProperties: false,
      },
    },
    {
      name: "edit_file",
      description:
        "Replace exactly one occurrence of old_text with new_text in a file. old_text must match the file exactly, including whitespace, and must be unique; include surrounding lines to make it unique.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["path", "old_text", "new_text"],
        additionalProperties: false,
      },
    },
    {
      name: "write_file",
      description: "Create a new file. Fails if the file exists; use edit_file to change existing files.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "run_check",
      description: `Run one of the project's check commands and see its output. Available: ${commandNames.join(", ")}. "reproduce" runs only the checks that failed in CI.`,
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", enum: commandNames } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description:
        "Call this once when you are done, whether or not you fixed the problem. Your report is shown to the developer.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "What you changed, in one to three sentences. Say so if you changed nothing." },
          root_cause: { type: "string", description: "Why CI failed, in plain language." },
          confidence: { type: "number", description: "0 to 1: how sure you are the change is correct and complete." },
        },
        required: ["summary", "root_cause", "confidence"],
        additionalProperties: false,
      },
    },
  ];
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    if ("__invalid_json" in input) return err("The tool input was not valid JSON. Try again.");
    switch (name) {
      case "read_file":
        return readFile(ctx, str(input, "path"), optInt(input, "start_line"), optInt(input, "end_line"));
      case "list_files":
        return listFiles(ctx, str(input, "path"), Math.min(optInt(input, "depth") ?? 2, 5));
      case "search":
        return search(ctx, str(input, "pattern"), optStr(input, "glob"));
      case "edit_file":
        return editFile(ctx, str(input, "path"), str(input, "old_text"), str(input, "new_text", true));
      case "write_file":
        return writeFile(ctx, str(input, "path"), str(input, "content", true));
      case "run_check":
        return await runCheck(ctx, str(input, "name"));
      case "finish": {
        const confidence = Number(input.confidence);
        return {
          content: "Report received.",
          finish: {
            summary: str(input, "summary", true),
            rootCause: str(input, "root_cause", true),
            confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
          },
        };
      }
      default:
        return err(`Unknown tool "${name}".`);
    }
  } catch (e) {
    if (e instanceof PathError || e instanceof InputError) return err(e.message);
    throw e;
  }
}

class InputError extends Error {}

function str(input: Record<string, unknown>, key: string, allowEmpty = false): string {
  const v = input[key];
  if (typeof v !== "string" || (!allowEmpty && v === "")) throw new InputError(`"${key}" must be a non-empty string.`);
  return v;
}
function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}
function optInt(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  return typeof v === "number" && Number.isInteger(v) ? v : undefined;
}
const err = (content: string): ToolOutcome => ({ content, isError: true });

function readFile(ctx: ToolContext, p: string, start?: number, end?: number): ToolOutcome {
  const { abs, rel } = resolveInRoot(ctx.root, p);
  if (!ctx.policy.canRead(rel)) return err(`Reading "${rel}" is not allowed.`);
  if (!existsSync(abs)) return err(`"${rel}" does not exist.`);
  if (statSync(abs).isDirectory()) return err(`"${rel}" is a directory; use list_files.`);
  if (statSync(abs).size > MAX_FILE_BYTES) return err(`"${rel}" is too large to read.`);
  const lines = readFileSync(abs, "utf8").split("\n");
  const from = Math.max(1, start ?? 1);
  const to = Math.min(lines.length, end ?? from + MAX_READ_LINES - 1, from + MAX_READ_LINES - 1);
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(5)}  ${l}`)
    .join("\n");
  const more = to < lines.length ? `\n(${lines.length - to} more lines; read from line ${to + 1})` : "";
  return { content: `${rel} (lines ${from}-${to} of ${lines.length})\n${body}${more}` };
}

function listFiles(ctx: ToolContext, p: string, depth: number): ToolOutcome {
  const base = p === "." || p === "" ? { abs: ctx.root, rel: "" } : resolveInRoot(ctx.root, p);
  if (!existsSync(base.abs) || !statSync(base.abs).isDirectory()) return err(`"${p}" is not a directory.`);
  const out: string[] = [];
  const walk = (abs: string, rel: string, d: number) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= 500) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push(`${r}/`);
        if (d > 1) walk(join(abs, entry.name), r, d - 1);
      } else {
        out.push(r);
      }
    }
  };
  walk(base.abs, base.rel, depth);
  return { content: out.length ? out.join("\n") + (out.length >= 500 ? "\n(truncated at 500 entries)" : "") : "(empty)" };
}

function search(ctx: ToolContext, pattern: string, glob?: string): ToolOutcome {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    return err(`Invalid regular expression: ${(e as Error).message}`);
  }
  const match = glob ? picomatch(glob, { dot: true }) : () => true;
  const hits: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (hits.length >= 200) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      const a = join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(a, r);
        continue;
      }
      if (!match(r) || !ctx.policy.canRead(r) || statSync(a).size > MAX_FILE_BYTES) continue;
      const text = readFileSync(a, "utf8");
      if (text.includes("\0")) continue; // binary
      text.split("\n").forEach((line, i) => {
        if (hits.length < 200 && re.test(line)) hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 200)}`);
      });
    }
  };
  walk(ctx.root, "");
  return { content: hits.length ? hits.join("\n") + (hits.length >= 200 ? "\n(truncated at 200 matches)" : "") : "No matches." };
}

function editFile(ctx: ToolContext, p: string, oldText: string, newText: string): ToolOutcome {
  const { abs, rel } = resolveInRoot(ctx.root, p);
  const denied = ctx.policy.writeDenied(rel);
  if (denied) return err(`Not allowed: ${denied}`);
  if (!existsSync(abs)) return err(`"${rel}" does not exist. Use write_file to create files.`);
  const text = readFileSync(abs, "utf8");
  // Accept old_text written with \n when the file uses \r\n.
  const crlf = text.includes("\r\n");
  const find = crlf && !oldText.includes("\r\n") ? oldText.replace(/\n/g, "\r\n") : oldText;
  const replace = crlf && !newText.includes("\r\n") ? newText.replace(/\n/g, "\r\n") : newText;
  const first = text.indexOf(find);
  if (first === -1) return err(`old_text was not found in "${rel}". Read the file again and copy the text exactly.`);
  if (text.indexOf(find, first + 1) !== -1) return err(`old_text appears more than once in "${rel}". Include more surrounding lines.`);
  if (find === replace) return err("old_text and new_text are identical.");
  writeFileSync(abs, text.slice(0, first) + replace + text.slice(first + find.length));
  ctx.changed.add(rel);
  return { content: `Edited ${rel}.` };
}

function writeFile(ctx: ToolContext, p: string, content: string): ToolOutcome {
  const { abs, rel } = resolveInRoot(ctx.root, p);
  const denied = ctx.policy.writeDenied(rel);
  if (denied) return err(`Not allowed: ${denied}`);
  if (existsSync(abs)) return err(`"${rel}" already exists. Use edit_file.`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  ctx.changed.add(rel);
  return { content: `Created ${rel}.` };
}

async function runCheck(ctx: ToolContext, name: string): Promise<ToolOutcome> {
  const command = ctx.commands[name];
  if (!command) return err(`Unknown check "${name}". Available: ${Object.keys(ctx.commands).join(", ")}.`);
  const result = await runCommand(command, { cwd: ctx.root, timeoutSec: ctx.commandTimeout });
  ctx.onCommand?.(name, result);
  const status = result.timedOut ? "TIMED OUT" : result.exitCode === 0 ? "PASSED" : `FAILED (exit ${result.exitCode})`;
  return { content: `$ ${command}\n${status} in ${(result.durationMs / 1000).toFixed(1)}s\n\n${tail(result.output, 12_000)}` };
}
