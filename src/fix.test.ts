// src/fix.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRefactorSteps, runFixStep } from "./fix.js";

const SAMPLE_REPORT = `## 1. System Summary

Some summary content.

---

## 2. Top 5 Architectural Risks

### Risk 1: High coupling — \`src/core.ts\`
**Severity:** High
**Why this matters:** Stuff breaks.
**Root cause:** fanIn=14.
**Evidence:** fanIn=14

---

## 3. Production Failure Scenarios

### Scenario 1: Something bad
**Trigger:** X
**Chain of failure:** Y
**Business impact:** Z
**Likelihood:** High — because.

---

## 4. Refactor Plan (step-by-step)

### Step 1: Convert METHODOLOGY_PREAMBLE to a Function
**Why now:** Unblocks testing.
**File:** \`ai/prompts/synthesizer/preamble.ts\`
**Effort:** < 1 hour

> **Paste into Claude Code to implement this step:**
> In \`ai/prompts/synthesizer/preamble.ts\`, convert \`METHODOLOGY_PREAMBLE\` from a module-level \`const\` string into a zero-argument function called \`getMethodologyPreamble()\` that returns the same string. Update all call sites that reference \`METHODOLOGY_PREAMBLE\` to call \`getMethodologyPreamble()\` instead. This step is done when the build passes and no call site references the old constant directly.

---

### Step 2: Fix multi-paragraph step with blank quoted lines
**Why now:** Reduces risk.
**File:** \`src/metrics.ts\`
**Effort:** half day

> **Paste into Claude Code to implement this step:**
> This is the first paragraph of the instruction. It spans a little bit of
> text across multiple lines.
>
> This is a second paragraph, separated by a blank quoted line above. It
> should still be captured as part of the prompt.
>
> This step is done when \`depthOf\` no longer recurses and a regression test exists.

---

### Step 3: Step with no File line
**Why now:** Applies to multiple files.
**Effort:** 1-2 days

> **Paste into Claude Code to implement this step:**
> Update error handling across several files in \`src/\` to use a shared \`wrapError\` helper. This step is done when all call sites use the helper and tests pass.

---

### Step 4: Step with no paste blockquote at all

This step intentionally has no "Paste into Claude Code" section and should be skipped entirely.

---

## 5. Senior Engineer Verdict

Some verdict content that must not be parsed as a step.

### Step 99: This looks like a step but is in section 5
**File:** \`should/not/appear.ts\`

> **Paste into Claude Code to implement this step:**
> This must never show up in parsed steps because it's past the section 4 boundary.
`;

describe("parseRefactorSteps", () => {
  it("extracts all steps that have a paste blockquote, in order", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
    expect(steps.map((s) => s.title)).toEqual([
      "Convert METHODOLOGY_PREAMBLE to a Function",
      "Fix multi-paragraph step with blank quoted lines",
      "Step with no File line",
    ]);
  });

  it("captures the File field when present", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    expect(steps[0].file).toBe("ai/prompts/synthesizer/preamble.ts");
    expect(steps[1].file).toBe("src/metrics.ts");
  });

  it("leaves file undefined when there is no **File:** line", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    expect(steps[2].file).toBeUndefined();
  });

  it("de-quotes a single-paragraph blockquote into a clean prompt string", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    expect(steps[0].prompt).toContain("convert `METHODOLOGY_PREAMBLE` from a module-level");
    expect(steps[0].prompt).not.toMatch(/^>/m);
    expect(steps[0].prompt).toContain("This step is done when the build passes");
  });

  it("captures a multi-line, multi-paragraph blockquote including blank quoted lines, de-quoted and joined", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    const prompt = steps[1].prompt;
    expect(prompt).toContain("This is the first paragraph of the instruction.");
    expect(prompt).toContain("This is a second paragraph, separated by a blank quoted line above.");
    expect(prompt).toContain("This step is done when `depthOf` no longer recurses");
    // Blank quoted line ">" between paragraphs should produce a blank line, not disappear or break parsing.
    expect(prompt).toMatch(/paragraph, separated by a blank quoted line above\. It\s*\n\s*should still be captured/);
    expect(prompt).not.toMatch(/^>/m);
  });

  it("skips a step that has no Paste-into-Claude-Code blockquote", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    expect(steps.find((s) => s.title.includes("no paste blockquote"))).toBeUndefined();
  });

  it("stops at the section 4 -> section 5 boundary and does not parse steps beyond it", () => {
    const steps = parseRefactorSteps(SAMPLE_REPORT);
    expect(steps.find((s) => s.stepNumber === 99)).toBeUndefined();
    expect(steps.every((s) => s.file !== "should/not/appear.ts")).toBe(true);
  });

  it("returns an empty array when there is no Refactor Plan section", () => {
    const noSection = "## 1. System Summary\n\nJust some text.\n";
    expect(parseRefactorSteps(noSection)).toEqual([]);
  });

  it("returns an empty array when the Refactor Plan section has zero steps with blockquotes", () => {
    const noSteps = "## 4. Refactor Plan (step-by-step)\n\nNothing here.\n\n## 5. Senior Engineer Verdict\n";
    expect(parseRefactorSteps(noSteps)).toEqual([]);
  });

  it("handles the Refactor Plan section being the last section in the document (no trailing ## heading)", () => {
    const onlySection4 = SAMPLE_REPORT.split("## 5. Senior Engineer Verdict")[0];
    const steps = parseRefactorSteps(onlySection4);
    expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
  });
});

// Mock node:child_process's execFileSync to verify runFixStep constructs the
// right command/args without invoking any real subprocess (no real claude/
// git/npm calls in unit tests).
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

