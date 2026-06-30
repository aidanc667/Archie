# Source-Snippet Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include full source content for each top-risk file in the Context Pack sent to Claude, so claims about code (e.g. "no cycle guard") can be checked against real source instead of inferred from metrics alone.

**Architecture:** `runPipeline` already reads every file's content for LOC counting; that same data is captured into a path→source map and threaded through `buildContextPack` into `TopRiskFile.source`. The token budget is raised to accommodate the larger payload, and the reasoning system prompt is updated to require checking claims against the included source.

**Tech Stack:** TypeScript (existing codebase, no new dependencies).

---

## File Structure

- `src/summarizer.ts` — `buildContextPack` gains a `sourceByPath` parameter; `TopRiskFile` gains a `source` field
- `src/index.ts` — captures source content into a map (reusing the existing per-file read), passes it to `buildContextPack`
- `src/cli.ts` — raises the hardcoded `maxTokens` default from `50000` to `200000`
- `src/reasoning.ts` — system prompt wording update (no signature changes)

---

## Task 1: Add `source` field and `sourceByPath` parameter to the summarizer

**Files:**
- Modify: `src/summarizer.ts`
- Modify: `src/summarizer.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `src/summarizer.test.ts`, after the existing three tests inside the `describe("buildContextPack", ...)` block (as a new sibling `it`, before the closing `});`):

```typescript
  it("populates topRiskFiles[].source from sourceByPath for included files", () => {
    const sourceByPath = new Map<string, string>([
      ["/repo/a.ts", "export function a() { return 1; }"],
      ["/repo/b.ts", "export function b() { return 2; }"],
    ]);

    const pack = buildContextPack(makeGraph(), makeScores(), sourceByPath, {
      topN: 1,
      maxTokens: 50000,
    });

    expect(pack.topRiskFiles).toHaveLength(1);
    expect(pack.topRiskFiles[0].path).toBe("a.ts");
    expect(pack.topRiskFiles[0].source).toBe("export function a() { return 1; }");
  });

  it("falls back to an empty string when a top-risk file's source is missing from the map", () => {
    const sourceByPath = new Map<string, string>(); // empty — no entries

    const pack = buildContextPack(makeGraph(), makeScores(), sourceByPath, {
      topN: 1,
      maxTokens: 50000,
    });

    expect(pack.topRiskFiles).toHaveLength(1);
    expect(pack.topRiskFiles[0].source).toBe("");
  });
```

Note: `makeGraph()` builds nodes with `id: "file:a.ts"` and `path: "a.ts"` resolved against root `/repo` implicitly (the existing fixture data) — but `buildContextPack` doesn't know about a "root" itself, it only deals with the `CodeGraph`'s node `path` field (already-relative, e.g. `"a.ts"`) versus the new `sourceByPath` map's keys, which `index.ts` will populate using **absolute** paths (matching how `index.ts` reads files). To make this test correct without requiring `buildContextPack` to do path-resolution work, the lookup key strategy is decided in Step 3 below — read that before assuming this test will pass as-is.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/summarizer.test.ts`
Expected: FAIL — `Expected 3 arguments, but got 4` (TypeScript compile error) or similar, since `buildContextPack` doesn't yet accept a `sourceByPath` parameter

- [ ] **Step 3: Decide the lookup key and update the implementation**

Read the current `src/summarizer.ts` first. The existing `pathByFileId` helper maps `graph node id` (e.g. `"file:a.ts"`) to `relative path` (e.g. `"a.ts"`). The new `sourceByPath` map (built later in `index.ts`, Task 2) will use **absolute** file paths as keys, because that's what `index.ts` already has on hand from `walkRepo`'s output. To bridge this without forcing `summarizer.ts` to know about "root" or do its own path resolution, change the lookup key to be the **graph node id** instead of an absolute path — i.e., `sourceByPath` is keyed by the same `fileId` string (e.g. `"file:a.ts"`) used everywhere else in the graph, not by absolute filesystem path. `index.ts` (Task 2) will build the map with that key shape, since it already computes `file:${path.relative(root, filePath)}` for `complexityByFile` — the identical key can be reused for `sourceByPath`.

