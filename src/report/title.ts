/** Longest PR title / commit subject greenlight writes. */
export const MAX_TITLE = 72;

/**
 * A conventional-commit style title from the agent's summary, e.g.
 * "Changed add() to return a + b. Tests pass." -> "fix: changed add() to return a + b".
 */
export function fixTitle(summary: string, max = MAX_TITLE): string {
  const sentence = firstSentence(summary.trim());
  const text = sentence ? lowerFirst(sentence) : "repair the failing CI checks";
  return shorten(`fix: ${text}`, max);
}

function firstSentence(s: string): string {
  const one = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return one.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

// Keep identifiers and acronyms as written: "API", "TypeError", "README".
function lowerFirst(s: string): string {
  const word = s.split(" ")[0] ?? "";
  if (/^[A-Z][a-z]+$/.test(word)) return s.charAt(0).toLowerCase() + s.slice(1);
  return s;
}

/** Cut at a word boundary and add an ellipsis, so the title never ends mid-word. */
function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, "")}…`;
}
