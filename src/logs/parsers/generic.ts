import type { Failure, LogParser } from "../types.js";
import { tail } from "../clean.js";

// Used only when no specific parser finds anything. It keeps the end of the log,
// where the reason for a failed step almost always is, plus any lines that look like errors.
const ERRORISH = /\b(error|failed|failure|exception|traceback|cannot find|not found|exit code [1-9])\b/i;

export const genericParser: LogParser = {
  source: "generic",
  detect: () => true,
  parse(log) {
    const lines = log.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];
    const errorLines = lines.filter((l) => ERRORISH.test(l) && !/^##\[error\]Process completed/.test(l));
    const headline =
      errorLines.find((l) => !/exit code/i.test(l))?.trim() ?? errorLines[0]?.trim() ?? "The step failed";
    return [
      {
        source: "generic",
        title: headline.replace(/^##\[error\]/, "").slice(0, 120),
        message: errorLines.slice(-15).join("\n").replace(/##\[error\]/g, ""),
        excerpt: tail(lines.join("\n"), 4000),
      },
    ];
  },
};
