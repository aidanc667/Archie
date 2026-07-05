// src/diff.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);

export interface DiffScope {
  // Absolute paths of changed source files to restrict analysis to, or
  // undefined when the analysis should cover the full repo (no --diff given,
  // git diff failed, or the diff touched no source files).
  files: string[] | undefined;
  requested: boolean;
  scoped: boolean;
  // Count of changed *source* files found in the diff. null when --diff
  // wasn't requested, or when `git diff` itself failed.
  changedFileCount: number | null;
  errorMessage?: string;
}

export function resolveDiffScope(repoPath: string, diffRef: string | undefined): DiffScope {
  if (!diffRef) {
    return { files: undefined, requested: false, scoped: false, changedFileCount: null };
  }
  try {
    const output = execSync(`git diff --name-only ${diffRef} HEAD`, { cwd: repoPath, encoding: "utf8" });
    const changed = output
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .filter((f) => SOURCE_EXTS.has(f.slice(f.lastIndexOf("."))))
      .map((f) => path.resolve(repoPath, f))
      .filter((f) => existsSync(f));
    if (changed.length === 0) {
      return { files: undefined, requested: true, scoped: false, changedFileCount: 0 };
    }
    return { files: changed, requested: true, scoped: true, changedFileCount: changed.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { files: undefined, requested: true, scoped: false, changedFileCount: null, errorMessage: message };
  }
}