Re-write the test from Step 1 to match this decision — update `src/summarizer.test.ts`'s two new tests so `sourceByPath` is keyed by `fileId`, not absolute path:

```typescript
  it("populates topRiskFiles[].source from sourceByPath for included files", () => {
    const sourceByPath = new Map<string, string>([
      ["file:a.ts", "export function a() { return 1; }"],
      ["file:b.ts", "export function b() { return 2; }"],
    ]);

    const pack = buildContextPack(makeGraph(), makeScores(), sourceByPath, {
      topN: 1,
      maxTokens: 50000,
    });

    expect(pack.topRiskFiles).toHaveLength(1);
    expect(pack.topRiskFiles[0].path).toBe("a.ts");
    expect(pack.topRiskFiles[0].source).toBe("export function a() { return 1; }");
  });

  it("falls back to an empty string when a top-risk file's source is missing from the map", () => {
    const sourceByPath = new Map<string, string>(); // empty — no entries

    const pack = buildContextPack(makeGraph(), makeScores(), sourceByPath, {
      topN: 1,
      maxTokens: 50000,
    });

    expect(pack.topRiskFiles).toHaveLength(1);
    expect(pack.topRiskFiles[0].source).toBe("");
  });
```

(`makeScores()`'s `RiskScore` entries already use `fileId: "file:a.ts"` / `"file:b.ts"` — see the existing fixture in `src/summarizer.test.ts` — so this key shape lines up directly with `RiskScore.fileId`, which is what `buildContextPack` iterates over when building `topRiskFiles`.)

Now update `src/summarizer.ts`:

Add `source: string` to the `TopRiskFile` interface:

```typescript
export interface TopRiskFile {
  path: string;
  riskScore: number;
  complexity: number;
  fanIn: number;
  loc: number;
  source: string;
}
```

Change `buildContextPack`'s signature to accept the new parameter (inserted before `options`, per the design spec's parameter-ordering convention):

```typescript
export function buildContextPack(
  graph: CodeGraph,
  scores: RiskScore[],
  sourceByPath: Map<string, string>,
  options: ContextPackOptions
): ContextPack {
```

Inside the function, update the `topRiskFiles` mapping (inside the `while (topN.length > 0)` loop) to populate `source`:

```typescript
    const topRiskFiles: TopRiskFile[] = topN.map((s) => ({
      path: paths.get(s.fileId) ?? s.fileId,
      riskScore: s.riskScore,
      complexity: s.complexity,
      fanIn: s.fanIn,
      loc: s.loc,
      source: sourceByPath.get(s.fileId) ?? "",
    }));
```

- [ ] **Step 4: Update the three pre-existing tests' call sites**

The three existing tests in `src/summarizer.test.ts` (`"includes top-N risk files..."`, `"falls back to cluster-summary mode..."`, `"incrementally prunes..."`) all call `buildContextPack(graph, scores, options)` with 3 arguments. Update each call site to pass an empty `Map` as the third argument (before `options`), since none of those tests care about source content:

Change:
```typescript
    const pack = buildContextPack(makeGraph(), makeScores(), { topN: 1, maxTokens: 50000 });
```
to:
```typescript
    const pack = buildContextPack(makeGraph(), makeScores(), new Map(), { topN: 1, maxTokens: 50000 });
```

Apply the same pattern (insert `new Map(),` before the options object) to all three pre-existing call sites: the `maxTokens: 50000` one, the `maxTokens: 1` one, and the `makeThreeFileGraph()`/`makeThreeFileScores()`/`maxTokens: 89` one.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/summarizer.test.ts`
Expected: PASS (5 tests — 3 existing plus 2 new)

- [ ] **Step 6: Commit**

```bash
git add src/summarizer.ts src/summarizer.test.ts
git commit -m "feat: add source field to TopRiskFile, threaded via sourceByPath"
```

---

## Task 2: Build and pass the source map from `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read the current `src/index.ts`**

