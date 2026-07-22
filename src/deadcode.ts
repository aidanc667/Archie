// src/deadcode.ts
import path from "node:path";
import { PY_TEST_PREFIX_RE, TEST_SUFFIX_RE } from "./graph.js";
import type { CodeGraph } from "./types.js";

export interface DeadFileCandidate {
  fileId: string;
  path: string;
}

export interface DeadFileReport {
  candidates: DeadFileCandidate[];
}

// Known, likely entry-point basenames across the languages Archie parses
// (TS/JS/Python). This is a fixed, documented heuristic rather than reading
// package.json's `main`/`bin` fields (or an equivalent per-language manifest)
// -- doing that properly would mean parsing multiple manifest formats and
// resolving their own relative paths back to a fileId, which is out of scope
// for v1. A file that's actually wired up as an entry point only through a
// manifest, under some other basename, will still be flagged here: a known,
// documented gap, not a silent one (same tone as loadPathAliases' documented
// `extends`-chain gap in graph.ts).
const ENTRY_POINT_BASENAMES = new Set(["index", "main", "cli", "app", "server", "__main__"]);

// Exact match on the base filename (extension stripped), not a substring
// check -- "clientUtils.ts" must not be excused just because it contains
// "cli".
function isLikelyEntryPoint(filePath: string): boolean {
  const base = path.basename(filePath, path.extname(filePath));
  return ENTRY_POINT_BASENAMES.has(base);
}

// Test files are normally invoked by the test runner directly, not imported
// by other source files, so a lack of importers says nothing about whether
// they're dead. Reuses graph.ts's own TESTED_BY conventions (suffix regex
// for `.test.`/`.spec.`/Go's `_test.go`/Python's `_test.py`, plus the
// separate `test_` prefix regex for Python) rather than a third,
// possibly-inconsistent copy of the same patterns.
function isTestFile(filePath: string): boolean {
  if (TEST_SUFFIX_RE.test(filePath)) return true;
  return PY_TEST_PREFIX_RE.test(path.basename(filePath));
}

export function computeDeadFiles(graph: CodeGraph): DeadFileReport {
  const importedFileIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "IMPORTS") importedFileIds.add(edge.to);
  }

  const candidates: DeadFileCandidate[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "file") continue;
    if (importedFileIds.has(node.id)) continue;
    if (isLikelyEntryPoint(node.path)) continue;
    if (isTestFile(node.path)) continue;
    candidates.push({ fileId: node.id, path: node.path });
  }

  return { candidates };
}
