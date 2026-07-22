// src/deadcode.test.ts
import { describe, it, expect } from "vitest";
import { computeDeadFiles } from "./deadcode.js";
import type { CodeGraph } from "./types.js";

describe("computeDeadFiles", () => {
  it("flags a file with zero importers that isn't an entry point or a test file", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/orphan.ts", path: "src/orphan.ts", loc: 10 },
      ],
      edges: [],
    };

    const report = computeDeadFiles(graph);

    expect(report.candidates).toEqual([
      { fileId: "file:src/orphan.ts", path: "src/orphan.ts" },
    ]);
  });

  it("does not flag index.ts with zero importers, treating it as a likely entry point", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/index.ts", path: "src/index.ts", loc: 5 },
      ],
      edges: [],
    };

    const report = computeDeadFiles(graph);

    expect(report.candidates).toEqual([]);
  });

  it("does not flag cli.ts with zero importers, treating it as a likely entry point", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/cli.ts", path: "src/cli.ts", loc: 5 },
      ],
      edges: [],
    };

    const report = computeDeadFiles(graph);

    expect(report.candidates).toEqual([]);
  });

  it("flags clientUtils.ts (which merely contains 'cli' as a substring) with zero importers", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/clientUtils.ts", path: "src/clientUtils.ts", loc: 5 },
      ],
      edges: [],
    };

    const report = computeDeadFiles(graph);

    expect(report.candidates).toEqual([
      { fileId: "file:src/clientUtils.ts", path: "src/clientUtils.ts" },
    ]);
  });

  it("does not flag a test file with zero importers, since test runners invoke it directly", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/orphan.test.ts", path: "src/orphan.test.ts", loc: 5 },
      ],
      edges: [],
    };

    const report = computeDeadFiles(graph);

    expect(report.candidates).toEqual([]);
  });

  it("never flags a file that has at least one real importer, regardless of its name", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/a.ts", path: "src/a.ts", loc: 5 },
        { kind: "file", id: "file:src/util.ts", path: "src/util.ts", loc: 5 },
      ],
      edges: [{ type: "IMPORTS", from: "file:src/a.ts", to: "file:src/util.ts", confidence: 1.0 }],
    };

    const report = computeDeadFiles(graph);

    expect(report.candidates).toEqual([
      { fileId: "file:src/a.ts", path: "src/a.ts" },
    ]);
  });

  it("returns an empty candidate list, without crashing, for an empty graph", () => {
    const graph: CodeGraph = { nodes: [], edges: [] };

    const report = computeDeadFiles(graph);

    expect(report).toEqual({ candidates: [] });
  });

  it("returns an empty candidate list when every file imports at least one other file", () => {
    const graph: CodeGraph = {
      nodes: [
        { kind: "file", id: "file:src/a.ts", path: "src/a.ts", loc: 5 },
        { kind: "file", id: "file:src/b.ts", path: "src/b.ts", loc: 5 },
        { kind: "file", id: "file:src/c.ts", path: "src/c.ts", loc: 5 },
      ],
      edges: [
        { type: "IMPORTS", from: "file:src/a.ts", to: "file:src/b.ts", confidence: 1.0 },
        { type: "IMPORTS", from: "file:src/b.ts", to: "file:src/c.ts", confidence: 1.0 },
        { type: "IMPORTS", from: "file:src/c.ts", to: "file:src/a.ts", confidence: 1.0 },
      ],
    };

    const report = computeDeadFiles(graph);

    expect(report).toEqual({ candidates: [] });
  });
});
