/** The tool that produced a failure. */
export type FailureSource =
  | "vitest"
  | "jest"
  | "tsc"
  | "eslint"
  | "pytest"
  | "mypy"
  | "ruff"
  | "generic";

/** One concrete problem extracted from a CI log. */
export interface Failure {
  source: FailureSource;
  /** Short identifier: a test name, an error code, or a lint rule. */
  title: string;
  /** The error message, trimmed to something a human (or model) can read. */
  message: string;
  /** Repo-relative file path, when the log names one. */
  file?: string;
  line?: number;
  column?: number;
  /** Raw lines of the log that belong to this failure. */
  excerpt?: string;
}

export interface ParsedLog {
  failures: Failure[];
  /** Tools whose output was recognised in the log, even if they passed. */
  detected: FailureSource[];
  /** The cleaned log, kept for the agent's context. */
  cleaned: string;
}

export interface LogParser {
  source: FailureSource;
  /** Cheap check: does this log contain output from this tool? */
  detect(log: string): boolean;
  parse(log: string): Failure[];
}
