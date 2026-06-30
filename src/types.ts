// src/types.ts
export interface FileNode {
  kind: "file";
  id: string;
  path: string;
  loc: number;
}

export interface FunctionNode {
  kind: "function";
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
}

export interface ClassNode {
  kind: "class";
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
}

export type GraphNode = FileNode | FunctionNode | ClassNode;

export type EdgeType = "CONTAINS" | "IMPORTS" | "CALLS" | "EXPORTS" | "TESTED_BY";

export interface Edge {
  type: EdgeType;
  from: string;
  to: string;
  confidence: number;
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: Edge[];
}
