// GitHub Actions logs carry ANSI colour codes and an ISO timestamp on every line.
// Parsers work on the cleaned text so their regexes stay simple.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
const GROUP_MARKERS = /^##\[(?:group|endgroup|section)\].*$/;

export function cleanLog(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(ANSI, "").replace(TIMESTAMP, ""))
    .filter((line) => !GROUP_MARKERS.test(line))
    .join("\n");
}

/** Normalise a path from a log to a repo-relative POSIX path. */
export function normalizePath(p: string, workspace?: string): string {
  let out = p.trim().replace(/\\/g, "/");
  const roots = [workspace, "/home/runner/work/", "/github/workspace/"].filter(Boolean) as string[];
  for (const root of roots) {
    const r = root.replace(/\\/g, "/").replace(/\/?$/, "/");
    if (out.startsWith(r)) {
      out = out.slice(r.length);
      // /home/runner/work/<repo>/<repo>/src/x.ts -> src/x.ts
      if (root === "/home/runner/work/") out = out.split("/").slice(2).join("/");
      break;
    }
  }
  return out.replace(/^\.\//, "");
}

/** Keep the first `max` characters, cutting at a line boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastNl = cut.lastIndexOf("\n");
  return (lastNl > max * 0.5 ? cut.slice(0, lastNl) : cut) + "\n… (truncated)";
}

/** Keep the last `max` characters; useful because failures are usually at the end. */
export function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const firstNl = cut.indexOf("\n");
  return "(earlier output truncated) …\n" + (firstNl >= 0 ? cut.slice(firstNl + 1) : cut);
}
