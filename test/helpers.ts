import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChatSession, Provider, SessionOptions, ToolCall, Turn, TurnInput } from "../src/providers/types.js";

/** Create a git repository in a temp folder with the given files committed. */
export function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "greenlight-repo-"));
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: "pipe" });
  git("init -q -b main");
  git("config user.email test@example.com");
  git("config user.name test");
  git("config core.autocrlf false");
  git("add -A");
  git('commit -qm "initial"');
  return dir;
}

type Step = ToolCall[] | { text: string };

/**
 * A provider that replays a fixed script of tool calls. Each step is one model turn.
 * It records what it was sent so tests can assert on prompts and tool results.
 */
export class ScriptedProvider implements Provider {
  readonly name = "scripted";
  readonly model = "scripted-model";
  readonly inputs: (TurnInput | undefined)[] = [];
  session?: SessionOptions;

  constructor(private readonly steps: Step[]) {}

  startSession(opts: SessionOptions): ChatSession {
    this.session = opts;
    let i = 0;
    return {
      next: async (input?: TurnInput): Promise<Turn> => {
        this.inputs.push(input);
        const step = this.steps[Math.min(i++, this.steps.length - 1)]!;
        const usage = { inputTokens: 1000, outputTokens: 100 };
        if (!Array.isArray(step)) return { text: step.text, toolCalls: [], done: true, stop: "end", usage };
        return { text: "", toolCalls: step, done: false, stop: "tool_use", usage };
      },
    };
  }
}

let n = 0;
export const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `call_${++n}`, name, input });
