# Architecture

greenlight is a pipeline with one model-driven step in the middle. Everything before and after the model is deterministic code, so it can be tested without an API key.

```
                 ┌──────────────┐   ┌──────────────┐   ┌───────────────────────────┐   ┌──────────────┐
 failed run ───► │ logs/        │──►│ classify/    │──►│ agent/  (model in a loop)  │──►│ github/      │
 (job logs)      │ clean+parse  │   │ category,    │   │ tools ─ verify ─ tampering │   │ PR, comment, │
                 │ → Failure[]  │   │ fixable?     │   │ → AttemptResult            │   │ job summary  │
                 └──────────────┘   └──────────────┘   └───────────────────────────┘   └──────────────┘
```

## 1. Reading logs (`src/logs`)

GitHub job logs have a timestamp and ANSI colour codes on every line. `cleanLog` strips both, then every parser whose `detect()` matches turns the text into `Failure` objects:

```ts
interface Failure {
  source: "vitest" | "jest" | "tsc" | "eslint" | "pytest" | "mypy" | "ruff" | "generic";
  title: string;     // test name, error code or rule
  message: string;   // the readable part of the error
  file?: string;     // repo-relative
  line?: number;
  column?: number;
}
```

Paths are normalised to repo-relative POSIX paths (`/home/runner/work/app/app/src/a.ts` → `src/a.ts`). When no specific parser recognises the log, the generic parser keeps the lines that look like errors plus the end of the log.

For test runners the location is the frame **that raised the error**, not the test line, because that is usually where the fix goes.

## 2. Deciding whether to act (`src/classify`)

The classifier looks for signals in a fixed order. Infrastructure signals come first: a DNS error can also make tests fail, but editing code would not help.

| Category | Acts? | Examples |
| --- | --- | --- |
| `infra` | never | rate limits, DNS/network errors, missing credentials, out of disk |
| `dependency` | only with `allowDependencyChanges` | `ERESOLVE`, no matching version |
| `flaky` | never | test timeouts with no other failure |
| `build` | yes | bundler failed to resolve an import |
| `test`, `type`, `lint` | yes | parsed failures from the tools above |
| `unknown` | never | nothing recognised |

## 3. The fix loop (`src/agent`)

**Commands.** `commands.ts` builds a set of named checks. `reproduce` re-runs only what failed (`vitest run <files>`, `pytest <node ids>`, `eslint <files>`) using the repo's package manager. `test`, `typecheck` and `lint` come from `.greenlight.yml` or `package.json` scripts or Python defaults.

**Tools.** The model gets seven tools: `read_file`, `list_files`, `search`, `edit_file` (exact, unique search-and-replace), `write_file` (new files only), `run_check` (named checks only) and `finish`. There is deliberately no free-form shell tool.

**Loop.**

```
prompt = failures + check list + end of log
repeat
  turn = model.next(results)
  if turn has no tool calls: nudge once to call finish, then stop
  run each tool call
  on finish:
    if files changed: run every check + scan the diff for tampering
    if anything fails and fewer than 2 finishes were rejected:
        send the failing output back as the result of finish → keep looping
    else accept the report
until finish is accepted or the turn / token budget runs out
```

Refusing `finish` until the checks pass is the core idea: the model cannot declare victory, it has to earn it.

**Result.** `fixed` (changes, all checks pass), `partial` (changes, some checks fail), `no_change`, `rejected` (tampering), `budget`, or `refused`.

## 4. Providers (`src/providers`)

A provider exposes a `ChatSession` whose `next()` takes tool results (and optional text) and returns the model's next turn. Each provider keeps its own native history, so provider-specific content survives round trips.

- **Anthropic** (default): `claude-opus-5-5` with adaptive thinking, configurable effort, strict tool schemas, prompt caching on the tools and system prompt, and the server-side refusal fallback. The full response content, including thinking blocks, is sent back each turn.
- **OpenAI-compatible**: Chat Completions with function calling. Works with OpenAI, Ollama, vLLM, LM Studio and similar servers.

## 5. Publishing (`src/github`, `src/action.ts`)

An attempt is published only if it changed files, ended `fixed` or `partial`, has no tampering violations, and its confidence is at least `minConfidence`.

- `mode: pr` commits as `greenlight[bot]` on `greenlight/run-<id>` and opens a PR against the failing branch.
- `mode: push` commits straight to the failing branch.
- Runs from forks are always diagnosis-only, and runs on `greenlight/*` branches are skipped so greenlight never tries to fix itself in a loop.

The report is posted as a single comment per PR (updated in place on later runs) and written to the job summary.
