// src/types.test.ts
import { describe, it, expect } from "vitest";
import type { FileNode, FunctionNode, ClassNode, Edge } from "./types.js";

describe("graph types", () => {
  it("constructs a FileNode with required fields", () => {
    const node: FileNode = { kind: "file", id: "f1", path: "src/a.ts", loc: 10 };
    expect(node.kind).toBe("file");
  });

  it("constructs an Edge with confidence", () => {
    const edge: Edge = { type: "IMPORTS", from: "f1", to: "f2", confidence: 1.0 };
    expect(edge.confidence).toBe(1.0);
  });
});
