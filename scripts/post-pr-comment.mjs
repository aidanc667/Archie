#!/usr/bin/env node
// scripts/post-pr-comment.mjs
//
// Posts (or updates) a single PR comment with the ARCHIE architecture review.
// Standalone ESM script — not part of the TypeScript build. Uses Node's native
// fetch, no extra dependencies.
//
// Usage: node scripts/post-pr-comment.mjs <path-to-archie-json-output>
// Required env vars: GITHUB_TOKEN, REPO (owner/name), PR_NUMBER

import { readFile } from "node:fs/promises";

const MARKER = "<!-- archie-pr-review -->";

const SECTION_HEADING_RE = /## \d\. [^\n]+/g;

function splitSections(report) {
  const headings = [...report.matchAll(SECTION_HEADING_RE)];
  const sections = {};
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i][0];
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index : report.length;
    sections[heading] = report.slice(start, end).trim();
  }
  return sections;
}

function findSection(sections, prefix) {
  const key = Object.keys(sections).find((heading) => heading.startsWith(prefix));
  return key ? sections[key] : undefined;
}

function formatCommentBody(data) {
  const { report, graph } = data;
  const sections = splitSections(report);

  const systemSummary = findSection(sections, "## 1.") ?? "_System summary not available._";
  const restSections = ["## 2.", "## 3.", "## 4.", "## 5."]
    .map((prefix) => findSection(sections, prefix))
    .filter((section) => section !== undefined);

  const lines = [];
  lines.push(MARKER);
  lines.push("## Archie Architecture Review");
  lines.push("");
  lines.push(systemSummary);
  lines.push("");
  lines.push(`_Analyzed ${graph.nodeCount} changed files, ${graph.edgeCount} dependency edges._`);
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Full architecture review</summary>");
  lines.push("");
  lines.push(restSections.join("\n\n"));
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function githubRequest(url, options, token) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const bodyText = await res.text();
    console.error(`GitHub API request failed: ${options.method ?? "GET"} ${url} -> ${res.status}`);
    console.error(bodyText);
    process.exit(1);
  }
  return res.json();
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    throw new Error("Usage: node scripts/post-pr-comment.mjs <path-to-archie-json-output>");
  }

  const token = getRequiredEnv("GITHUB_TOKEN");
  const repo = getRequiredEnv("REPO");
  const prNumber = getRequiredEnv("PR_NUMBER");

  const raw = await readFile(jsonPath, "utf8");
  const data = JSON.parse(raw);

  const body = formatCommentBody(data);

  const commentsUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  const comments = await githubRequest(commentsUrl, { method: "GET" }, token);

  const existing = comments.find((comment) => comment.body?.includes(MARKER));

  if (existing) {
    const updateUrl = `https://api.github.com/repos/${repo}/issues/comments/${existing.id}`;
    await githubRequest(updateUrl, { method: "PATCH", body: JSON.stringify({ body }) }, token);
    console.log(`Updated existing Archie review comment (id ${existing.id}).`);
  } else {
    const createUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
    const created = await githubRequest(createUrl, { method: "POST", body: JSON.stringify({ body }) }, token);
    console.log(`Created new Archie review comment (id ${created.id}).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
