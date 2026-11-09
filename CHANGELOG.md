# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/Naingzwehtut/greenlight/releases/tag/v0.1.0
