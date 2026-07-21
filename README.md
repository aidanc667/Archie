# Archie

Archie is an AI-powered architecture reviewer for codebases. It parses your code with real AST parsing (not regex or heuristics), builds a dependency graph across every file, ranks files by how risky they are to change, and sends only the riskiest ones to Claude for a grounded, evidence-backed review — one that isn't allowed to claim a file has no tests or no error handling unless that's actually true in the graph.

It runs two ways: as a CLI you point at any local repo, or as a step in a GitHub Action that reviews every pull request automatically.

## See it in action

[`examples/deepinsight-report.md`](examples/deepinsight-report.md) is a real, unedited report from a live run against [DeepInsight](https://github.com/aidanc667/DeepInsight), a ~7,000 LOC production Next.js/TypeScript app. It caught a race condition in concurrent promise handling, a client-side auth guard with no corresponding code that ever sets the session key it checks, an untested 986-line god-component, and a fan-in-15 data transformer with no error handling — with root causes, reproduction scenarios, and a step-by-step refactor plan formatted to paste directly into Claude Code.

## Quickstart

```bash
git clone https://github.com/aidanc667/archie
cd archie
npm install
npm run build

export ANTHROPIC_API_KEY=sk-...
node dist/cli.js analyze /path/to/your/repo
```

This writes `archie-report.md` in the current directory.

## How it works

1. Parses every TypeScript, JavaScript, and Python file using tree-sitter to extract functions, classes, and imports.
2. Builds a dependency graph across the whole repo — which files import which, how many files depend on each file (fan-in), and whether each file has a matching test file.
3. Scores every file for risk using complexity, fan-in, and test coverage, and picks the riskiest ones.
4. Sends only those files to Claude through a two-pass, tool-calling pipeline. The model can only claim a file lacks tests or error handling if the graph actually confirms it — this is what stops it from hallucinating risks that aren't there.
5. Assembles a report: a system summary, the top risks with root cause and evidence, concrete production failure scenarios, and a refactor plan written as ready-to-paste Claude Code instructions.

## Commands

### `archie analyze <path>`

| Flag | Description |
|---|---|
| `--out <file>` | Output path for the report (default `./archie-report.md`) |
| `--topN <n>` | Number of top-risk files to review in detail (default `10`) |
| `--diff <branch>` | Only analyze files changed vs. the given branch — used for PR review |
| `--json` | Print structured JSON to stdout instead of writing a markdown file |
| `--pdf` | Also generate a simplified, non-technical PDF summary |
| `--watch` | Re-run automatically on every file change |
| `--no-cache` | Skip the parse cache |
| `--verbose` | Print pipeline progress to stderr |

### `archie fix <repo> --report <path>`

Takes an existing Archie report and, for each refactor step, hands it to a second headless Claude Code agent to implement and verify. Nothing is committed automatically — each change is shown to you with a build/test result, and you approve or reject it before it's kept.

## Using it on GitHub pull requests

Add a workflow like this to the repo you want reviewed:

```yaml
# .github/workflows/archie-pr-review.yml
name: Archie PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  archie-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: aidanc667/archie@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Then add an `ANTHROPIC_API_KEY` repo secret (Settings → Secrets and variables → Actions). Archie will comment its review directly on every pull request.

`aidanc667/archie@v1` is a composite Action (see [`action.yml`](action.yml)) — it checks out and builds Archie fresh on every run and posts the PR comment itself, so this is the entire setup; no manual multi-step workflow to copy. `top-n` is also configurable (`with: { top-n: '15' }`) if you want more files reviewed in detail per run.

## Triggering fixes from a PR comment (`/archie fix`)

Beyond the review comment, Archie can also apply its own suggested refactor
steps. Commenting `/archie fix` on a pull request runs the full pipeline
non-interactively: it re-analyzes the PR, hands each Refactor Plan step to a
headless Claude Code agent, keeps only the steps whose build/test pass, and
proposes the result as a **brand new pull request** targeting the same
branch you're already reviewing — never `main`, and never a direct push to
your PR branch.

### What it does and doesn't do

- **Does:** analyze the PR, run each refactor step through an isolated
  agent, verify build/test after each step, and — if anything was kept —
  open a second PR (`archie-fix/pr-<n>-<timestamp>` → your PR's branch) with
  a comment linking back to it from the original PR.
- **Does not:** push directly to your PR's branch, touch the default
  branch, or merge anything automatically. The fix PR is a normal proposal;
  merging (or closing) it is a normal human review decision like any other
  PR.
- If the agent made no changes worth keeping, it says so in the logs and
  exits cleanly — no PR is opened.

### Who can trigger it

Only commenters GitHub itself classifies as `OWNER`, `MEMBER`, or
`COLLABORATOR` on the repository can trigger a run — a comment from a fork
PR's author doesn't qualify unless they separately hold one of those roles.
This is enforced in the workflow's `if:` condition, not by convention.

### Setup for your own repo

1. Add a workflow file at `.github/workflows/archie-fix-command.yml`:

   ```yaml
   name: Archie Fix Command

   on:
     issue_comment:
       types: [created]

   permissions:
     contents: write
     pull-requests: write

   jobs:
     fix:
       if: >
         github.event.issue.pull_request &&
         contains(github.event.comment.body, '/archie fix') &&
         contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - uses: aidanc667/archie/fix-action@main
           with:
             anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
             pr-number: ${{ github.event.issue.number }}
   ```

2. Add the same `ANTHROPIC_API_KEY` repo secret used for PR review (Settings
   → Secrets and variables → Actions).
3. Comment `/archie fix` on any open pull request.

`aidanc667/archie/fix-action@main` is a second, separate composite Action
from the root one (see [`fix-action/action.yml`](fix-action/action.yml)) — it
checks out the PR's actual head branch, builds Archie, installs the Claude
Code CLI, runs `archie fix --yes`, and opens the resulting PR itself.

## Running a full-repo review on demand (Archie Full Review)

Beyond PR review, Archie can also run a full, non-diff-scoped analysis of
the entire repository — not just the files changed in a PR — and post the
result to a single, persistent GitHub Issue labeled `archie-report`,
updating that same issue on every subsequent run instead of opening a new
one each time.

### How to trigger it

This is a manual, on-demand trigger only — there's no PR or issue comment
involved:

1. Go to the repo's **Actions** tab.
2. Select **Archie Full Review** from the list of workflows.
3. Click **Run workflow** (optionally set the `top-n` input to control how
   many top-risk files are reviewed in detail).

You can also trigger it from the command line with the GitHub CLI:

```bash
gh workflow run "Archie Full Review"
```

Note: the **Run workflow** button only appears once the workflow file
exists on the repo's **default branch** — pushing it on a feature branch or
opening a PR with it isn't enough for the button to show up.

### Setup for your own repo

1. Add a workflow file at `.github/workflows/archie-full-review.yml`:

   ```yaml
   name: Archie Full Review

   on:
     workflow_dispatch:
       inputs:
         top-n:
           description: "Number of top-risk files to review in detail"
           required: false
           default: '10'
           type: string

   permissions:
     contents: read
     issues: write

   jobs:
     full-review:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - uses: aidanc667/archie/full-review-action@main
           with:
             anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
             top-n: ${{ inputs.top-n }}
   ```

2. Add the same `ANTHROPIC_API_KEY` repo secret used for PR review (Settings
   → Secrets and variables → Actions).

`aidanc667/archie/full-review-action@main` is a composite Action, separate
from the root one (see
[`full-review-action/action.yml`](full-review-action/action.yml)) — it
checks out the repo, builds Archie, runs a full (non-`--diff`) analysis,
and creates or updates the `archie-report` issue itself. A local
`uses: ./full-review-action` path only resolves inside the Archie repo
itself; external consumers should reference the published `@main` action
shown above instead (or pin to a specific ref for reproducible runs).

### Pinning the report issue (optional)

If you want the `archie-report` issue to stay visible at the top of your
repo's issue list, you can pin it manually from the GitHub UI after the
first run creates it (issue page → **Pin issue**). This is a one-time
manual step, not something Archie automates — GitHub's REST API has no
endpoint for pinning an entire issue; pinning is only available through
GitHub's GraphQL API, which is out of scope here.

## Testing

`npm test` runs 129 tests across 14 files (Vitest), covering the parser, graph construction, risk scoring, the fix pipeline, and CLI integration.
