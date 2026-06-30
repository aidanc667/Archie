// src/walker.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { walkRepo } from "./walker.js";

describe("walkRepo", () => {
  it("finds .ts and .js files, excludes node_modules and .gitignore entries", async () => {
    const root = path.resolve("fixtures/walker-basic");
    const files = await walkRepo(root);
    const relative = files.map((f) => path.relative(root, f)).sort();

    expect(relative).toEqual(["src/a.ts", "src/b.js"]);
  });
});
