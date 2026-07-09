import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState } from "../src/analyze/state.js";
import { processTokens } from "../src/analyze/tokens.js";
import { processGovernance } from "../src/analyze/governance.js";
import { processTools, correlateToolFriction } from "../src/analyze/tools.js";
import { buildAllDailySnapshots, buildRecentWindowRollup, readHistory, toCsv, writeHistory } from "../src/analyze/historySnapshot.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "cc-utility-history-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("buildAllDailySnapshots buckets token totals by the record's own calendar day, not today", () => {
  const state = createState();
  processTokens(state, { type: "assistant", timestamp: "2026-05-01T10:00:00Z", message: { usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 } } }, "s1");
  processTokens(state, { type: "assistant", timestamp: "2026-05-02T10:00:00Z", message: { usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 50 } } }, "s1");

  const snapshots = buildAllDailySnapshots(state);
  assert.deepEqual(snapshots.map((s) => s.date), ["2026-05-01", "2026-05-02"]);
  assert.equal(snapshots[0].totalInput, 10);
  assert.equal(snapshots[1].totalInput, 100);
});

test("buildAllDailySnapshots computes real historical days from records months in the past, not just today", () => {
  const state = createState();
  processTokens(state, { type: "assistant", timestamp: "2025-01-15T00:00:00Z", message: { usage: { input_tokens: 1, output_tokens: 1 } } }, "s1");
  const snapshots = buildAllDailySnapshots(state);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].date, "2025-01-15");
});

test("buildAllDailySnapshots counts distinct sessions per day", () => {
  const state = createState();
  processTokens(state, { type: "assistant", timestamp: "2026-05-01T00:00:00Z", message: { usage: {} } }, "s1");
  processTokens(state, { type: "assistant", timestamp: "2026-05-01T01:00:00Z", message: { usage: {} } }, "s2");
  processTokens(state, { type: "assistant", timestamp: "2026-05-01T02:00:00Z", message: { usage: {} } }, "s1");
  const snapshots = buildAllDailySnapshots(state);
  assert.equal(snapshots[0].sessionsScanned, 2);
});

test("writeHistory and readHistory round-trip through a real file", () => {
  withTempDir((dir) => {
    const state = createState();
    processTokens(state, { type: "assistant", timestamp: "2026-05-01T00:00:00Z", message: { usage: { input_tokens: 5 } } }, "s1");
    const snapshots = buildAllDailySnapshots(state);
    const path = join(dir, "nested", "history.jsonl");
    writeHistory(path, snapshots);
    assert.deepEqual(readHistory(path), snapshots);
  });
});

test("readHistory returns an empty array for a missing file", () => {
  assert.deepEqual(readHistory("/nonexistent/history.jsonl"), []);
});

test("toCsv produces a header row plus one row per snapshot", () => {
  const state = createState();
  processTokens(state, { type: "assistant", timestamp: "2026-05-01T00:00:00Z", message: { usage: { input_tokens: 5 } } }, "s1");
  processTokens(state, { type: "assistant", timestamp: "2026-05-02T00:00:00Z", message: { usage: { input_tokens: 9 } } }, "s2");
  const csv = toCsv(buildAllDailySnapshots(state));
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^date,ts,sessionsScanned/);
});

test("buildRecentWindowRollup returns null when there is no data at all", () => {
  assert.equal(buildRecentWindowRollup(createState()), null);
});

test("buildRecentWindowRollup excludes days outside the window, anchored to the latest date in the data", () => {
  const state = createState();
  processTokens(state, { type: "assistant", timestamp: "2026-01-01T00:00:00Z", message: { usage: { input_tokens: 999 } } }, "old");
  processTokens(state, { type: "assistant", timestamp: "2026-06-30T00:00:00Z", message: { usage: { input_tokens: 7 } } }, "recent");
  const rollup = buildRecentWindowRollup(state, 30)!;
  assert.equal(rollup.totalInput, 7, "the January record is outside a 30-day window ending on the latest date");
  assert.equal(rollup.lastActiveDate, "2026-06-30");
});

test("buildRecentWindowRollup surfaces per-tool friction still happening recently, distinct from lifetime totals", () => {
  const state = createState();
  for (const id of ["t1", "t2", "t3"]) {
    processTools(state, {
      type: "assistant",
      timestamp: "2026-06-30T00:00:00Z",
      message: { content: [{ type: "tool_use", id, name: "Bash" }] },
    }, "s1");
    processGovernance(state, {
      type: "user",
      timestamp: "2026-06-30T00:01:00Z",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: "boom" }] },
    }, "s1");
  }
  correlateToolFriction(state);

  const rollup = buildRecentWindowRollup(state, 30)!;
  const bash = rollup.toolFriction.find((f) => f.tool === "Bash");
  assert.ok(bash);
  assert.equal(bash!.errorRate, 1);
  assert.equal(bash!.lastSeenDate, "2026-06-30");
});
