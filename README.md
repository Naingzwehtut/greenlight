<p align="center">
  <img src="assets/logo.svg" alt="greenlight" width="440">
</p>

<p align="center">
  <b>An AI agent that turns red CI green.</b><br>
  It reads the failing logs, reproduces the failure, fixes the code, proves the fix with your own checks, and opens a pull request.
</p>

<p align="center">
  <a href="https://github.com/Naingzwehtut/greenlight/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Naingzwehtut/greenlight/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
</p>

---

```
CI failed ──► greenlight reads the job logs
              ├─ parses failures   vitest · jest · tsc · eslint · pytest · mypy · ruff
              ├─ classifies them   test · type · lint · build · dependency · infra · flaky
              ├─ skips what code can't fix (network, credentials, flaky timeouts)
              ├─ reproduces only the failing checks, in seconds
              ├─ agent loop: read → edit → re-run → repeat
              ├─ verifies with your full test, typecheck and lint commands
              ├─ rejects "fixes" that skip tests or silence the checker
              └─ opens a PR and comments on the failing one
```

## Why greenlight

Most coding agents stop when the model *says* it is done. greenlight stops when **your checks pass**.

- **Verified, not vibes.** The agent's `finish` call is refused until the reproduce command and every project check pass. Failing output goes back to the model to keep working.
- **No cheating.** Test files are read-only by default. Diffs that add `it.skip`, delete assertions, or add `@ts-ignore`, `eslint-disable`, `# type: ignore` or `# noqa` are detected and rejected.
- **Knows when not to act.** Rate limits, DNS errors, missing secrets and flaky timeouts get a diagnosis comment, not a code change.
- **Fast feedback loop.** Failures are parsed into files and test IDs, so the agent re-runs `vitest run src/cart.test.ts` instead of your whole suite.
- **Bring your model.** Claude by default (`claude-opus-5-5`), or any OpenAI-compatible API, including local models through Ollama.
- **Safe by construction.** Model-supplied paths are confined to the repo; `.github/`, lockfiles, `.env` and keys are never written; the agent can only run your named check commands, never arbitrary shell.

## Quick start (GitHub Action)

1. Add an `ANTHROPIC_API_KEY` secret to your repository.
2. Add `.github/workflows/greenlight.yml`:

```yaml
name: greenlight

on:
  workflow_run:
    workflows: [CI] # the name of your CI workflow
    types: [completed]

permissions:
  contents: write
  pull-requests: write
  actions: read

jobs:
  fix:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - uses: Naingzwehtut/greenlight@v0
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

That's it. The next time CI fails, greenlight comments on the pull request and, when it finds a verified fix, opens a PR against the failing branch.

More templates: [Node](examples/workflows/greenlight.yml) · [Python](examples/workflows/greenlight-python.yml)

> **Note:** pull requests opened with the default `GITHUB_TOKEN` do not trigger other workflows. To have CI run on greenlight's PRs automatically, pass a fine-grained personal access token or a GitHub App token as `github-token`.

## What you get

A comment on the failing pull request (and the same report as the fix PR's description):

> ## 🚦 greenlight
>
> ✅ **Fixed.** All checks pass with the change below.
>
> **Fix:** https://github.com/acme/shop/pull/128
>
> **What failed:** test — 2 tests failed.<br>
> **Root cause:** `subtotal()` summed `price` without multiplying by `quantity`.<br>
> **What changed:** Multiply each item's price by its quantity in `subtotal()`.<br>
> **Confidence:** █████████░ 90%
>
> | Check | Result |
> | --- | --- |
> | `npx vitest run src/cart.test.ts` | ✅ pass |
> | `npm run test` | ✅ pass |
> | `npm run typecheck` | ✅ pass |

<sub>Illustrative example based on [`examples/demo`](examples/demo).</sub>

## Use it locally (CLI)

```bash
# Diagnose a saved CI log; no API key needed
npx github:Naingzwehtut/greenlight diagnose ci.log

