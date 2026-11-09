# Contributing

Thanks for helping make CI less painful.

## Setup

```bash
git clone https://github.com/Naingzwehtut/greenlight.git
cd greenlight
npm install
npm test
```

Node 22 or newer is required.

## Project layout

See [docs/architecture.md](docs/architecture.md). The short version: `src/logs` reads logs, `src/classify` decides whether to act, `src/agent` runs the model, `src/github` publishes.

## Adding support for a new tool

This is the most useful contribution and needs no API key.

1. Save a real failing log (with private details removed) to `test/fixtures/logs/<tool>.log`.
2. Add a parser in `src/logs/parsers/` that implements `LogParser` (`detect` and `parse`).
3. Register it in `src/logs/index.ts`.
4. Add tests in `test/logs.test.ts` and, if the tool has a natural "re-run only this" command, in `src/agent/commands.ts`.
5. Add a benchmark case: `bench/cases/<name>/log.log` and `expected.json`. Run `npm run bench`.

Parsers should prefer missing a failure over inventing one. When in doubt, let the generic parser handle it.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run bench
npm run build   # if you changed src/, commit the updated dist/
```

CI checks that `dist/` matches the source, because the Action runs the bundled file.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(logs): …`, `fix(agent): …`, `docs: …`, `test: …`.

## Changing prompts or the agent loop

Prompt changes are easy to make and hard to evaluate. Please describe what failure you saw, include the before and after on at least one real log, and keep the anti-cheating rules intact.
