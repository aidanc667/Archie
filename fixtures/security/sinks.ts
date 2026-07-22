// fixtures/security/sinks.ts
import { execSync, execFileSync } from "node:child_process";

export function runLiteralEval(): unknown {
  return eval("some code");
}

export function runDynamicEval(userInput: string): unknown {
  return eval(userInput);
}

export function makeDynamicFunction(): () => number {
  return new Function("return 1") as () => number;
}

export function runLiteralExecSync(): Buffer {
  return execSync("git status");
}

export function runDynamicExecSync(dir: string): Buffer {
  return execSync(`rm -rf ${dir}`);
}

// eval("this text must never be flagged -- it's inside a comment, not code")
export function runExecFileSync(): Buffer {
  return execFileSync("git", ["diff"]);
}

// RegExp.prototype.exec() is unrelated to child_process -- it shares only
// the method name "exec" with the real shell-execution sink, and must never
// be flagged just because a member expression's property is named "exec".
export function findModuleName(raw: string): RegExpExecArray | null {
  return /^module\s+(\S+)/m.exec(raw);
}
