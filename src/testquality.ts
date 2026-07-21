// src/testquality.ts

export interface TestQualitySignal {
  testCaseCount: number;
  hasTestAssertions: boolean;
}

// JS/TS test-case calls: `it(` or `test(`, requiring the immediate `(` so a
// plain identifier like `const test = 5;` doesn't get miscounted as a case.
const JS_TEST_CASE_RE = /\b(?:it|test)\s*\(/g;
const JS_ASSERTION_RE = /\b(?:expect|assert)\s*\(/;

// Python test functions follow the `def test_foo(...)` pytest/unittest
// convention; `^\s*` anchors each match to its own line via the `m` flag.
const PYTHON_TEST_CASE_RE = /^\s*def\s+test_\w+/gm;
// Leading \b only (no trailing \b) so this substring-matches inside
// `self.assertEqual(...)` too, not just bare `assert` statements -- a
// trailing \b would fail here since "t" and "E" in "assertEqual" are both
// word characters with no boundary between them, which would otherwise miss
// unittest's assertX methods entirely.
const PYTHON_ASSERTION_RE = /\bassert/;

// Go test functions follow the standard `func TestFoo(t *testing.T) {` shape.
const GO_TEST_CASE_RE = /^func\s+Test\w+\s*\(/gm;
// Standard-library assertions call t.Error/t.Fatal/t.Fail; testify-style
// assertions call assert.X(...) or require.X(...) -- checked as an
// alternative so testify doesn't need to be a real dependency to detect.
const GO_STDLIB_ASSERTION_RE = /\bt\.(?:Error|Fatal|Fail)\b/;
const GO_TESTIFY_ASSERTION_RE = /\b(?:assert|require)\.\w+\(/;

export function computeTestQualitySignal(testSource: string, language: string): TestQualitySignal {
  switch (language) {
    case "ts":
    case "js": {
      const matches = testSource.match(JS_TEST_CASE_RE);
      return {
        testCaseCount: matches ? matches.length : 0,
        hasTestAssertions: JS_ASSERTION_RE.test(testSource),
      };
    }
    case "python": {
      const matches = testSource.match(PYTHON_TEST_CASE_RE);
      return {
        testCaseCount: matches ? matches.length : 0,
        hasTestAssertions: PYTHON_ASSERTION_RE.test(testSource),
      };
    }
    case "go": {
      const matches = testSource.match(GO_TEST_CASE_RE);
      return {
        testCaseCount: matches ? matches.length : 0,
        hasTestAssertions: GO_STDLIB_ASSERTION_RE.test(testSource) || GO_TESTIFY_ASSERTION_RE.test(testSource),
      };
    }
    default:
      // Unrecognized language -- fail closed rather than guessing at syntax
      // we don't actually know, since a wrong regex could report false
      // confidence about a test file's substance.
      return { testCaseCount: 0, hasTestAssertions: false };
  }
}
