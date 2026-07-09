import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNum } from "../src/analyze/state.js";

test("safeNum passes through finite numbers", () => {
  assert.equal(safeNum(5), 5);
  assert.equal(safeNum(0), 0);
  assert.equal(safeNum(-3.5), -3.5);
});

test("safeNum coerces non-numeric/invalid values to 0", () => {
  assert.equal(safeNum("abc"), 0);
  assert.equal(safeNum(null), 0);
  assert.equal(safeNum(undefined), 0);
  assert.equal(safeNum(true), 0);
  assert.equal(safeNum(NaN), 0);
  assert.equal(safeNum(Infinity), 0);
  assert.equal(safeNum({}), 0);
  assert.equal(safeNum([1, 2]), 0);
});
