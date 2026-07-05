<!--
This is a real, unedited output from a live Archie run — the exact markdown
`archie analyze` writes to `archie-report.md`. It ran against DeepInsight
(github.com/aidanc667/DeepInsight), a real ~15,500 LOC Next.js/TypeScript
research application, via:

    archie analyze . --topN 10

No text below this comment has been changed. It's included here so you can
see what Archie actually produces without cloning the repo, building it, or
paying for your own Anthropic API key.
-->

## 1. System Summary

DeepInsight is an AI-powered research assistant that accepts natural-language queries, classifies them into one of eight research modes, gathers clarifying answers from the user, runs a multi-model synthesis pipeline (Claude Haiku, Claude Sonnet, Gemini Flash with live web search), and streams structured reports back to the browser. The tech stack is Next.js 14 (App Router) on the frontend with React and Framer Motion for UI, Clerk for authentication, the Vercel AI SDK for streaming, and a Node.js/TypeScript tool (`archie-tool`) for static code-graph analysis used internally. At 129 files and ~15,500 LOC, the application complexity is moderate overall but sharply concentrated: `app/page.tsx` alone accounts for 986 LOC and a cyclomatic complexity of 81, making it the dominant risk center. The architectural style is a loosely coupled pipeline on the server side with a monolithic god-component on the client side that collapses all orchestration, state, and rendering into a single React function.

**Key Metrics**

| Metric | Value |
|--------|-------|
| Files analysed | 129 |
| Total lines of code | 15,494 |
| Highest-risk file | [`app/page.tsx`] (risk score: 0.65) |
| Files with test coverage | 2 of 10 top-risk files have `hasTests=true` (`app/page.tsx`: false; `ai/output/structured-output.ts`: false; `components/research/views/primitives.tsx`: false; `ai/graphs/research-pipeline.ts`: false) |

---

**Scope of this analysis:** Archie analyzed all 129 files in this repository, ranked them by risk, and examined the top 10 in detail for this report. The remaining 119 files were not individually assessed and are not covered by this report's findings.

## 2. Top 5 Architectural Risks

### Risk 1: God-component with no test coverage — app/page.tsx — `app/page.tsx`
**Severity:** Critical
**Why this matters:** The entire user-facing research flow — auth gating, clarification Q&A, streaming output, session persistence, and follow-up chat — lives in a single 986-LOC component with cyclomatic complexity of 81. Any regression breaks the whole product with no automated safety net (hasTests: false).
**Root cause:** All application state (14+ useState hooks), async orchestration (classify → clarify → presearch → research pipeline), and rendering logic are co-located in ResearchApp with no decomposition into testable units. Complexity of 81 far exceeds the maintainable threshold (~10-15 per function).
**Evidence:** The source shows handleAnalyze alone spans ~80 lines, firing classify, clarify/next, and clarify/plan in a manually coordinated parallel-race pattern with five mutable boolean flags (shownQ1, firstShownQuestion, didStartResearch, etc.) to guard against race conditions — all inside a single useCallback with no unit tests.

### Risk 2: High-fan-in transformer with no tests or error handling — ai/output/structured-output.ts — `ai/output/structured-output.ts`
**Severity:** High
**Why this matters:** toStructuredOutput is the single function that translates every AI response into what every mode-specific view renders. A type mismatch or field-rename in the upstream schema silently produces blank UI sections for all 8 research modes simultaneously, with no automated check to catch it.
**Root cause:** fanIn=15 means 15 files depend on this module, yet hasTests=false and hasErrorHandling=false. The function uses unsafe casts — `(raw as Record<string, unknown>).headline as string ?? ''` — to access forecast fields not present in the TypeScript schema, bypassing compile-time safety.
**Evidence:** Source lines for the forecast branch: `headline: (raw as Record<string, unknown>).headline as string ?? ''` and `keyTrends: ((raw as Record<string, unknown>).keyTrends as ForecastTrend[] | undefined)` — double-casting away the schema contract. 15 downstream consumers (ActionPlan.tsx, DecisionBreakdown.tsx, ForecastView.tsx, etc.) all IMPORT this file per the graph snapshot.

