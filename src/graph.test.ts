// src/graph.test.ts
import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph.js";
import type { ParsedFile } from "./parser.js";

describe("buildGraph", () => {
  it("builds FileNodes, CONTAINS edges, and resolves relative IMPORTS edges", () => {
    const parsedByFile = new Map<string, { loc: number; parsed: ParsedFile }>([
      [
        "/repo/src/a.ts",
        {
          loc: 10,
          parsed: {
            functions: [{ name: "doWork", startLine: 1, endLine: 3 }],
            classes: [],
            imports: ["./b"],
          },
        },
      ],
      [
        "/repo/src/b.ts",
        { loc: 5, parsed: { functions: [], classes: [], imports: [] } },
      ],
    ]);

    const graph = buildGraph(parsedByFile, "/repo");

    const fileNodes = graph.nodes.filter((n) => n.kind === "file");
    expect(fileNodes.map((n) => n.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);

    const functionNodes = graph.nodes.filter((n) => n.kind === "function");
    expect(functionNodes).toHaveLength(1);

    const containsEdges = graph.edges.filter((e) => e.type === "CONTAINS");
    expect(containsEdges).toHaveLength(1);

    const importEdges = graph.edges.filter((e) => e.type === "IMPORTS");
    expect(importEdges).toHaveLength(1);
    expect(importEdges[0].confidence).toBe(1.0);
  });
});
