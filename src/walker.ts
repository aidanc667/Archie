// src/walker.ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ignorePkg from "ignore";
import type { Ignore } from "ignore";

const ignore = ignorePkg as unknown as (options?: unknown) => Ignore;

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
const ALWAYS_EXCLUDED = new Set(["node_modules", ".git"]);

async function loadIgnore(root: string): Promise<Ignore> {
  const ig = ignore();
  try {
    const content = await readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(content);
  } catch {
    // no .gitignore present — nothing to add
  }
  return ig;
}

export async function walkRepo(root: string): Promise<string[]> {
  const ig = await loadIgnore(root);
  const results: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath);

      if (entry.isDirectory()) {
        if (ALWAYS_EXCLUDED.has(entry.name)) continue;
        if (ig.ignores(relPath)) continue;
        await visit(fullPath);
      } else if (entry.isFile()) {
        if (ig.ignores(relPath)) continue;
        if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    }
  }

  await visit(root);
  return results;
}