### Risk 3: sessionStorage-based auth gate is trivially bypassable — app/page.tsx — `app/page.tsx`
**Severity:** High
**Why this matters:** The auto-signout logic that protects against stale Clerk sessions is client-side only and depends entirely on sessionStorage. Any user who sets the key manually retains access indefinitely regardless of server-side session state.
**Root cause:** The Page component runs `sessionStorage.getItem('deepinsight-session')` on mount and calls signOut only if the key is absent. This is a client-enforced gate with no server validation — the actual Clerk cookie remains valid independently, and the check can be defeated by setting the key in DevTools.
**Evidence:** Source: `const hasSession = sessionStorage.getItem('deepinsight-session'); if (!hasSession) { signOut({ redirectUrl: '/sign-in' }); return; }` — the entire auth enforcement is a single localStorage read with no server round-trip or cryptographic verification.

### Risk 4: Race condition in parallel clarification fetch — app/page.tsx → handleAnalyze — `app/page.tsx`
**Severity:** High
**Why this matters:** If the clarify/next promise resolves after the plan promise, the UI can show a question from one source while the research pipeline uses context from another, producing mismatched or duplicated questions and potentially starting research with an empty or partial context string.
**Root cause:** handleAnalyze fires firstQPromise and planPromise concurrently and uses mutable closure booleans (shownQ1, didStartResearch) to arbitrate which result wins, but the .then() callback on firstQPromise is not awaited — it runs independently and can interleave with the await Promise.all([classifyPromise, planPromise]) branch in any order.
**Evidence:** Source: `firstQPromise.then(firstQ => { if (shownQ1 || didStartResearch || firstQ.done || !firstQ.question) return; ... setAppState('questioning') }).catch(() => {})` runs concurrently with `const [classifyResult, plan] = await Promise.all([classifyPromise, planPromise])`, with shared mutable flags as the only coordination mechanism.

### Risk 5: Committed build artifacts duplicate source logic — archie-tool/dist/ — `archie-tool/dist/graph.js`
**Severity:** Medium
**Why this matters:** archie-tool/dist/ files (graph.js, parser.js) appear in the repo and are scored as top-risk files — if dist is committed, fixes applied to src/ may not be reflected in dist/ until a manual build, silently running stale logic in production and making bug reproduction ambiguous.
**Root cause:** archie-tool/dist/graph.js (252 LOC, complexity 54) and archie-tool/dist/parser.js (171 LOC, complexity 44) mirror their src/ counterparts exactly in function signatures per the graph snapshot CONTAINS edges. Having both in version control creates two authoritative sources of truth for the same logic.
**Evidence:** Graph snapshot shows identical function sets: dist/graph.js CONTAINS stripJsoncComments, parseJsonc, loadPathAliases, resolveImport, resolveCandidates, testTargetKey, sourceKey, buildGraph — matching src/graph.ts exactly. Both sets appear as independent top-risk files with separate riskScores.
*Confidence: based on a partial view of this file (signature summary, not full source) — treat as directionally correct pending closer review.*

## 3. Production Failure Scenarios

### Scenario 1: Forecast mode silently renders a blank report for all users
**Trigger:** A schema change in `EliteResearchOutput` renames `headline` to `forecastHeadline` (a plausible refactor to namespace forecast-specific fields). The TypeScript compiler does not catch this because `ai/output/structured-output.ts → toStructuredOutput` accesses the field via `(raw as Record<string, unknown>).headline as string ?? ''`, bypassing the type system entirely.

**Chain of failure:** The compiled code deploys without error. Every user who submits a `forecast`-mode query receives a `StructuredOutput` object where `forecast.headline` is an empty string and `forecast.keyTrends` is `[]` (because the double-cast returns `undefined`, which the filter collapses to an empty array). `ForecastView.tsx` renders a structurally valid but content-free section — no error boundary fires, no console error appears, no alert is triggered. The feature is silently broken. Because `toStructuredOutput` has no tests (`hasTests: false`) and no error handling (`hasErrorHandling: false`), there is no automated signal. The regression is discovered only through user reports.

