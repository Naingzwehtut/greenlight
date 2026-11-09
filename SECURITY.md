# Security policy

greenlight gives a language model write access to code inside CI, so security reports are taken seriously.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting instead: **Security → Report a vulnerability** on this repository.

Include what an attacker controls (for example a pull request from a fork, a crafted CI log, or file contents the model reads), what they can achieve, and steps to reproduce.

You can expect an acknowledgement within a week.

## In scope

- Escaping the repository through the agent's file tools
- Writing to denied paths (`.github/`, lockfiles, secrets)
- Running commands other than the configured checks
- Leaking API keys or tokens into logs, comments or PRs
- Getting greenlight to publish changes for a fork's pull request
- Bypassing the tampering checks described in [docs/safety.md](docs/safety.md)

## Out of scope

- Your own test suite executing code the model wrote: this is how CI works, and fix PRs are meant to be reviewed before merging.
- Model output quality (wrong fixes); please open a normal issue.