# Run a command and fix it if it fails; changes stay in your working tree
export ANTHROPIC_API_KEY=...
npx github:Naingzwehtut/greenlight fix --run "npm test"

# Fix from a saved log
npx github:Naingzwehtut/greenlight fix --log ci.log
```

The CLI never commits or pushes. Review the result with `git diff`.

## Configuration

Everything is optional. Put a `.greenlight.yml` at the root of your repository:

```yaml
mode: pr              # pr | push | comment
provider: anthropic   # anthropic | openai | ollama
model: claude-opus-5-5
minConfidence: 0.6    # below this, comment instead of opening a PR
maxIterations: 20
commands:             # detected from package.json / pyproject.toml when omitted
  test: npm test
  typecheck: npm run typecheck
allowTestChanges: false
```

Full reference: [docs/configuration.md](docs/configuration.md) · annotated example: [examples/.greenlight.yml](examples/.greenlight.yml)

| Action input | Description |
| --- | --- |
| `anthropic-api-key` / `openai-api-key` | API key for the chosen provider |
| `provider`, `model`, `effort`, `mode` | Override the config file |
| `max-iterations`, `min-confidence` | Limits for one attempt |
| `run-id` | Inspect a specific run (for `workflow_dispatch`) |
| `github-token` | Defaults to `github.token` |

Outputs: `category`, `status` (`fixed`, `partial`, `no_change`, `rejected`, `budget`, `refused`, `skipped`), `confidence`, `pr-url`.

## Supported tools

| Tool | What is extracted |
| --- | --- |
| Vitest | test name, assertion, file:line of the raising frame |
| Jest | test name, message, stack frame in the test file |
| TypeScript (`tsc`) | both `file(l,c)` and `file:l:c` formats, multi-line messages |
| ESLint | stylish output, errors only |
| pytest | node IDs, `E` lines, raise location, collection errors |
| mypy | file:line, error code |
| Ruff | concise and full output formats |
| anything else | the error lines and the end of the log |

Missing a tool? [Open a request](https://github.com/Naingzwehtut/greenlight/issues/new?template=parser_request.yml) with a sample log.

## Benchmark

`npm run bench` runs the parser and classifier over real-world-shaped CI logs in [`bench/cases`](bench/cases) and checks the category, the fix decision, the number of failures and the files they point at. No model is called, so it is free and repeatable.

```
14 cases · category 100% · fixable 100% · count 100% · files 100% · fully correct 14/14
```

This measures how well greenlight *reads* logs. It is not a fix-rate claim; an end-to-end fix benchmark is on the [roadmap](#roadmap).

## How it works

Read [docs/architecture.md](docs/architecture.md) for the full design. In short:

```
src/
├─ logs/        log cleaning + one parser per tool
├─ classify/    category and "should we touch code?" decision
├─ agent/       tools, prompts, reproduce commands, the verified fix loop
├─ providers/   Claude (default), OpenAI-compatible (OpenAI, Ollama, vLLM…)
├─ safety/      path policy, tampering detection, token/turn budget
├─ github/      run logs, PRs, comments, commits as greenlight[bot]
├─ report/      the markdown report
├─ action.ts    GitHub Action entry
└─ cli.ts       local CLI
```

Safety rules are documented in [docs/safety.md](docs/safety.md).

## Roadmap

- [x] Parsers for Vitest, Jest, tsc, ESLint, pytest, mypy, Ruff
- [x] Verified fix loop with tampering detection
- [x] Claude, OpenAI and Ollama providers
- [x] GitHub Action and CLI
- [ ] Go (`go test`, `go vet`) and Rust (`cargo test`, `clippy`) parsers
- [ ] End-to-end fix-rate benchmark on recorded real-world failures
- [ ] Flaky-test detection by re-running before fixing
- [ ] Several candidate fixes in parallel, keep the smallest passing diff
- [ ] GitHub Marketplace listing

## Development

```bash
npm install
npm test          # unit and integration tests
npm run typecheck
npm run bench     # log-reading benchmark
npm run build     # bundle dist/ (commit it; the Action runs dist/index.js)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