**Business impact:** All forecast-mode research results are blank for the duration of the deployment. Given that `ForecastView.tsx`, `GoDeeperCard.tsx`, and 13 other components all IMPORT `structured-output.ts` per the graph snapshot, any cascade from a broader schema change could blank multiple modes simultaneously.

**Likelihood:** Medium — schema changes are routine during active AI product development, and the unsafe cast pattern makes this a silent failure rather than a loud one.

---

### Scenario 2: Race condition delivers mismatched research context, producing a corrupted report
**Trigger:** A user on a slow mobile connection submits a complex query. The `/api/clarify/next` response (bound to `firstQPromise`) arrives 1.2 seconds after the `/api/clarify/plan` response, which is the opposite of the fast-path assumption in `app/page.tsx → handleAnalyze`.

**Chain of failure:** The `await Promise.all([classifyPromise, planPromise])` resolves first. The plan contains questions; `shownQ1` is still `false`, so the code path sets `firstShownQuestion = plan.questions[0]` and calls `setAppState('questioning')`. The UI renders Question 1 from the plan. Simultaneously, `firstQPromise.then(...)` is still in-flight. When it resolves, the guard `if (shownQ1 || didStartResearch ...)` correctly fires — but only because `shownQ1` was set to `true` in the plan branch. However, `presearchRef.current` was already populated by the plan branch's `firePresearch(prompt)` call. Now, if the user answers Q1 quickly, `handleSubmitAnswer` fires `/api/clarify/next` for Q2 using `newHistory` containing the answer to the plan's Q1 — but if the network is slow again and the Q2 fetch races against a user clicking "Skip questions", `startResearch` is called with a partial context string built from only answered questions, which may be just one answer or zero, while `presearchRef.current` already holds Gemini data for the full-context path. The research pipeline receives inconsistent inputs.

**Business impact:** The generated report is based on mismatched or incomplete clarification context, producing irrelevant or low-quality research output for the user. Because there is no retry or validation of context coherence, the user sees a confident-looking but incorrect report with no indication something went wrong.

**Likelihood:** Medium — the race is timing-dependent and more likely on degraded networks or under API latency spikes, both of which are routine in production.

---

### Scenario 3: Stale cached report served as current research after a session restore
**Trigger:** A user runs a research query, receives a report, and the result is cached in `localStorage` under the key `'di:report:' + prompt` (written in `app/page.tsx → useObject → onFinish`). The user later clicks the same query from the session sidebar to "re-run" it.

**Chain of failure:** In the `onRerun` callback in `app/page.tsx`, the code reads `localStorage.getItem('di:report:' + session.prompt)`, parses the cached JSON, calls `setRestoredOutput(parsed)`, and immediately sets `appState` to `'done'` — skipping the entire research pipeline. The user sees what appears to be a freshly-generated report. However, the cached data may be days or weeks old; the trust score is re-computed from stale data via `computeTrustScore(parsed)` and displayed as if it represents current confidence. No timestamp, no cache-age indicator, and no warning is shown. If the query was time-sensitive (e.g., "What is the current state of quantum computing?"), the user acts on outdated information believing it to be fresh.

**Business impact:** Users make decisions based on silently stale research. For a product whose value proposition is live, multi-model synthesis with web search, serving cached data without disclosure is a direct product integrity failure. There is no TTL on the `localStorage` cache and no UI affordance to distinguish a cached result from a live one.

**Likelihood:** High — the cache path is the default for any repeated query, and repeat queries are a common user behaviour (returning to a prior session, re-checking a topic). The `try/catch` around the cache read silently suppresses any parse errors, meaning corrupt cache entries also silently fail in unpredictable ways.

---

## 4. Refactor Plan (step-by-step)

### Step 1: Add a TTL-aware cache wrapper and a "cached result" UI indicator to prevent stale data being served as fresh research
**Why now:** This is a product integrity issue that requires no architectural changes and can be shipped in hours — it directly prevents users from acting on silently stale data, which is the highest-frequency silent failure in the current system.

