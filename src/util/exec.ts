import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  exitCode: number;
  /** stdout and stderr interleaved, as a developer would see them in a terminal. */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

/** Most characters of output kept. Failures are printed last, so the end is what we keep. */
export const MAX_OUTPUT = 2_000_000;

/** Append a chunk, dropping the oldest output once the total passes `max`. */
export function appendCapped(output: string, chunk: string, max = MAX_OUTPUT): string {
  const next = output + chunk;
  if (next.length <= max) return next;
  const cut = next.slice(next.length - max);
  const firstNl = cut.indexOf("\n");
  return "(earlier output dropped) …\n" + (firstNl >= 0 ? cut.slice(firstNl + 1) : cut);
}

export interface RunOptions {
  cwd: string;
  timeoutSec?: number;
  env?: NodeJS.ProcessEnv;
}

/** Run a shell command and capture everything it prints. Never throws on a non-zero exit. */
export function runCommand(command: string, opts: RunOptions): Promise<CommandResult> {
  return run(command, [], true, command, opts);
}

/**
 * Run a program with an argument list and no shell, so arguments are passed exactly as given.
 * Use this whenever an argument comes from the model or the network (file names, commit messages).
 */
export function runProgram(file: string, args: string[], opts: RunOptions): Promise<CommandResult> {
  return run(file, args, false, [file, ...args].join(" "), opts);
}

function run(file: string, args: string[], shell: boolean, label: string, opts: RunOptions): Promise<CommandResult> {
  const command = label;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      shell,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1", ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const onData = (chunk: Buffer) => {
      output = appendCapped(output, chunk.toString("utf8"));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGKILL");
      },
      (opts.timeoutSec ?? 600) * 1000,
    );

    child.on("error", (err) => {
      output += `\n${err.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: timedOut ? 124 : (code ?? 1),
        output,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}
