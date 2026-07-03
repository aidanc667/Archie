// src/fix.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface FixStep {
  stepNumber: number;
  title: string;
  file: string | undefined; // from the **File:** line, if present
  prompt: string; // the de-quoted content of the "Paste into Claude Code" blockquote
}

const SECTION_4_HEADING_RE = /^## 4\. Refactor Plan \(step-by-step\)\s*$/m;
const NEXT_HEADING_RE = /^## /m;
const STEP_HEADING_RE = /^### Step (\d+): (.+)$/;
const FILE_LINE_RE = /^\*\*File:\*\*\s*`?([^`\n]+)`?\s*$/;
const PASTE_MARKER_RE = /^>\s*\*\*Paste into Claude Code to implement this step:\*\*\s*$/;
const QUOTE_LINE_RE = /^>( ?)(.*)$/;

/**
 * Extracts the "## 4. Refactor Plan (step-by-step)" section from a report's
 * markdown (up to the next "## " heading or end of string), and returns
 * one FixStep per "### Step N: <title>" block that has a "Paste into Claude
 * Code" blockquote. Steps without such a blockquote are skipped.
 */
export function parseRefactorSteps(reportMarkdown: string): FixStep[] {
  const sectionStart = reportMarkdown.search(SECTION_4_HEADING_RE);
  if (sectionStart === -1) return [];

  const afterHeading = reportMarkdown.slice(sectionStart);
  const headingMatch = afterHeading.match(SECTION_4_HEADING_RE);
  const contentStart = headingMatch ? headingMatch.index! + headingMatch[0].length : 0;
  const rest = afterHeading.slice(contentStart);

  NEXT_HEADING_RE.lastIndex = 0;
  const nextHeadingMatch = rest.match(NEXT_HEADING_RE);
  const sectionBody = nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;

  const lines = sectionBody.split("\n");

  const steps: FixStep[] = [];
  let i = 0;
  while (i < lines.length) {
    const stepMatch = lines[i].match(STEP_HEADING_RE);
    if (!stepMatch) {
      i++;
      continue;
    }

    const stepNumber = Number.parseInt(stepMatch[1], 10);
    const title = stepMatch[2].trim();
    i++;

    let file: string | undefined;
    let promptLines: string[] | undefined;

    // Scan forward until the next "### Step" heading (or end of section body).
    while (i < lines.length && !STEP_HEADING_RE.test(lines[i])) {
      const line = lines[i];

      if (file === undefined) {
        const fileMatch = line.match(FILE_LINE_RE);
        if (fileMatch) {
          file = fileMatch[1].trim();
        }
      }

      if (promptLines === undefined && PASTE_MARKER_RE.test(line)) {
        promptLines = [];
        i++;
        while (i < lines.length) {
          const quoteMatch = lines[i].match(QUOTE_LINE_RE);
          if (!quoteMatch) break;
          promptLines.push(quoteMatch[2]);
          i++;
        }
        continue;
      }

      i++;
    }

    if (promptLines !== undefined) {
      steps.push({
        stepNumber,
        title,
        file,
        prompt: promptLines.join("\n").trim(),
      });
    }
  }

  return steps;
}

export interface FixStepResult {
  step: FixStep;
  agentSucceeded: boolean;
  agentError?: string;
  buildResult: "pass" | "fail" | "not-detected";
  testResult: "pass" | "fail" | "not-detected";
  // Only computed when both buildResult and testResult are "not-detected" —
  // a `node --check` syntax pass over changed .js/.mjs/.cjs files, so a step
  // that touched a repo with no configured build/test script still gets some
  // verification signal instead of none. Does not cover .ts/.tsx files (a
  // real type-check would need the project's own tsconfig and dependencies
  // installed, which is out of scope here) — that's a known, disclosed gap,
  // not a silent one.
  syntaxCheckResult: "pass" | "fail" | "not-applicable";
  diffStat: string; // output of `git diff --stat`, empty string if no changes
  diff: string; // output of `git diff`, empty string if no changes
}

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

function runAgent(step: FixStep, repoPath: string): { succeeded: boolean; error?: string } {
  try {
    execFileSync("claude", ["-p", "--permission-mode", "acceptEdits", step.prompt], {
      cwd: repoPath,
      encoding: "utf8",
      timeout: AGENT_TIMEOUT_MS,
    });
    return { succeeded: true };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (nodeErr.code === "ENOENT") {
      return {
        succeeded: false,
        error: "The Claude Code CLI (`claude`) was not found on PATH. Install it and ensure it's available before running `archie fix`.",
      };
    }
    const output = [nodeErr.stdout, nodeErr.stderr].filter(Boolean).join("\n").trim();
    return {
      succeeded: false,
      error: output || nodeErr.message || String(err),
    };
  }
}

function runScriptIfPresent(repoPath: string, scriptName: string): "pass" | "fail" | "not-detected" {
  const pkgPath = path.join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return "not-detected";

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return "not-detected";
  }

  if (!pkg.scripts || !pkg.scripts[scriptName]) return "not-detected";

  try {
    execFileSync("npm", ["run", scriptName], { cwd: repoPath, encoding: "utf8" });
    return "pass";
  } catch {
    return "fail";
  }
}

function gitDiff(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", ["diff", ...args], { cwd: repoPath, encoding: "utf8" });
  } catch {
    return "";
  }
}

const SYNTAX_CHECKABLE_RE = /\.(js|mjs|cjs)$/;

function checkSyntaxFallback(repoPath: string): "pass" | "fail" | "not-applicable" {
  let changedFiles: string[];
  try {
    const output = execFileSync("git", ["diff", "--name-only"], { cwd: repoPath, encoding: "utf8" });
    changedFiles = output.split("\n").map((f) => f.trim()).filter(Boolean);
  } catch {
    return "not-applicable";
  }

  const checkable = changedFiles.filter((f) => SYNTAX_CHECKABLE_RE.test(f) && existsSync(path.join(repoPath, f)));
  if (checkable.length === 0) return "not-applicable";

  for (const file of checkable) {
    try {
      execFileSync("node", ["--check", file], { cwd: repoPath, encoding: "utf8" });
    } catch {
      return "fail";
    }
  }
  return "pass";
}

export async function runFixStep(step: FixStep, repoPath: string, verbose: boolean): Promise<FixStepResult> {
  if (verbose) console.error(`[fix] running agent for step ${step.stepNumber}: ${step.title}`);

  const agentRun = runAgent(step, repoPath);

  const buildResult = runScriptIfPresent(repoPath, "build");
  const testResult = runScriptIfPresent(repoPath, "test");
  const syntaxCheckResult =
    buildResult === "not-detected" && testResult === "not-detected"
      ? checkSyntaxFallback(repoPath)
      : "not-applicable";

  const diffStat = gitDiff(repoPath, ["--stat"]);
  const diff = gitDiff(repoPath, []);

  return {
    step,
    agentSucceeded: agentRun.succeeded,
    agentError: agentRun.error,
    buildResult,
    testResult,
    syntaxCheckResult,
    diffStat,
    diff,
  };
}