describe("runFixStep", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("invokes the claude CLI in headless print mode with the step prompt as an argument (not shell-interpolated)", async () => {
    const { execFileSync } = await import("node:child_process");
    const mockExecFileSync = vi.mocked(execFileSync);
    mockExecFileSync.mockImplementation((cmd) => {
      if (cmd === "claude") return "" as unknown as ReturnType<typeof execFileSync>;
      if (cmd === "git") return "" as unknown as ReturnType<typeof execFileSync>;
      throw new Error(`unexpected command ${cmd}`);
    });

    const step = {
      stepNumber: 1,
      title: "Example",
      file: "src/foo.ts",
      prompt: "Do the thing.",
    };

    const result = await runFixStep(step, "/tmp/some-repo", false);

    const claudeCall = mockExecFileSync.mock.calls.find((call) => call[0] === "claude");
    expect(claudeCall).toBeDefined();
    const [, args, options] = claudeCall!;
    expect(args).toContain("-p");
    expect(args).toContain(step.prompt);
    expect((options as { cwd?: string }).cwd).toBe("/tmp/some-repo");

    expect(result.buildResult).toBe("not-detected");
    expect(result.testResult).toBe("not-detected");
    expect(result.agentSucceeded).toBe(true);
  });

  it("reports agentSucceeded: false with a clear message when the claude binary is missing (ENOENT)", async () => {
    const { execFileSync } = await import("node:child_process");
    const mockExecFileSync = vi.mocked(execFileSync);
    mockExecFileSync.mockImplementation((cmd) => {
      if (cmd === "claude") {
        const err = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      if (cmd === "git") return "" as unknown as ReturnType<typeof execFileSync>;
      throw new Error(`unexpected command ${cmd}`);
    });

    const step = { stepNumber: 1, title: "Example", file: undefined, prompt: "Do the thing." };
    const result = await runFixStep(step, "/tmp/some-repo", false);

    expect(result.agentSucceeded).toBe(false);
    expect(result.agentError).toMatch(/Claude Code CLI.*not found|install/i);
  });

  it("falls back to a node --check syntax pass on changed .js files when no build/test script was detected", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const { execFileSync } = await import("node:child_process");
    const mockExecFileSync = vi.mocked(execFileSync);
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "claude") return "" as unknown as ReturnType<typeof execFileSync>;
      if (cmd === "git" && (args as string[])[0] === "diff" && (args as string[])[1] === "--name-only") {
        return "src/changed.js\n" as unknown as ReturnType<typeof execFileSync>;
      }
      if (cmd === "git") return "" as unknown as ReturnType<typeof execFileSync>;
      if (cmd === "node" && (args as string[])[0] === "--check") {
        return "" as unknown as ReturnType<typeof execFileSync>; // valid syntax
      }
      throw new Error(`unexpected command ${cmd} ${JSON.stringify(args)}`);
    });

    const step = { stepNumber: 1, title: "Example", file: "src/changed.js", prompt: "Do the thing." };
    const result = await runFixStep(step, "/tmp/some-repo", false);

    expect(result.buildResult).toBe("not-detected");
    expect(result.testResult).toBe("not-detected");
    expect(result.syntaxCheckResult).toBe("pass");

    const nodeCheckCall = mockExecFileSync.mock.calls.find(
      (call) => call[0] === "node" && (call[1] as string[])[0] === "--check"
    );
    expect(nodeCheckCall).toBeDefined();
    expect((nodeCheckCall![1] as string[])[1]).toBe("src/changed.js");
  });

  it("reports syntaxCheckResult: fail when node --check finds a syntax error", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const { execFileSync } = await import("node:child_process");
    const mockExecFileSync = vi.mocked(execFileSync);
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "claude") return "" as unknown as ReturnType<typeof execFileSync>;
      if (cmd === "git" && (args as string[])[0] === "diff" && (args as string[])[1] === "--name-only") {
        return "src/broken.js\n" as unknown as ReturnType<typeof execFileSync>;
      }
      if (cmd === "git") return "" as unknown as ReturnType<typeof execFileSync>;
      if (cmd === "node" && (args as string[])[0] === "--check") {
        throw new Error("SyntaxError: Unexpected token");
      }
      throw new Error(`unexpected command ${cmd} ${JSON.stringify(args)}`);
    });

    const step = { stepNumber: 1, title: "Example", file: "src/broken.js", prompt: "Do the thing." };
    const result = await runFixStep(step, "/tmp/some-repo", false);

    expect(result.syntaxCheckResult).toBe("fail");
  });

  it("does not run the syntax-check fallback when a real build or test script was detected", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ scripts: { build: "tsc" } }));

    const { execFileSync } = await import("node:child_process");
    const mockExecFileSync = vi.mocked(execFileSync);
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "claude") return "" as unknown as ReturnType<typeof execFileSync>;
      if (cmd === "npm") return "" as unknown as ReturnType<typeof execFileSync>; // build passes
      if (cmd === "git" && (args as string[])[0] === "diff" && (args as string[])[1] === "--name-only") {
        return "src/changed.js\n" as unknown as ReturnType<typeof execFileSync>;
      }
      if (cmd === "git") return "" as unknown as ReturnType<typeof execFileSync>;
      throw new Error(`unexpected command ${cmd} ${JSON.stringify(args)} — node --check should not run here`);
    });

    const step = { stepNumber: 1, title: "Example", file: "src/changed.js", prompt: "Do the thing." };
    const result = await runFixStep(step, "/tmp/some-repo", false);

    expect(result.buildResult).toBe("pass");
    expect(result.syntaxCheckResult).toBe("not-applicable");
  });
});
