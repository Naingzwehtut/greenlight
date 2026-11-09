# Configuration

greenlight reads the first of `.greenlight.yml`, `.greenlight.yaml` or `.github/greenlight.yml` at the root of the repository. Action inputs and CLI flags override the file. Invalid values stop the run with a clear message.

## Reference

| Key | Default | Description |
| --- | --- | --- |
| `provider` | `anthropic` | `anthropic`, `openai` or `ollama` |
| `model` | per provider | `claude-opus-5-5` (anthropic), `gpt-5` (openai), `qwen3-coder` (ollama) |
| `effort` | `high` | `low`, `medium`, `high`, `xhigh` or `max`; used by the anthropic provider |
| `mode` | `pr` | `pr` opens a fix PR, `push` commits to the failing branch, `comment` only diagnoses |
| `maxIterations` | `20` | Maximum model turns per attempt |
| `maxTokens` | `1000000` | Maximum input + output tokens per attempt |
| `minConfidence` | `0.6` | Minimum self-reported confidence (0–1) needed to publish a fix |
| `commandTimeout` | `600` | Seconds before a single check command is killed |
| `commands.test` | detected | Full test command |
| `commands.typecheck` | detected | Type checking command |
| `commands.lint` | detected | Lint command |
| `commands.install` | detected | Install step before the agent runs; `none` to skip |
| `paths.allow` | `["**"]` | Globs the agent may edit |
| `paths.deny` | `[]` | Extra globs the agent may not edit (added to the built-in list) |
| `allowTestChanges` | `false` | Let the agent edit test files |
| `allowDependencyChanges` | `false` | Let the agent edit manifests and try dependency failures |
| `branchPrefix` | `greenlight/` | Prefix for fix branches; runs on these branches are skipped |
| `labels` | `["greenlight"]` | Labels added to fix PRs |

## Command detection

When `commands` are not set:

- **Node:** the `test`, `typecheck` (or `type-check`, `tsc`, `check-types`) and `lint` scripts from `package.json`, run with the package manager found from the lockfile (npm, pnpm, yarn or bun).
- **Python:** `python -m pytest` when `pyproject.toml`, `setup.py` or `requirements.txt` exists.
- **Install:** `npm ci` / `pnpm install --frozen-lockfile` / `yarn install --frozen-lockfile` / `bun install --frozen-lockfile` when `node_modules` is missing, or `pip install -r requirements.txt`.

## Providers

| Provider | Secret / env | Notes |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | Default and recommended |
| `openai` | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` | Any Chat Completions API with function calling |
| `ollama` | optional `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`) | Needs a model with tool calling, and a runner that can reach the Ollama server |

## Modes in practice

Start with `mode: comment` to see the diagnoses on your own failures, then switch to `pr`. Use `push` only on repositories where you are comfortable with a bot committing to working branches.
