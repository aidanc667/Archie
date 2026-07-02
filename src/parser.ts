// src/parser.ts
import path from "node:path";
import { readFile } from "node:fs/promises";
import Parser from "web-tree-sitter";

export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
}

export interface ParsedClass {
  name: string;
  startLine: number;
  endLine: number;
}

export interface ParsedFile {
  functions: ParsedFunction[];
  classes: ParsedClass[];
  imports: string[];
}

let initialized = false;
let tsLanguage: Parser.Language | undefined;
let jsLanguage: Parser.Language | undefined;
let pyLanguage: Parser.Language | undefined;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  const grammarsDir = path.resolve("grammars");
  tsLanguage = await Parser.Language.load(
    path.join(grammarsDir, "tree-sitter-typescript.wasm")
  );
  jsLanguage = await Parser.Language.load(
    path.join(grammarsDir, "tree-sitter-javascript.wasm")
  );
  pyLanguage = await Parser.Language.load(
    path.join(grammarsDir, "tree-sitter-python.wasm")
  );
  initialized = true;
}

function languageFor(filePath: string): Parser.Language {
  const ext = path.extname(filePath);
  if (ext === ".ts" || ext === ".tsx") return tsLanguage!;
  if (ext === ".py") return pyLanguage!;
  return jsLanguage!;
}

function walkTree(
  node: Parser.SyntaxNode,
  visit: (node: Parser.SyntaxNode) => void
): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkTree(child, visit);
  }
}

function pythonRelativeToPath(moduleText: string): string | undefined {
  let i = 0;
  while (i < moduleText.length && moduleText[i] === ".") i++;
  const dots = i;
  const remainder = moduleText.slice(dots);
  if (!remainder) return undefined;
  const prefix = dots === 1 ? "./" : "../".repeat(dots - 1);
  return prefix + remainder.replace(/\./g, "/");
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  await ensureInitialized();
  const source = await readFile(filePath, "utf8");

  const parser = new Parser();
  parser.setLanguage(languageFor(filePath));
  const tree = parser.parse(source);

  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const imports: string[] = [];

  const isPython = path.extname(filePath) === ".py";

  walkTree(tree.rootNode, (node) => {
    if (node.type === "function_declaration" || node.type === "function_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        functions.push({
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    } else if (node.type === "class_declaration" || node.type === "class_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        classes.push({
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    } else if (!isPython && node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        imports.push(sourceNode.text.slice(1, -1));
      }
    } else if (isPython && node.type === "import_statement") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === "dotted_name") {
          imports.push(child.text);
        }
      }
    } else if (!isPython && node.type === "variable_declarator") {
      const valueNode = node.childForFieldName("value");
      if (valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functions.push({
            name: nameNode.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
      }
    } else if (!isPython && node.type === "method_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode && nameNode.text !== "constructor") {
        functions.push({
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    } else if (isPython && node.type === "import_from_statement") {
      const moduleNode = node.childForFieldName("module_name");
      if (moduleNode) {
        const text = moduleNode.text;
        if (text.startsWith(".")) {
          const resolved = pythonRelativeToPath(text);
          if (resolved) imports.push(resolved);
        }
      }
    }
  });

  return { functions, classes, imports };
}

const BRANCH_NODE_TYPES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "case_clause",
  "catch_clause",
  "ternary_expression",
  "elif_clause",
  "with_statement",
  "except_clause",
  "conditional_expression",
  "boolean_operator",
]);

export async function computeComplexity(filePath: string): Promise<number> {
  await ensureInitialized();
  const source = await readFile(filePath, "utf8");

  const parser = new Parser();
  parser.setLanguage(languageFor(filePath));
  const tree = parser.parse(source);

  let complexity = 1; // base complexity

  walkTree(tree.rootNode, (node) => {
    if (node.type === "binary_expression") {
      const operator = node.children.find(
        (c) => c.type === "&&" || c.type === "||"
      );
      if (operator) complexity += 1;
    } else if (BRANCH_NODE_TYPES.has(node.type)) {
      complexity += 1;
    }
  });
  return complexity;
}
