import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePace, computeRateLimitTrends, parseSidecarLog, type RateLimitSnapshot } from "../src/analyze/rateLimitHistory.js";

function withTempLog(lines: string[], fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "cc-utility-sidecar-"));
  const path = join(dir, "sidecar-log.jsonl");
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""));
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parseSidecarLog returns an empty array when the file does not exist", () => {
  assert.deepEqual(parseSidecarLog("/nonexistent/path/sidecar-log.jsonl"), []);
});

test("parseSidecarLog skips malformed lines and blank lines without throwing", () => {
  withTempLog(
    [
      "not json at all",
      "",
      "[1,2,3]",
      JSON.stringify({ ts: "2026-06-01T00:00:00Z", session_id: "s1", five_hour_pct: 50, five_hour_reset: 1000, seven_day_pct: 10, seven_day_reset: 200000, cost_usd: 1.5 }),
    ],
    (path) => {
      const snaps = parseSidecarLog(path);
      assert.equal(snaps.length, 1);
      assert.equal(snaps[0].sessionId, "s1");
      assert.equal(snaps[0].fiveHourPct, 50);
      assert.equal(snaps[0].costUsd, 1.5);
    },
  );
});

test("parseSidecarLog only extracts known fields, unexpected extra keys never propagate", () => {
  withTempLog(
    [JSON.stringify({ ts: "2026-06-01T00:00:00Z", session_id: "s1", five_hour_pct: 50, five_hour_reset: 1000, seven_day_pct: 10, seven_day_reset: 200000, cost_usd: 1, content: "RAW_PROMPT_TEXT_SHOULD_NEVER_APPEAR" })],
    (path) => {
      const snaps = parseSidecarLog(path);
      const serialized = JSON.stringify(snaps);
      assert.ok(!serialized.includes("RAW_PROMPT_TEXT_SHOULD_NEVER_APPEAR"));
    },
  );
});

test("computePace floors elapsed at 1% to avoid divide-by-zero at window start", () => {
  const p = computePace(5, 18000, 18000);
  assert.ok(Number.isFinite(p));
});

test("computePace is ~0 when usage matches elapsed proportion (on pace)", () => {
  const p = computePace(50, 9000, 18000);
  assert.ok(Math.abs(p) < 1);
});

test("computePace is positive when burning faster than the clock, negative when slower", () => {
  const over = computePace(80, 9000, 18000);
  const under = computePace(20, 9000, 18000);
  assert.ok(over > 0);
  assert.ok(under < 0);
});

test("computeRateLimitTrends returns null for an empty snapshot list", () => {
  assert.equal(computeRateLimitTrends([]), null);
});

test("computeRateLimitTrends detects an 80% threshold crossing exactly once, not on every subsequent snapshot above it", () => {
  const snaps: RateLimitSnapshot[] = [
    { ts: "2026-06-01T00:00:00Z", sessionId: "s1", fiveHourPct: 60, fiveHourResetSec: 10000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
    { ts: "2026-06-01T01:00:00Z", sessionId: "s1", fiveHourPct: 85, fiveHourResetSec: 8000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
    { ts: "2026-06-01T02:00:00Z", sessionId: "s1", fiveHourPct: 90, fiveHourResetSec: 4000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
  ];
  const trends = computeRateLimitTrends(snaps)!;
  assert.equal(trends.thresholdCrossings.length, 1);
  assert.equal(trends.thresholdCrossings[0].pct, 85);
  assert.equal(trends.thresholdCrossings[0].window, "five_hour");
});

test("computeRateLimitTrends does not flag a crossing when the series starts already above threshold", () => {
  const snaps: RateLimitSnapshot[] = [
    { ts: "2026-06-01T00:00:00Z", sessionId: "s1", fiveHourPct: 90, fiveHourResetSec: 10000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
    { ts: "2026-06-01T01:00:00Z", sessionId: "s1", fiveHourPct: 92, fiveHourResetSec: 8000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
  ];
  const trends = computeRateLimitTrends(snaps)!;
  assert.equal(trends.thresholdCrossings.length, 0);
});

test("computeRateLimitTrends computes latest and average pace independently per window", () => {
  const snaps: RateLimitSnapshot[] = [
    { ts: "2026-06-01T00:00:00Z", sessionId: "s1", fiveHourPct: 50, fiveHourResetSec: 9000, sevenDayPct: 10, sevenDayResetSec: 500000, costUsd: 0 },
    { ts: "2026-06-01T01:00:00Z", sessionId: "s1", fiveHourPct: 80, fiveHourResetSec: 9000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
  ];
  const trends = computeRateLimitTrends(snaps)!;
  assert.equal(trends.snapshotsCounted, 2);
  assert.ok(trends.latestFiveHourPace! > 0, "second snapshot is over pace");
  assert.equal(trends.latestSevenDayPace, null, "latest seven-day pace is null when the newest snapshot has no seven-day data (pace must match latest pct)");
  assert.equal(trends.avgSevenDayPace, computePace(10, 500000, 7 * 86400), "average still carries the earlier snapshot that had seven-day data");
});

test("computeRateLimitTrends finds the busiest weekday from real timestamps", () => {
  const snaps: RateLimitSnapshot[] = [
    { ts: "2026-06-01T00:00:00Z", sessionId: "s1", fiveHourPct: 10, fiveHourResetSec: 10000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
    { ts: "2026-06-01T01:00:00Z", sessionId: "s1", fiveHourPct: 10, fiveHourResetSec: 10000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
    { ts: "2026-06-02T00:00:00Z", sessionId: "s1", fiveHourPct: 10, fiveHourResetSec: 10000, sevenDayPct: null, sevenDayResetSec: null, costUsd: 0 },
  ];
  const trends = computeRateLimitTrends(snaps)!;
  assert.equal(trends.busiestWeekday, "Mon");
});