Confirm the current per-file loop structure (it already reads each file's content via `readFile(filePath, "utf8")` for LOC counting) before editing.

- [ ] **Step 2: Capture source content into a new map**

In `src/index.ts`, change this block:

```typescript
  const parsedByFile = new Map<string, FileEntry>();
  const complexityByFile = new Map<string, number>();

  for (const filePath of files) {
    const parsed = await parseFile(filePath);
    const complexity = await computeComplexity(filePath);
    const loc = (await readFile(filePath, "utf8")).split("\n").length;

    parsedByFile.set(filePath, { loc, parsed });
    complexityByFile.set(`file:${path.relative(root, filePath)}`, complexity);
  }
```

to:

```typescript
  const parsedByFile = new Map<string, FileEntry>();
  const complexityByFile = new Map<string, number>();
  const sourceByPath = new Map<string, string>();

  for (const filePath of files) {
    const parsed = await parseFile(filePath);
    const complexity = await computeComplexity(filePath);
    const source = await readFile(filePath, "utf8");
    const loc = source.split("\n").length;

    const fileId = `file:${path.relative(root, filePath)}`;
    parsedByFile.set(filePath, { loc, parsed });
    complexityByFile.set(fileId, complexity);
    sourceByPath.set(fileId, source);
  }
```

This reuses the same `readFile` call that was already happening (no new file reads — `source` is computed once and used for both LOC counting and the new map), and reuses the same `fileId` string format already used for `complexityByFile`.

- [ ] **Step 3: Pass the map into `buildContextPack`**

Change:
```typescript
  const pack = buildContextPack(graph, scores, { topN: options.topN, maxTokens: options.maxTokens });
```
to:
```typescript
  const pack = buildContextPack(graph, scores, sourceByPath, { topN: options.topN, maxTokens: options.maxTokens });
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: all tests PASS (the existing `src/index.test.ts` mocks the Anthropic client, not the file-reading logic, so it should be unaffected — but verify)

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean, no errors

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: build and pass source-by-fileId map into buildContextPack"
```

---

## Task 3: Raise the default token budget

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Change the hardcoded `maxTokens` value**

In `src/cli.ts`, find the `runPipeline({...})` call inside the `analyze` action handler. Change:
```typescript
        const result = await runPipeline({
          repoPath,
          topN: Number.parseInt(opts.topN, 10),
          maxTokens: 50000,
          generatePdf: false,
        });
```
to:
```typescript
        const result = await runPipeline({
          repoPath,
          topN: Number.parseInt(opts.topN, 10),
          maxTokens: 200000,
          generatePdf: false,
        });
```

- [ ] **Step 2: Run tests and typecheck**

Run: `npx vitest run`
Expected: all tests PASS (no test asserts on the literal `50000`/`200000` value as a magic CLI constant — `src/cli.test.ts` and `src/cli-pdf.test.ts` test error paths and flag presence, not this specific number; `src/index.test.ts` and `src/summarizer.test.ts` pass their own explicit `maxTokens` values directly to `runPipeline`/`buildContextPack`, independent of this CLI default)

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean, no errors

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: raise default token budget to 200k to accommodate source snippets"
```

---

## Task 4: Update the reasoning system prompt's grounding rule

**Files:**
- Modify: `src/reasoning.ts`

- [ ] **Step 1: Update the `SYSTEM_PROMPT` constant**

In `src/reasoning.ts`, change the `SYSTEM_PROMPT` constant from:

```typescript
const SYSTEM_PROMPT = `You are a Staff Engineer evaluating a codebase's architecture.
You will be given a Context Pack: a system summary, top-risk files with metrics,
a compressed dependency graph snapshot, and (if the repo is large) cluster-level
aggregates instead of per-file detail.

Rules:
- Only reason from facts present in the Context Pack. Never invent files, functions,
  dependencies, or relationships not present in the data given to you.
- If the Context Pack lacks the detail needed to support a claim, say
  "insufficient visibility" rather than guessing.
- Always respond with exactly these five sections, in this order, using these
  exact headings:
1. System Summary
2. Top 5 Architectural Risks
3. Production Failure Scenarios
4. Refactor Plan (step-by-step)
5. Senior Engineer Verdict
Do not add, omit, or reorder sections.`;
```

to:

```typescript
const SYSTEM_PROMPT = `You are a Staff Engineer evaluating a codebase's architecture.
You will be given a Context Pack: a system summary, top-risk files with metrics and
full source code, a compressed dependency graph snapshot, and (if the repo is large)
cluster-level aggregates instead of per-file detail.

Rules:
- Only reason from facts present in the Context Pack. Never invent files, functions,
  dependencies, or relationships not present in the data given to you.
- Top-risk files include their full source code. Before claiming something is
  "missing," "absent," or "has no evidence of" (e.g. error handling, a guard clause,
  a cycle check), you MUST check the actual source code included for that file, not
  just its metrics. If the source for a file is not included (e.g. it wasn't a
  top-risk file, or the pack fell back to cluster-summary mode), say
  "insufficient visibility" rather than guessing.
- Always respond with exactly these five sections, in this order, using these
  exact headings:
1. System Summary
2. Top 5 Architectural Risks
3. Production Failure Scenarios
4. Refactor Plan (step-by-step)
5. Senior Engineer Verdict
Do not add, omit, or reorder sections.`;
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run src/reasoning.test.ts`
Expected: PASS (7 tests — this is a wording-only change inside a template literal; no test asserts on the exact prompt text, only on `validateReportSections`/`generateReport`/`generateSimplifiedSummary` behavior, which is unaffected)

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean, no errors

- [ ] **Step 3: Commit**

```bash
git add src/reasoning.ts
git commit -m "feat: update grounding rule to require checking included source before claiming absence"
```

---

## Task 5: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests across all files PASS

- [ ] **Step 2: Build and run against this repo**

Run (requires `ANTHROPIC_API_KEY` to be set in the shell): `npm run build && node dist/cli.js analyze . --out archie-report.md --verbose --debug-graph`

- [ ] **Step 3: Verify source is actually included in the Context Pack**

Run: `node -e "
import('./dist/summarizer.js').then(async (summarizer) => {
  // sanity check only — confirm the build output exists and the module loads
  console.log(typeof summarizer.buildContextPack);
});
"`
Expected: prints `function`

More directly: re-run with `--debug-graph` and manually confirm via the generated `archie-report.md` that Risk claims referencing `metrics.ts`'s `depthOf` (or any other previously-misreported function) now either correctly identify the existing cycle guard, or are absent from the risk list entirely — this is the core regression check for the bug this feature fixes.

- [ ] **Step 4: Manually review `archie-report.md` for the specific regression**

Search the generated report for any claim that `depthOf` or `computeDependencyDepth` lacks a cycle guard:

Run: `grep -n "cycle\|circular\|RangeError\|stack overflow" archie-report.md`

Expected: either no matches, or any matches correctly reference the existing `visiting: Set<string>` guard rather than claiming it's absent. If the false claim still appears, this indicates the source wasn't actually reaching the model (e.g. `metrics.ts` wasn't in the top-N risk files this run, or the token budget pruned it out) — investigate before considering this task complete.

- [ ] **Step 5: Commit verification note** (only if any fixes were needed during verification; otherwise skip — no commit needed for a clean verification pass)

---

## Self-Review Notes

- **Spec coverage:** All components from the design spec are covered — `TopRiskFile.source` + `sourceByPath` parameter (Task 1), `index.ts` wiring (Task 2), raised token budget (Task 3), updated grounding rule (Task 4), manual verification against the specific regression that motivated this feature (Task 5).
- **Placeholder scan:** No TBDs; all steps contain complete code.
- **Type consistency:** `sourceByPath: Map<string, string>` is defined consistently across Task 1 (`summarizer.ts`'s parameter) and Task 2 (`index.ts`'s construction) — both use the `fileId` string format (`"file:<relativePath>"`) as the map key, matching the existing `complexityByFile` convention already in `index.ts`. This resolves an ambiguity in the original design spec, which didn't specify whether `sourceByPath` would be keyed by absolute path or by graph node id — keying by `fileId` was chosen during planning (Task 1, Step 3) because it avoids `summarizer.ts` needing any path-resolution logic, consistent with its existing filesystem-free design.
- **Non-goals respected:** no smart excerpting, no separate sub-budget, no redaction, no new CLI flag — matches the spec's explicit non-goals list.
