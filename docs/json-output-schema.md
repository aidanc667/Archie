# ARCHIE JSON Output Schema

## Command

```
archie analyze <path> --json
```

When `--json` is passed, `archie analyze` writes a single JSON object to stdout instead of writing a markdown report file. Progress/status messages still go to stderr, so stdout contains only the JSON payload (safe to pipe: `archie analyze . --json > out.json`).

The TypeScript type for this shape is `ArchieJsonOutput`, exported from `src/cli.ts`.

## Shape: `ArchieJsonOutput`

```typescript
interface ArchieJsonOutput {
  version: 2;
  repoPath: string;
  topN: number;
  report: string;
  diff: {
    requested: boolean;
    scoped: boolean;
    changedFileCount: number | null;
  };
  graph: {
    fileCount: number;
    nodeCount: number;
    edgeCount: number;
    nodes: GraphNode[];
    edges: Edge[];
  };
}
```

| Field | Type | Description |
|---|---|---|
| `version` | `2` | Schema version of this JSON output, as a literal number. Currently always `2`. See "Stability" below. |
| `repoPath` | `string` | Absolute, resolved filesystem path to the repository that was analyzed (the `<path>` argument, resolved via `path.resolve`). |
| `topN` | `number` | The `--topN` value used for this run (number of top-risk files included in report detail). Parsed from the CLI flag, default `10`. |
| `report` | `string` | The full architecture report as a markdown string. See "Report field structure" below. |
| `diff.requested` | `boolean` | Whether `--diff <ref>` was passed at all. |
| `diff.scoped` | `boolean` | Whether analysis was actually restricted to a changed-file set. `false` when `--diff` wasn't passed, when `git diff` found no changed *source* files (falls back to full-repo analysis), or when `git diff` itself failed. |
| `diff.changedFileCount` | `number \| null` | Count of changed source files found by `git diff --name-only <ref> HEAD`, filtered to source extensions. `null` when `--diff` wasn't requested or when `git diff` failed; `0` when it succeeded but found no changed source files. |
| `graph.fileCount` | `number` | Count of `FileNode`s only (`graph.nodes.filter(n => n.kind === "file").length`). This is the correct number to use for "N files analyzed" — see the warning below. |
| `graph.nodeCount` | `number` | Total count of *all* nodes in the code graph (files + functions + classes combined), equal to `graph.nodes.length`. **Do not use this as a file count** — see below. |
| `graph.edgeCount` | `number` | Total count of edges in the code graph, equal to `graph.edges.length`. |
| `graph.nodes` | `GraphNode[]` | Full array of graph nodes (files, functions, classes). See "GraphNode" below. |
| `graph.edges` | `Edge[]` | Full array of graph edges (relationships between nodes). See "Edge" below. |

> **Warning — `nodeCount` is not a file count.** `graph.nodes` is a discriminated union of `FileNode`, `FunctionNode`, and `ClassNode`; `nodeCount` sums all three. An earlier version of `scripts/post-pr-comment.mjs` reported `graph.nodeCount` as "changed files" in the PR comment, which produced numbers like "345 changed files" on PRs that touched exactly one file — the real count was every function and class node in the (sometimes full-repo-fallback) graph, not files, and not scoped to the diff. Use `graph.fileCount` for a file count, and `diff.changedFileCount` for the actual diff-scoped count.

## `GraphNode`

`GraphNode` is a discriminated union on the `kind` field, defined in `src/types.ts`:

```typescript
type GraphNode = FileNode | FunctionNode | ClassNode;
```

### `FileNode` (`kind: "file"`)

| Field | Type | Description |
|---|---|---|
| `kind` | `"file"` | Discriminant. |
| `id` | `string` | Unique node id, format `file:<relative/path>`. |
| `path` | `string` | Path to the file, relative to the analyzed repo root. |
| `loc` | `number` | Line count of the file. |

### `FunctionNode` (`kind: "function"`)

| Field | Type | Description |
|---|---|---|
| `kind` | `"function"` | Discriminant. |
| `id` | `string` | Unique node id. |
| `name` | `string` | Function name. |
| `fileId` | `string` | `id` of the containing `FileNode`. |
| `startLine` | `number` | 1-based start line of the function in its file. |
| `endLine` | `number` | 1-based end line of the function in its file. |

### `ClassNode` (`kind: "class"`)

| Field | Type | Description |
|---|---|---|
| `kind` | `"class"` | Discriminant. |
| `id` | `string` | Unique node id. |
| `name` | `string` | Class name. |
| `fileId` | `string` | `id` of the containing `FileNode`. |
| `startLine` | `number` | 1-based start line of the class in its file. |
| `endLine` | `number` | 1-based end line of the class in its file. |

## `Edge`

```typescript
interface Edge {
  type: EdgeType;
  from: string;
  to: string;
  confidence: number;
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `EdgeType` | Relationship type. One of `"CONTAINS"`, `"IMPORTS"`, `"CALLS"`, `"EXPORTS"`, `"TESTED_BY"` (see below). |
| `from` | `string` | `id` of the source node. |
| `to` | `string` | `id` of the target node. |
| `confidence` | `number` | Confidence score (0–1) that this edge is correct. Static analysis of dynamic languages is imperfect; lower values indicate a heuristic/inferred edge rather than a syntactically certain one. |

### `EdgeType` values

- `CONTAINS` — a `FileNode` contains a `FunctionNode`/`ClassNode`.
- `IMPORTS` — a `FileNode` imports another `FileNode`.
- `CALLS` — a function/class calls another function.
- `EXPORTS` — a `FileNode` exports a function/class.
- `TESTED_BY` — a source node is exercised by a test file/node.

## `report` field structure

`report` is a single markdown string containing exactly 5 fixed section headings, in order:

```
## 1. System Summary
## 2. Top 5 Architectural Risks
## 3. Production Failure Scenarios
## 4. Refactor Plan (step-by-step)
## 5. Senior Engineer Verdict
```

There is currently no structured, per-section JSON representation of the report — only the assembled markdown string. A consumer that wants programmatic access to an individual section (e.g. just the System Summary) must split the string on these heading markers itself. The headings are stable text and safe to match on, e.g. with a regex like `/## \d\. [^\n]+/g` to locate section boundaries.

## Stability

This is schema **version 2**. The `version` field will be incremented whenever a field is added, removed, renamed, or changes meaning in a way that could break an existing consumer. Consumers should:

- Check `version` before parsing.
- Fail loudly (rather than silently guessing) if `version` is not a value they understand — do not assume forward or backward compatibility across versions.

## Known consumers

- `scripts/post-pr-comment.mjs` — the GitHub Action PR-comment script. Runs `archie analyze . --diff <ref> --json`, parses stdout, and reads `.report` (splitting it into sections by the fixed headings above), `.diff.scoped` / `.diff.changedFileCount`, and `.graph.fileCount` / `.graph.edgeCount` to build a PR comment body.