**File:** `app/page.tsx`

**Effort:** Half day

> **Paste into Claude Code to implement this step:**
>
> In `app/page.tsx`, find the `onRerun` callback inside the `Sidebar` props (around the `onRerun` handler). Currently it reads from `localStorage` using the key `'di:report:' + session.prompt` and immediately sets `restoredOutput` and `appState='done'` if a cache hit is found, with no age check. You must make two changes:
>
> First, change the cache write in the `useObject → onFinish` callback: instead of storing the raw result as JSON, store an envelope `{ result, cachedAt: Date.now() }`. The write is `localStorage.setItem('di:report:' + prompt, JSON.stringify({ result, cachedAt: Date.now() }))`.
>
> Second, in the `onRerun` handler, after parsing the cached value, check `Date.now() - parsed.cachedAt > 24 * 60 * 60 * 1000` (24-hour TTL). If the cache is older than 24 hours, delete the key and fall through to normal research execution (remove the early `return`). If the cache is fresh, set `restoredOutput(parsed.result)` as before, but also set a new boolean state variable `isRestoredFromCache` to `true`. Add a visible banner in the `appState === 'done'` section that reads "Restored from cache · [date]" with a "Re-run" button that calls `onNewChat` — this renders when `isRestoredFromCache` is `true`. This step is done when: (a) cached results older than 24 hours trigger a fresh research run, (b) cached results within 24 hours display a timestamped "Restored from cache" banner, and (c) the banner includes a working "Re-run" button.

---

### Step 2: Extend `toStructuredOutput` with runtime field validation and replace unsafe double-casts in the forecast branch
**Why now:** This is the highest fan-in untested module (15 dependents per the graph snapshot) and its unsafe casts are the direct cause of silent blank-UI failures; fixing it unblocks safe schema iteration for all 8 research modes.

**File:** `ai/output/structured-output.ts`

**Effort:** 1-2 days

> **Paste into Claude Code to implement this step:**
>
> In `ai/output/structured-output.ts → toStructuredOutput`, the `forecast` branch (at the bottom of the return statement) uses the pattern `(raw as Record<string, unknown>).headline as string ?? ''` and similar double-casts for `keyTrends`, `consensus`, `contrarian`, `wildCard`. These bypass TypeScript's type checker and will silently return `undefined` (collapsed to `''` or `[]`) if field names change in `EliteResearchOutput`. You must do two things:
>
> First, add the forecast fields (`headline`, `keyTrends`, `consensus`, `contrarian`, `wildCard`) to the `EliteResearchOutput` type in `@/ai/schemas` (or wherever that type is defined). Once they are in the schema, the `raw` parameter — which is typed as `Partial<EliteResearchOutput>` — will expose them without casting. Replace all `(raw as Record<string, unknown>).X as T` expressions in the forecast branch with direct `raw.X ?? defaultValue` accesses.
>
> Second, add a runtime guard at the top of `toStructuredOutput`: if `raw` is `null` or `undefined`, return a fully-defaulted `StructuredOutput` object (all strings `''`, all arrays `[]`, all nullable fields `null`) rather than letting downstream `.map()` / `.filter()` calls throw. Add a `try/catch` wrapper around the entire return statement that catches any unexpected runtime error, logs it with `console.error('[toStructuredOutput] unexpected error:', e, 'raw mode:', raw?.queryMode)`, and returns the same safe default object. This step is done when: (a) the TypeScript compiler catches a forecast field rename without any `as` cast escape hatch, (b) passing `null` or `undefined` to `toStructuredOutput` returns a valid default object without throwing, and (c) a test file `ai/output/structured-output.test.ts` covers the null input case and at least one forecast-mode input with all required fields populated.

---

### Step 3: Extract the clarification orchestration from `handleAnalyze` into a standalone async function with deterministic promise sequencing
**Why now:** The race condition between `firstQPromise.then()` and `await Promise.all([classifyPromise, planPromise])` in `app/page.tsx → handleAnalyze` is the root cause of the mismatched-context failure scenario; isolating this logic is also the prerequisite for writing any meaningful test coverage for the core user flow.

