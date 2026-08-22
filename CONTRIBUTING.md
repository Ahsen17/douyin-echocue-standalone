# Contributing to Echocue

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING_zh.md)

Thanks for contributing. This project accepts AI-assisted coding, but every contributor is responsible for the
final change quality, validation, and reviewability.

## Required Workflow

1. Choose a focused scope — an atomic task from the milestone plan in `docs/08-delivery/`, or a clearly scoped fix
   or refactor.
2. Fork the repository, clone your fork, and create a dedicated branch (see [Branch and Commit Discipline](#branch-and-commit-discipline)).
3. Make the change in a focused scope and stay within the task boundary.
4. Run the required checks before opening a PR (see [Recommended Validation](#recommended-validation)).
5. Open the pull request from your fork to the upstream repository and wait for CI to pass.

Direct PRs from branches on the upstream repository are not the normal contribution path.

## What Must Be True Before a PR

A PR should only be opened when the change is ready for review and the following conditions are met:

- The change is complete for its intended scope.
- `npm run typecheck` passes with zero errors.
- `npm run test:contracts` passes when the change touches shared contracts, schemas, or fixtures.
- Relevant tests pass (`npm test`); new behavior covers normal, boundary, and failure paths.
- Coverage is updated or reviewed when the change meaningfully affects shared or high-risk behavior.
- No secrets, local-only configuration, or unrelated work are included.
- Commit messages and the PR description are written in Chinese and explain the change and the validation that was run.

## Recommended Validation

- Documentation-only changes: `npm run typecheck` when feasible.
- Ordinary code changes: `npm test` and `npm run typecheck` when feasible.
- Changes involving types, shared abstractions, databases, response structures, or contracts: `npm run typecheck`
  and `npm run test:all` when feasible.
- Larger or riskier changes: run the strongest feasible validation for the affected area —
  `npm run typecheck && npm run test:all && npm run compliance` — before opening the PR.

## Branch and Commit Discipline

- Keep branches narrow in scope and aligned with the milestone/task plan. Multiple atomic tasks from the same
  milestone may share one batch branch when agreed (for example `feat/M2-01-02`).
- Branch prefix conventions:

| Prefix | When to use | Example |
| --- | --- | --- |
| `feat/` | new feature (atomic task) | `feat/M1-03` |
| `fix/` | bug fix | `fix/M1-03-hmac-key` |
| `refactor/` | refactor with no behavior change | `refactor/crypto-types` |
| `docs/` | documentation / progress only | `docs/progress-M1-03` |
| `chore/` | build, dependencies, CI configuration | `chore/update-deps` |
| `test/` | test additions or fixes | `test/M1-03-coverage` |

- Use atomic commits when practical; commit messages are in Chinese and note the task ID (for example `feat(M5-05): ...`).
- Avoid mixing unrelated refactors, formatting, and feature work in the same PR.
- Only `docs/` branches skip the CI wait; code branches must pass CI before merge, and CI failures must never be
  force-merged.

## Security and Privacy

- Never commit or log API keys, Authorization headers, 弹幕原文, persona text, or nicknames; `trace_id` must not
  appear in Prometheus / OpenTelemetry output.
- Renderer code must not access Node APIs, the filesystem, the database, or network services; all IPC goes through
  the preload whitelist.
- The audit database is the source of truth for trace replay — keep audit writes authoritative and fail closed when
  they cannot be written.
- If a schema, migration, or fixture conflicts with its prose documentation, stop and fix the documentation rather
  than choosing an interpretation.

## AI-Assisted Work

AI-assisted implementation is allowed.

If you use AI tools:

- verify the generated code yourself,
- run the relevant checks,
- have the code independently reviewed (for example by an isolated reviewer) before opening the PR,
- make sure the final PR reflects your own review and judgment.
