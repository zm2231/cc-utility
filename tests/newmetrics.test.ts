import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, percentile } from "../src/analyze/state.js";
import { processTurnDuration } from "../src/analyze/turns.js";
import { processAwayWork } from "../src/analyze/away.js";
import { processQueueOperation } from "../src/analyze/queue.js";
import { processFileHistorySnapshot } from "../src/analyze/filehistory.js";
import { trackSidechain } from "../src/analyze/sidechain.js";
import { processTools, correlateToolFriction } from "../src/analyze/tools.js";
import { processGovernance } from "../src/analyze/governance.js";
import { processCompaction } from "../src/analyze/compaction.js";

test("percentile handles empty and single-element arrays", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([42], 0.9), 42);
});

test("percentile computes median/p90 correctly on a sorted-input-independent array", () => {
  const values = [10, 30, 20, 50, 40];
  assert.equal(percentile(values, 0.5), 30);
  assert.equal(percentile(values, 0.9), 50);
});

test("percentile uses nearest-rank, not the max, for round fractions on larger samples", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(values, 0.9), 9, "p90 of 10 values is the 9th value, not the max");
  assert.equal(percentile(values, 0.95), 10);
  assert.equal(percentile(values, 1), 10);
});

test("processTurnDuration only accepts system/turn_duration with a finite durationMs", () => {
  const state = createState();
  processTurnDuration(state, { type: "system", subtype: "turn_duration", durationMs: 5000 }, "s1");
  processTurnDuration(state, { type: "system", subtype: "turn_duration", durationMs: NaN as unknown as number }, "s1");
  processTurnDuration(state, { type: "assistant", subtype: "turn_duration", durationMs: 9999 }, "s1");
  assert.deepEqual(state.turnDurationsMs, [5000]);
});

test("processAwayWork counts away_summary and scheduled_task_fire separately", () => {
  const state = createState();
  processAwayWork(state, { type: "system", subtype: "away_summary" });
  processAwayWork(state, { type: "system", subtype: "away_summary" });
  processAwayWork(state, { type: "system", subtype: "scheduled_task_fire" });
  processAwayWork(state, { type: "system", subtype: "compact_boundary" });
  assert.equal(state.awaySummaryCount, 2);
  assert.equal(state.scheduledTaskFireCount, 1);
});

test("processQueueOperation counts by operation and never reads content", () => {
  const state = createState();
  processQueueOperation(state, { type: "queue-operation", operation: "enqueue", content: "SENSITIVE RAW TEXT" }, "s1");
  processQueueOperation(state, { type: "queue-operation", operation: "dequeue" }, "s1");
  processQueueOperation(state, { type: "queue-operation", operation: "enqueue" }, "s1");
  assert.equal(state.queueOpCounts.get("enqueue"), 2);
  assert.equal(state.queueOpCounts.get("dequeue"), 1);
  const serialized = JSON.stringify(Object.fromEntries(state.queueOpCounts));
  assert.ok(!serialized.includes("SENSITIVE"));
});

test("processFileHistorySnapshot counts tracked files and hot paths", () => {
  const state = createState();
  processFileHistorySnapshot(state, {
    type: "file-history-snapshot",
    snapshot: { trackedFileBackups: { "a.ts": {}, "b.ts": {} } },
  });
  processFileHistorySnapshot(state, {
    type: "file-history-snapshot",
    snapshot: { trackedFileBackups: { "a.ts": {} } },
  });
  assert.equal(state.snapshotCount, 2);
  assert.deepEqual(state.snapshotTrackedFileCounts, [2, 1]);
  assert.equal(state.fileTouchCounts.get("a.ts"), 2);
  assert.equal(state.fileTouchCounts.get("b.ts"), 1);
});

test("trackSidechain only counts isSidechain:true records, keyed by sessionId", () => {
  const state = createState();
  trackSidechain(state, { isSidechain: true, sessionId: "s1" });
  trackSidechain(state, { isSidechain: true, sessionId: "s1" });
  trackSidechain(state, { isSidechain: true, sessionId: "s2" });
  trackSidechain(state, { isSidechain: false, sessionId: "s3" });
  trackSidechain(state, {});
  assert.equal(state.sidechainRecordCount, 3);
  assert.equal(state.sidechainSessionIds.size, 2);
});

test("ScheduleWakeup tool_use captures delaySeconds", () => {
  const state = createState();
  processTools(state, {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "ScheduleWakeup", input: { delaySeconds: 1800 } },
        { type: "tool_use", id: "t2", name: "ScheduleWakeup", input: { delaySeconds: "not a number" } },
      ],
    },
  }, "s1");
  assert.deepEqual(state.scheduleWakeupDelays, [1800]);
});

test("correlateToolFriction joins tool_use id to tool_result errors across the two-phase pipeline", () => {
  const state = createState();
  processTools(state, {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "call-1", name: "Bash" },
        { type: "tool_use", id: "call-2", name: "Read" },
      ],
    },
  }, "s1");
  processGovernance(state, {
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "call-1", is_error: true, content: "boom" },
        { type: "tool_result", tool_use_id: "call-2", is_error: false, content: "ok" },
        { type: "tool_result", tool_use_id: "unknown-call", is_error: true, content: "boom2" },
      ],
    },
  }, "s1");
  correlateToolFriction(state);
  assert.equal(state.toolResultCountByTool.get("Bash"), 1);
  assert.equal(state.toolErrorCountByTool.get("Bash"), 1);
  assert.equal(state.toolResultCountByTool.get("Read"), 1);
  assert.equal(state.toolErrorCountByTool.get("Read"), undefined);
  assert.equal(state.toolResultCountByTool.get("unknown"), 1);
  assert.equal(state.toolErrorCountByTool.get("unknown"), 1);
});

test("correlateToolFriction does not misattribute results when tool_use_id collides across sessions", () => {
  const state = createState();
  processTools(state, {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "dup", name: "Bash" }] },
  }, "session-1");
  processTools(state, {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "dup", name: "Read" }] },
  }, "session-2");
  processGovernance(state, {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "dup", is_error: true, content: "boom" }] },
  }, "session-1");
  processGovernance(state, {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "dup", is_error: false, content: "ok" }] },
  }, "session-2");
  correlateToolFriction(state);
  assert.equal(state.toolResultCountByTool.get("Bash"), 1);
  assert.equal(state.toolErrorCountByTool.get("Bash"), 1);
  assert.equal(state.toolResultCountByTool.get("Read"), 1);
  assert.equal(state.toolErrorCountByTool.get("Read"), undefined);
});

test("processCompaction records a retention ratio only when preTokens is positive", () => {
  const state = createState();
  processCompaction(state, { type: "system", subtype: "compact_boundary", compactMetadata: { preTokens: 400_000, postTokens: 20_000 } }, "s1");
  processCompaction(state, { type: "system", subtype: "compact_boundary", compactMetadata: { preTokens: 0, postTokens: 0 } }, "s2");
  assert.deepEqual(state.compactionRatios, [0.05]);
});
