// src/testquality.test.ts
import { describe, it, expect } from "vitest";
import { computeTestQualitySignal } from "./testquality.js";

describe("computeTestQualitySignal", () => {
  it("counts it() calls with expect() assertions in a realistic JS/TS test file", () => {
    const source = `
      import { describe, it, expect } from "vitest";
      describe("adder", () => {
        it("adds two numbers", () => {
          expect(1 + 1).toBe(2);
        });
        it("adds negatives", () => {
          expect(-1 + -1).toBe(-2);
        });
        it("adds zero", () => {
          expect(1 + 0).toBe(1);
        });
      });
    `;
    const signal = computeTestQualitySignal(source, "ts");
    expect(signal.testCaseCount).toBe(3);
    expect(signal.hasTestAssertions).toBe(true);
  });

  it("counts test(...) calls the same as it(...) calls", () => {
    const source = `
      import { describe, test, expect } from "vitest";
      describe("adder", () => {
        test("adds two numbers", () => {
          expect(1 + 1).toBe(2);
        });
      });
    `;
    const signal = computeTestQualitySignal(source, "js");
    expect(signal.testCaseCount).toBe(1);
    expect(signal.hasTestAssertions).toBe(true);
  });

  it("does not count a variable literally named test as a test case", () => {
    const source = `
      const test = 5;
      console.log(test);
    `;
    const signal = computeTestQualitySignal(source, "ts");
    expect(signal.testCaseCount).toBe(0);
  });

  it("returns zero count and no assertions for an empty test file with no it/test calls", () => {
    const source = `
      import { describe } from "vitest";
    `;
    const signal = computeTestQualitySignal(source, "ts");
    expect(signal.testCaseCount).toBe(0);
    expect(signal.hasTestAssertions).toBe(false);
  });

  it("counts def test_foo()-style functions with assert statements in Python", () => {
    const source = `
import unittest

def test_add():
    assert 1 + 1 == 2

def test_sub():
    assert 2 - 1 == 1

def test_mul():
    assert 2 * 2 == 4

def test_div():
    assert 4 / 2 == 2
`;
    const signal = computeTestQualitySignal(source, "python");
    expect(signal.testCaseCount).toBe(4);
    expect(signal.hasTestAssertions).toBe(true);
  });

  it("detects unittest-style self.assertEqual(...) as an assertion via substring match", () => {
    const source = `
import unittest

class TestAdder(unittest.TestCase):
    def test_add(self):
        self.assertEqual(1 + 1, 2)
`;
    const signal = computeTestQualitySignal(source, "python");
    expect(signal.hasTestAssertions).toBe(true);
  });

  it("counts func TestFoo(t *testing.T) functions with t.Fatal assertions in Go", () => {
    const source = `
package foo

import "testing"

func TestAdd(t *testing.T) {
    if 1+1 != 2 {
        t.Fatal("expected 2")
    }
}

func TestSub(t *testing.T) {
    if 2-1 != 1 {
        t.Error("expected 1")
    }
}
`;
    const signal = computeTestQualitySignal(source, "go");
    expect(signal.testCaseCount).toBe(2);
    expect(signal.hasTestAssertions).toBe(true);
  });

  it("detects testify's assert.Equal(...) as an assertion in Go", () => {
    const source = `
package foo

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestAdd(t *testing.T) {
    assert.Equal(t, 2, 1+1)
}
`;
    const signal = computeTestQualitySignal(source, "go");
    expect(signal.hasTestAssertions).toBe(true);
  });

  it("fails closed for an unrecognized language", () => {
    const source = `
def test_foo
  assert_equal 2, 1 + 1
end
`;
    const signal = computeTestQualitySignal(source, "ruby");
    expect(signal).toEqual({ testCaseCount: 0, hasTestAssertions: false });
  });

  it("returns zero count and no assertions for an empty string source", () => {
    const signal = computeTestQualitySignal("", "ts");
    expect(signal.testCaseCount).toBe(0);
    expect(signal.hasTestAssertions).toBe(false);
  });
});
