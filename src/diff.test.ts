// src/diff.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveDiffScope } from "./diff.js";

// Regression coverage for a bug found live against two different external
// repos: the PR comment reported "Analyzed 599/345 changed files" on PRs
// that each touched exactly 1 file. The root cause was never in this
// diff-resolution logic -- git diff --name-only was always correct -- it was
// that the consumer (scripts/post-pr-comment.mjs) mislabeled the *total graph
// node count* (files + every individual function + every individual class)
// as "changed files". These tests pin down what resolveDiffScope itself
// actually returns, so a future regression in the diff-resolution logic
// itself would be caught here, separate from the labeling fix in
// post-pr-comment.mjs.
describe("resolveDiffScope", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), "archie-diff-test-"));
    execFileSync("git", ["init"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

    writeFileSync(path.join(repoDir, "a.ts"), "export function a() {}\n");
    writeFileSync(path.join(repoDir, "README.md"), "# hi\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "base"], { cwd: repoDir });
    execFileSync("git", ["branch", "base"], { cwd: repoDir });

    // Simulate a real PR: one source file changed, plus a non-source file
    // (mirrors the DeepInsight case, where the only changed file was a
    // .github/workflows/*.yml).
    writeFileSync(path.join(repoDir, "a.ts"), "export function a() { return 1; }\n");
    writeFileSync(path.join(repoDir, "README.md"), "# hi there\n");
    execFileSync("git", ["commit", "-am", "change a.ts and README"], { cwd: repoDir });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("reports exactly the changed source files, not a count inflated by non-source files", () => {
    const scope = resolveDiffScope(repoDir, "base");
    expect(scope.requested).toBe(true);
    expect(scope.scoped).toBe(true);
    expect(scope.changedFileCount).toBe(1);
    expect(scope.files).toEqual([path.resolve(repoDir, "a.ts")]);
  });

  it("falls back to full-repo analysis (scoped: false) when the diff touches no source files", () => {
    execFileSync("git", ["checkout", "base"], { cwd: repoDir });
    writeFileSync(path.join(repoDir, "README.md"), "# only docs changed\n");
    execFileSync("git", ["commit", "-am", "docs only"], { cwd: repoDir });

    const scope = resolveDiffScope(repoDir, "base");
    expect(scope.requested).toBe(true);
    expect(scope.scoped).toBe(false);
    expect(scope.changedFileCount).toBe(0);
    expect(scope.files).toBeUndefined();
  });

  it("returns requested: false and does not run git at all when no diff ref is given", () => {
    const scope = resolveDiffScope(repoDir, undefined);
    expect(scope).toEqual({ files: undefined, requested: false, scoped: false, changedFileCount: null });
  });

  it("returns a captured error message and falls back to full-repo analysis when git diff fails", () => {
    const scope = resolveDiffScope(repoDir, "nonexistent-ref-xyz");
    expect(scope.requested).toBe(true);
    expect(scope.scoped).toBe(false);
    expect(scope.changedFileCount).toBeNull();
    expect(scope.errorMessage).toBeDefined();
  });
});
