# Safety model

greenlight runs a language model with write access to your code inside CI. These are the rules that keep that safe and honest.

## The model cannot cheat its way to green

A change is rejected when its diff:

| Rule | Detects |
| --- | --- |
| `skip-test` | `it.skip`, `test.todo`, `xit(`, `@pytest.mark.skip`, `@pytest.mark.xfail`, `pytest.skip(`, `@unittest.skip` |
| `focus-test` | `it.only`, `fdescribe(` (which silently skips everything else) |
| `remove-assertion` | removed `expect(`, `assert`, `.should`, `assertEqual(`… lines in test files |
| `silence-typecheck` | added `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `# type: ignore`, `# pyright: ignore` |
| `silence-lint` | added `eslint-disable`, `# noqa`, `biome-ignore`, `prettier-ignore` |
| `delete-test-file` | a deleted test file |

On top of that, test files are read-only unless `allowTestChanges: true`. The model is told the rules up front, and when it breaks one, `finish` is refused with the list of violations so it can undo them. If it keeps going, the attempt ends as `rejected` and nothing is published.

## The model cannot leave the repository

Every path from the model is resolved against the repository root, and anything that resolves outside it (`../`, absolute paths) is refused. Symlinks are not followed out of the root by the tools.

These paths can never be written, whatever the config says:

```
.github/**  .git/**  **/node_modules/**  lockfiles  **/.env*  **/*.pem  **/*.key
```

`.env*`, `*.pem` and `*.key` files cannot be read either. Dependency manifests (`package.json`, `pyproject.toml`, `requirements*.txt`…) are read-only unless `allowDependencyChanges: true`.

## The model cannot run arbitrary commands

There is no shell tool. `run_check` accepts only the names of commands greenlight built (`reproduce`, `test`, `typecheck`, `lint`). Those commands come from your config, your `package.json` scripts or fixed defaults, never from the model.

Note that your own test suite does run, so code the model writes in source files is executed by your tests. That is the same trust level as any CI run on a pull request, which is why greenlight:

- does not act on runs from forks (diagnosis only), and
- publishes changes as a pull request by default, for a human to review.

## Bounded cost

Each attempt has a turn limit (`maxIterations`, default 20) and a token limit (`maxTokens`, default 1,000,000 input + output). The report shows the turns and tokens used.

## Credentials

API keys are passed as Action inputs from repository secrets and reach the provider through environment variables. They are never written to disk, logs or reports. The model never sees them.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
