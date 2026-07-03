// src/cli.test.ts
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runPipeline } from "./index.js";
import type { ArchieJsonOutput } from "./cli.js";

const execFileAsync = promisify(execFile);

describe("runPipeline", () => {
  it("throws a clear error when the path does not exist", async () => {
    await expect(
      runPipeline({ repoPath: "/nonexistent/path/xyz", topN: 5, maxTokens: 50000, generatePdf: false })
    ).rejects.toThrow(/does not exist/);
  });

  it("throws a clear error when no parseable files are found", async () => {
    const emptyDir = path.resolve("fixtures/empty-repo");
    await expect(
      runPipeline({ repoPath: emptyDir, topN: 5, maxTokens: 50000, generatePdf: false })
    ).rejects.toThrow(/No parseable/);
  });
});

describe("archie fix (CLI integration)", () => {
  it("shows the fix command and its flags in help output", async () => {
    const cliPath = path.resolve("dist/cli.js");
    const { stdout } = await execFileAsync("node", [cliPath, "--help"]);
    expect(stdout).toContain("fix");
  });

  it("shows the --report flag in `fix --help` output", async () => {
    const cliPath = path.resolve("dist/cli.js");
    const { stdout } = await execFileAsync("node", [cliPath, "fix", "--help"]);
    expect(stdout).toContain("--report");
    expect(stdout).toContain("--verbose");
  });

  describe("with a clean, isolated git repo fixture", () => {
    let cleanRepoDir: string;

    beforeAll(() => {
      // Use an isolated temp git repo (not fixtures/parser-basic, which lives
      // inside this repo's own working tree and would trip the dirty-tree
      // check depending on the outer repo's current git status).
      cleanRepoDir = mkdtempSync(path.join(tmpdir(), "archie-fix-cli-test-"));
      execFileSync("git", ["init"], { cwd: cleanRepoDir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: cleanRepoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: cleanRepoDir });
      execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: cleanRepoDir });
    });

    afterAll(() => {
      rmSync(cleanRepoDir, { recursive: true, force: true });
    });

    it("exits non-zero with a clear message when --report points to a non-existent file", async () => {
      const cliPath = path.resolve("dist/cli.js");
      const nonexistentReport = path.join(cleanRepoDir, "does-not-exist-report.md");

      await expect(
        execFileAsync("node", [cliPath, "fix", cleanRepoDir, "--report", nonexistentReport])
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("report file not found"),
      });
    });

    it("does not treat an untracked .archie-cache/ directory as a dirty working tree", async () => {
      const cliPath = path.resolve("dist/cli.js");
      const cacheDir = path.join(cleanRepoDir, ".archie-cache");
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(path.join(cacheDir, "history.json"), "{}", "utf8");

      const nonexistentReport = path.join(cleanRepoDir, "does-not-exist-report.md");

      // If the dirty-tree check still refused, the error would mention
      // "dirty working tree" instead of getting past it to the report check.
      await expect(
        execFileAsync("node", [cliPath, "fix", cleanRepoDir, "--report", nonexistentReport])
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("report file not found"),
      });

      rmSync(cacheDir, { recursive: true, force: true });
    });
  });
});

// `cli.ts` has top-level `program.parse()` side effects and doesn't export its
// action handler, so it can't be invoked in-process the way `runPipeline` is
// above. A real subprocess `archie analyze --json` run (see cli-pdf.test.ts
// for the subprocess pattern) needs a live ANTHROPIC_API_KEY, which isn't
// available in this test environment. Instead, this test mocks the Anthropic
// SDK (same pattern as index.test.ts), runs the real pipeline, and builds the
// JSON output object exactly as cli.ts's `--json` branch does — verifying the
// `ArchieJsonOutput` shape stays JSON-serializable and carries the expected
// top-level keys.
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockImplementation(({ system, tools }: { system: string; tools?: unknown[] }) => {
          if (system.includes("Staff Engineer") && tools && tools.length > 0) {
            return Promise.resolve({
              content: [
                {
                  type: "tool_use",
                  id: "tu_1",
                  name: "report_risks",
                  input: {
                    risks: [
                      {
                        title: "High coupling",
                        file: "src/core.ts",
                        severity: "High",
                        confidence: "high",
                        why_it_matters: "Cascading failures.",
                        root_cause: "fanIn=14 means many files import this module directly.",
                        evidence: "fanIn=14",
                      },
                    ],
                  },
                },
              ],
              usage: { input_tokens: 100, output_tokens: 50 },
            });
          }
          if (system.includes("Staff Engineer")) {
            return Promise.resolve({
              content: [
                {
                  type: "text",
                  text: [
                    "## 1. System Summary\nsome content",
                    "## 3. Production Failure Scenarios\nsome content",
                    "## 4. Refactor Plan (step-by-step)\nsome content",
                    "## 5. Senior Engineer Verdict\nsome content",
                  ].join("\n\n"),
                },
              ],
              usage: { input_tokens: 200, output_tokens: 150 },
            });
          }
          return Promise.resolve({
            content: [{ type: "text", text: "unused" }],
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        }),
      },
    })),
  };
});

describe("archie analyze --json output shape", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it("produces a JSON-serializable ArchieJsonOutput with the documented top-level keys", async () => {
    const repoPath = path.resolve("fixtures/parser-basic");
    const topN = 5;
    const { report, graph } = await runPipeline({ repoPath, topN, maxTokens: 50000, generatePdf: false });

    // Mirrors the `output` construction in the `--json` branch of src/cli.ts.
    const output: ArchieJsonOutput = {
      version: 1,
      repoPath,
      topN,
      report,
      graph: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        nodes: graph.nodes,
        edges: graph.edges,
      },
    };

    const parsed = JSON.parse(JSON.stringify(output));
    expect(parsed.version).toBe(1);
    expect(parsed).toHaveProperty("repoPath");
    expect(parsed).toHaveProperty("topN");
    expect(parsed).toHaveProperty("report");
    expect(parsed).toHaveProperty("graph");
    expect(parsed.graph.nodeCount).toBe(graph.nodes.length);
    expect(parsed.graph.edgeCount).toBe(graph.edges.length);
    expect(Array.isArray(parsed.graph.nodes)).toBe(true);
    expect(Array.isArray(parsed.graph.edges)).toBe(true);
  });
});