**File:** `app/page.tsx`

**Effort:** 1-2 days

> **Paste into Claude Code to implement this step:**
>
> In `app/page.tsx`, the `handleAnalyze` function (approximately 80 lines inside a `useCallback`) orchestrates three concurrent fetches (`classifyPromise`, `firstQPromise`, `planPromise`) and uses five mutable closure booleans (`shownQ1`, `firstShownQuestion`, `didStartResearch`, etc.) to arbitrate which result wins. The `firstQPromise.then(...)` callback is not awaited — it runs independently and can interleave with the `await Promise.all(...)` branch in any order, causing the race condition described in the architecture risks.
>
> Extract all fetch logic out of `handleAnalyze` into a new standalone async function `orchestrateClarification(prompt: string, mode: QueryMode | undefined, selectedAgent: string | null): Promise<{ question: ClarificationQuestion | null; plan: QuestionPlan; classifiedMode: QueryMode | undefined; domain: string | undefined }>`. Inside this function, use `await Promise.race` or explicit sequencing — do NOT use `.then()` callbacks that run independently of an `await`. The recommended approach: (1) fire all three fetches simultaneously using `Promise.allSettled([classifyPromise, firstQPromise, planPromise])`; (2) extract results from the settled array (treating rejections as `null`); (3) apply precedence rules — if plan has questions, use plan's Q1; else use firstQ's question; else question is `null`. Return a single coherent object. Then rewrite `handleAnalyze` to `await orchestrateClarification(...)` and branch on the returned value with no mutable booleans. Move `orchestrateClarification` to a new file `lib/clarification-orchestrator.ts` so it can be unit-tested independently. This step is done when: (a) `handleAnalyze` contains no `.then()` callbacks (only `await`), (b) no mutable boolean flags (`shownQ1`, `didStartResearch`, etc.) exist in `handleAnalyze`, and (c) a test file `lib/clarification-orchestrator.test.ts` exists and covers the case where plan resolves before firstQ, and where firstQ resolves before plan.

---

### Step 4: Move `ResearchApp` state into a custom hook and split rendering into focused sub-components
**Why now:** `app/page.tsx` at 986 LOC and complexity 81 with no tests is the highest-risk file in the codebase; Step 3 reduces the orchestration risk, but the component still has 14+ `useState` declarations and all rendering co-located — decomposition is what makes future test coverage achievable.

**File:** `app/page.tsx`

**Effort:** 1 week

> **Paste into Claude Code to implement this step:**
>
> In `app/page.tsx`, the `ResearchApp` function contains approximately 14 `useState` declarations, 6 `useCallback` functions, 2 `useEffect` hooks, and all JSX rendering. This must be split into three parts:
>
> Part 1 — Extract state into a custom hook: create `hooks/useResearchApp.ts` that exports `useResearchApp()`. Move all `useState`, `useRef`, `useEffect`, and the `useObject` call into this hook. The hook returns all state values and all handler functions (`handleAnalyze`, `handleSubmitAnswer`, `handleSkipToResearch`, `handleContinueResearch`, `handleGoDeeper`, `startResearch`, `firePresearch`). `handleAnalyze` at this point should already call `orchestrateClarification` from Step 3.
>
> Part 2 — Extract sub-components: create the following files, each rendering one discrete UI state. Move the JSX blocks verbatim, then pass only the props each section needs — (a) `components/research/IdleScreen.tsx` — renders the textarea, mode cards grid, and error banner (receives `prompt`, `detectedMode`, `selectedAgent`, `isResearching`, `isChecking`, `researchError`, `onAnalyze`, `onPromptChange`, `onModeSelect`); (b) `components/research/QuestioningScreen.tsx` — renders the clarification card, question history, and Continue/Skip buttons (receives `questionPlan`, `questionIndex`, `questionHistory`, `pendingAnswer`, `fetchingNext`, `onSubmitAnswer`, `onSkipToResearch`, `onAnswerChange`); (c) `components/research/ResultsPane.tsx` — renders topbar, chat history, loading screen, results, and follow-up UI (receives `appState`, `chatHistory`, `outputData`, `isLoading`, `prompt`, etc.).
>
> Part 3 — Reduce `ResearchApp` to an orchestrator: after extraction, `ResearchApp` should be under 80 LOC, calling `useResearchApp()` and rendering `<IdleScreen>`, `<QuestioningScreen>`, or `<ResultsPane>` based on `appState`. This step is done when: (a) `app/page.tsx` is under 100 LOC, (b) `hooks/useResearchApp.ts` exists and exports all state/handlers, (c) all three sub-component files exist and render without regression, and (d) `useResearchApp.ts` can be imported and its handlers called in a test environment without a DOM.

