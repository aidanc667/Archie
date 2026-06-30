// src/graph.ts
import path from "node:path";
import type { CodeGraph, GraphNode, Edge, FileNode } from "./types.js";
import type { ParsedFile } from "./parser.js";

export interface FileEntry {
  loc: number;
  parsed: ParsedFile;
}

function resolveImport(
  fromFile: string,
  importSpecifier: string,
  fileIdByAbsPath: Map<string, string>
): string | undefined {
  if (!importSpecifier.startsWith(".")) return undefined;

  const baseDir = path.dirname(fromFile);
  const candidateBase = path.resolve(baseDir, importSpecifier);
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx"];

  for (const ext of extensions) {
    const candidate = candidateBase + ext;
    if (fileIdByAbsPath.has(candidate)) {
      return fileIdByAbsPath.get(candidate);
    }
  }
  return undefined;
}

export function buildGraph(
  parsedByFile: Map<string, FileEntry>,
  root: string
): CodeGraph {
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  const fileIdByAbsPath = new Map<string, string>();

  // Pass 1: create FileNodes
  for (const absPath of parsedByFile.keys()) {
    const id = `file:${path.relative(root, absPath)}`;
    fileIdByAbsPath.set(absPath, id);
  }

  // Pass 2: create FileNodes, function/class nodes, CONTAINS edges
  for (const [absPath, entry] of parsedByFile) {
    const fileId = fileIdByAbsPath.get(absPath)!;
    const relPath = path.relative(root, absPath);

    const fileNode: FileNode = { kind: "file", id: fileId, path: relPath, loc: entry.loc };
    nodes.push(fileNode);

    for (const fn of entry.parsed.functions) {
      const fnId = `function:${relPath}:${fn.name}:${fn.startLine}`;
      nodes.push({
        kind: "function",
        id: fnId,
        name: fn.name,
        fileId,
        startLine: fn.startLine,
        endLine: fn.endLine,
      });
      edges.push({ type: "CONTAINS", from: fileId, to: fnId, confidence: 1.0 });
    }

    for (const cls of entry.parsed.classes) {
      const clsId = `class:${relPath}:${cls.name}:${cls.startLine}`;
      nodes.push({
        kind: "class",
        id: clsId,
        name: cls.name,
        fileId,
        startLine: cls.startLine,
        endLine: cls.endLine,
      });
      edges.push({ type: "CONTAINS", from: fileId, to: clsId, confidence: 1.0 });
    }
  }

  // Pass 3: resolve IMPORTS edges
  for (const [absPath, entry] of parsedByFile) {
    const fileId = fileIdByAbsPath.get(absPath)!;
    for (const importSpecifier of entry.parsed.imports) {
      const targetId = resolveImport(absPath, importSpecifier, fileIdByAbsPath);
      if (targetId) {
        edges.push({ type: "IMPORTS", from: fileId, to: targetId, confidence: 1.0 });
      }
    }
  }

  return { nodes, edges };
}
