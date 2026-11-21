# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-21

### Added

- `--version`, `--effort` and `--max-tokens` options for the `greenlight` CLI.

### Changed

- The Action is now named "Greenlight CI Fixer" so it can be listed in the GitHub Marketplace.
- Re-runs update the existing fix pull request instead of failing, and greenlight only edits its own report comment.
- Fix pull request titles cut at word boundaries, keep acronyms and fall back to a default title.
- Bumped `@anthropic-ai/sdk` to 1.8.0 and other dependencies.

### Fixed

- Security: git and new-file diffs run without a shell, so model text is never expanded; the search tool no longer follows symlinks.
- Safety checks: `---`/`+++` lines inside a hunk are read as content; `skipIf` and `this.skip()` count as skipped tests; pylint, nolint, rubocop and oxlint suppressions are caught; file names starting with two dots are accepted.
- Long command output keeps its end rather than its start.
- Clear errors for bad `read_file` ranges, unparseable config files, non-numeric number options and malformed OpenAI-compatible responses.
- Reports keep piped check commands inside their table cell, keep Markdown diffs inside the code block and clamp the confidence bar.

## [0.1.0] - 2026-11-10

First release.

### Added

- GitHub Action that runs after a failed `workflow_run`, downloads the failed job logs and tries to fix the failure.
- Log parsers for Vitest, Jest, TypeScript, ESLint, pytest, mypy and Ruff, with a generic fallback.
- Failure classification into test, type, lint, build, dependency, infra, flaky and unknown; infra and flaky failures are never "fixed".
- Verified agent loop: `finish` is refused until the reproduce command and all project checks pass.
- Tampering detection for skipped tests, removed assertions, suppression comments and deleted test files.
- Path policy that confines edits to the repository and protects workflows, lockfiles, secrets, tests and manifests.
- Providers: Anthropic (default `claude-opus-5-5`), OpenAI and any OpenAI-compatible server such as Ollama.
- `pr`, `push` and `comment` modes; one updatable report comment per pull request; job summary.
- `greenlight` CLI with `diagnose` and `fix` commands.
- Offline log-reading benchmark with 14 cases.

[0.2.0]: https://github.com/Naingzwehtut/greenlight/releases/tag/v0.2.0
[0.1.0]: https://github.com/Naingzwehtut/greenlight/releases/tag/v0.1.0