---

### Step 5: Add `archie-tool/dist/` to `.gitignore` and remove committed build artifacts
**Why now:** Committed build artifacts create two sources of truth for the same logic; this is a one-command fix that eliminates an entire category of "which version is running?" debugging confusion with no code changes required.

**File:** `archie-tool/dist/graph.js` (and sibling dist files)

**Effort:** < 1 hour

> **Paste into Claude Code to implement this step:**
>
> The repository contains committed build artifacts in `archie-tool/dist/` (`graph.js`, `parser.js`, `index.js`, and their test files), which duplicate the source files in `archie-tool/src/`. These are scored as independent top-risk files with their own riskScores, creating ambiguity about which version is authoritative. Do the following: (1) open or create `.gitignore` at the repository root and add the line `archie-tool/dist/`; (2) run `git rm -r --cached archie-tool/dist/` to untrack all currently committed dist files without deleting them locally; (3) verify that `archie-tool/package.json` has a `build` script that compiles `src/` to `dist/` (if not, add `"build": "tsc"` or the equivalent); (4) verify that any CI pipeline step that runs `archie-tool` calls `npm run build` before execution. This step is done when: (a) `git status` shows no tracked files under `archie-tool/dist/`, (b) `.gitignore` contains `archie-tool/dist/`, (c) a fresh `git clone` followed by `npm run build` in `archie-tool/` produces a working `dist/` directory, and (d) the archie-tool's CI step includes a build stage before the run stage.

---

## 5. Senior Engineer Verdict

**Overall health rating:** Functional but fragile

**Biggest strength:** The `archie-tool` subsystem — `src/graph.ts`, `src/parser.ts`, `src/reasoning.ts`, `src/cli.ts` — is well-engineered: every file has test coverage (confirmed by `hasTests: true` and `TESTED_BY` edges in the graph snapshot), error handling is present, the JSONC comment-stripping logic is carefully documented with an explicit explanation of why a regex approach is insufficient, and the fail-open conventions (`loadPathAliases`, `loadCache`) are consistent and intentional. This is what careful, testable systems code looks like.

**Biggest risk:** `app/page.tsx` is a 986-LOC, complexity-81, untested god-component that is the sole orchestrator of the entire user-facing product — one bad merge to this file can break everything with zero automated protection.

**Recommended first action:** This week, assign one developer to implement Step 1 (cache TTL + "Restored from cache" banner) — it ships in a day, directly prevents a product integrity failure users are already experiencing silently, and requires no architectural lift.

The codebase is on a classic trajectory: a capable team shipped fast to validate the product, made smart infrastructure choices (multi-model pipeline, streaming, structured output schema), and built excellent tooling for their own use — then ran out of runway to apply that same discipline to the client-side code before it grew unwieldy. The `archie-tool` half of this repo demonstrates that the team knows how to write tested, decomposed, maintainable code; the product frontend demonstrates what happens when feature velocity outpaces structural investment. The refactor plan above is fully achievable in 3-4 focused sprints without rewriting the product, but the window for doing it cheaply is now — `app/page.tsx` at complexity 81 is already past the point where adding features without decomposition first incurs serious regression risk on every change.
