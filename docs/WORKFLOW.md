# Development Workflow — Skill Mapping

How development skills map to moments in the build/ship loop for this project.
This is a process reference, not a feature spec — update it as the workflow
changes, no approval gate needed to edit it.

## Principle

Skills aren't meant to all run together. Each one fires at a specific moment.
Running several at once on the same problem (e.g. two debuggers on one bug)
wastes effort without adding signal — pick the one that matches the moment.

## Mapping

| Moment | Skill(s) | Notes |
|---|---|---|
| Before any new feature/design work | `superpowers:brainstorming` | Gate before implementation — design doc + approval first. |
| Turning a spec into an implementation plan | `superpowers:writing-plans` | Produces the step-by-step plan that execution follows. |
| Writing each implementation step | `superpowers:test-driven-development` | Red/green/refactor per step, not just at the end. |
| After a chunk of work, before moving on | `code-simplifier`, `code-review` (low/medium effort) | Keep diffs clean incrementally rather than batching cleanup at the end. |
| Something breaks / unexpected behavior | `superpowers:systematic-debugging`, `gsd-debug`, `diagnose` | Overlapping tools — use whichever surfaces first for the situation, don't stack them on the same bug. |
| Before pushing | `ship-check` | Type check, lint, console.log/TODO scan, commit message draft. |
| Opening/iterating on a PR | `prloop`, `gsd-ship` | PR creation and looping on reviewer comments. |
| Reviewing a diff against spec + repo standards | `code-review` (high/ultra effort as needed), `review` | `review` checks both "matches spec" and "matches repo conventions" in parallel. |
| Before any GitHub OAuth / PR-data / auth surface ships (v2+) | `security-review` | Not needed for v1 (no auth surface), but a hard gate once GitHub integration starts. |
| Periodic direction sanity-check (not per-commit) | `advisor`, `honest-thinking-partner` | Used occasionally to stress-test direction, not as a per-change gate. |

## Sequencing for ARCHIE v1

```
brainstorming (done) → writing-plans → [per plan step: TDD → code-simplifier → code-review]
  → ship-check → prloop/gsd-ship → review
```

`systematic-debugging`/`diagnose` and `security-review` are invoked on-demand,
not part of the linear sequence above.
