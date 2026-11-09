import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildCommandSet } from "./agent/commands.js";
import { classify } from "./classify/index.js";
import { loadConfig } from "./config.js";
import { parseLog } from "./logs/index.js";
import { createProvider } from "./providers/index.js";
import { renderReport } from "./report/render.js";
import { runGreenlight } from "./run.js";
import { runCommand } from "./util/exec.js";
import { consoleLogger } from "./util/logger.js";

const HELP = `greenlight - turn red CI green

Usage:
  greenlight diagnose <log-file>         Parse a CI log and print the diagnosis (no API key needed)
  greenlight fix --log <log-file>        Try to fix the failure described by a saved CI log
  greenlight fix --run "<command>"       Run a command (e.g. "npm test") and fix it if it fails

Options:
  --cwd <dir>         Repository to work in (default: current directory)
  --provider <name>   anthropic | openai | ollama
  --model <id>        Model ID
  --mode <mode>       pr | push | comment (the CLI never pushes; "comment" means diagnose only)
  --max-iterations n  Maximum model turns
  --json              Print the result as JSON
  -h, --help          Show this help
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cwd: { type: "string" },
      log: { type: "string" },
      run: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      mode: { type: "string" },
      "max-iterations": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, file] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return command ? 0 : 1;
  }

  const root = resolve(values.cwd ?? process.cwd());
  const config = loadConfig(root, {
    provider: values.provider,
    model: values.model,
    mode: values.mode,
    maxIterations: values["max-iterations"] ? Number(values["max-iterations"]) : undefined,
  });

  if (command === "diagnose") {
    const logFile = file ?? values.log;
    if (!logFile) throw new Error("diagnose needs a log file.");
    const parsed = parseLog(readFileSync(logFile, "utf8"));
    const diagnosis = classify(parsed, { allowDependencyChanges: config.allowDependencyChanges });
    if (values.json) {
      console.log(JSON.stringify({ diagnosis, commands: buildCommandSet(root, diagnosis.failures, config) }, null, 2));
    } else {
      console.log(`${diagnosis.category}${diagnosis.fixable ? " (fixable)" : ""}: ${diagnosis.reason}\n`);
      for (const f of diagnosis.failures) {
        const where = f.file ? `  ${f.file}${f.line ? `:${f.line}` : ""}` : "";
        console.log(`• [${f.source}] ${f.title}${where}`);
      }
      const cmds = buildCommandSet(root, diagnosis.failures, config);
      if (cmds.reproduce) console.log(`\nReproduce with: ${cmds.reproduce}`);
    }
    return 0;
  }

  if (command === "fix") {
    let log: string;
    if (values.log) {
      log = readFileSync(values.log, "utf8");
    } else if (values.run) {
      consoleLogger.info(`$ ${values.run}`);
      const r = await runCommand(values.run, { cwd: root, timeoutSec: config.commandTimeout });
      if (r.exitCode === 0) {
        console.log("The command passed; nothing to fix.");
        return 0;
      }
      log = r.output;
    } else {
      throw new Error('fix needs --log <file> or --run "<command>".');
    }

    const result = await runGreenlight({
      root,
      log,
      config,
      provider: () => createProvider(config),
      logger: values.json ? undefined : consoleLogger,
    });
    if (values.json) {
      console.log(JSON.stringify({ ...result, attempt: result.attempt && { ...result.attempt, checks: result.attempt.checks.map(({ output: _o, ...c }) => c) } }, null, 2));
    } else {
      console.log("\n" + renderReport(result).replace(/<!--.*?-->\n?/g, ""));
      if (result.attempt?.changedFiles.length) {
        console.log("\nThe changes are in your working tree. Review them with `git diff`.");
      }
    }
    return result.attempt?.status === "fixed" ? 0 : 1;
  }

  console.error(`Unknown command "${command}".\n`);
  console.log(HELP);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`greenlight: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  },
);
