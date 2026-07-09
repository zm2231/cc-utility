import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptimizationRanking } from "../src/report/optimizationRanking.js";

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    sessionsScanned: 0,
    filesProcessed: 0,
    tokens: { totalInput: 0, totalOutput: 0, totalCacheCreation: 0, totalCacheRead: 0, cacheHitRate: 1 },
    toolCalls: {},
    fileExtensionsRead: {},
    modelMix: {},
    toolFriction: [],
    compactionRetention: { compactionsWithRatio: 0, medianRetainedFraction: 1, avgRetainedFraction: 1 },
    compaction: { totalCompactions: 0, manualCompactions: 0, autoCompactions: 0, tokensReclaimed: 0, staleContextSessions: [], staleContextThreshold: 150_000 },
    governance: { interruptCount: 0, toolResultCount: 0, toolErrorCount: 0, rejectedToolUseCount: 0, toolErrorRate: 0 },
    turnDuration: { turnsCounted: 0, medianMs: 0, p90Ms: 0, p95Ms: 0, maxMs: 0 },
    delegation: { agentToolCalls: 0, sidechainRecordCount: 0, sidechainSessionCount: 0 },
    editBlastRadius: { snapshotCount: 0, avgTrackedFilesPerSnapshot: 0, maxTrackedFilesPerSnapshot: 0, hottestFiles: {} },
    rateLimitTrends: null,
    recentWindow: null,
    ...overrides,
  } as any;
}

function baseWindow(overrides: Record<string, unknown> = {}) {
  return {
    windowDays: 30,
    daysWithData: 30,
    lastActiveDate: "2026-06-30",
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheCreation: 0,
    cacheHitRate: 1,
    toolResultCount: 0,
    toolErrorCount: 0,
    toolErrorRate: 0,
    toolFriction: [],
    compactionsWithRatio: 0,
    compactionMedianRetained: 1,
    bashShare: 0,
    ...overrides,
  };
}

test("buildOptimizationRanking returns an empty list when nothing crosses a threshold", () => {
  assert.deepEqual(buildOptimizationRanking(baseReport()), []);
});

test("buildOptimizationRanking surfaces every tool over the friction-rate gate, not just the worst one", () => {
  const report = baseReport({
    recentWindow: baseWindow({
      toolFriction: [
        { tool: "a", results: 10, errors: 8, errorRate: 0.8, lastSeenDate: "2026-06-30" },
        { tool: "b", results: 10, errors: 4, errorRate: 0.4, lastSeenDate: "2026-06-30" },
        { tool: "c", results: 10, errors: 2, errorRate: 0.2, lastSeenDate: "2026-06-30" },
      ],
    }),
  });
  const findings = buildOptimizationRanking(report);
  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes("tool-friction:a"));
  assert.ok(ids.includes("tool-friction:b"));
  assert.ok(!ids.includes("tool-friction:c"), "below the 30% gate should not appear");
});

test("buildOptimizationRanking sorts by score, worst first", () => {
  const report = baseReport({
    recentWindow: baseWindow({
      toolFriction: [{ tool: "mild", results: 10, errors: 3, errorRate: 0.3, lastSeenDate: "2026-06-30" }],
      totalInput: 100, totalCacheRead: 100, cacheHitRate: 0.5,
    }),
  });
  const findings = buildOptimizationRanking(report);
  assert.ok(findings.length >= 2);
  for (let i = 1; i < findings.length; i++) {
    assert.ok(findings[i - 1].score >= findings[i].score);
  }
});

test("low cache hit rate is gated on having real token volume in the recent window, not just a low ratio", () => {
  const zeroVolume = baseReport({ recentWindow: baseWindow({ totalInput: 0, totalCacheRead: 0, cacheHitRate: 0.1 }) });
  assert.equal(buildOptimizationRanking(zeroVolume).find((f) => f.id === "cache-hit-rate"), undefined);

  const realVolume = baseReport({ recentWindow: baseWindow({ totalInput: 1000, totalCacheRead: 100, cacheHitRate: 0.5 }) });
  assert.ok(buildOptimizationRanking(realVolume).find((f) => f.id === "cache-hit-rate"));
});

test("cache hit rate finding is silent when there is no recent window at all", () => {
  const report = baseReport({ recentWindow: null });
  assert.equal(buildOptimizationRanking(report).find((f) => f.id === "cache-hit-rate"), undefined);
});

test("compaction retention finding uses the recent window's median, gated on the recent window's compaction volume", () => {
  const tooFew = baseReport({
    compactionRetention: { compactionsWithRatio: 20, medianRetainedFraction: 0.02, avgRetainedFraction: 0.02 },
    recentWindow: baseWindow({ compactionsWithRatio: 2, compactionMedianRetained: 0.02 }),
  });
  assert.equal(buildOptimizationRanking(tooFew).find((f) => f.id === "compaction-retention"), undefined);

  const enough = baseReport({
    compactionRetention: { compactionsWithRatio: 0, medianRetainedFraction: 1, avgRetainedFraction: 1 },
    recentWindow: baseWindow({ compactionsWithRatio: 20, compactionMedianRetained: 0.02 }),
  });
  assert.ok(buildOptimizationRanking(enough).find((f) => f.id === "compaction-retention"));
});

test("bash bloat finding only fires above the 45% share gate, using the recent window's share", () => {
  const report = baseReport({ recentWindow: baseWindow({ bashShare: 0.4 }) });
  assert.equal(buildOptimizationRanking(report).find((f) => f.id === "bash-bloat"), undefined);

  const report2 = baseReport({ recentWindow: baseWindow({ bashShare: 0.5 }) });
  assert.ok(buildOptimizationRanking(report2).find((f) => f.id === "bash-bloat"));
});

test("stale-context finding carries real session IDs as evidence, not a summary count only", () => {
  const report = baseReport({
    compaction: {
      totalCompactions: 0, manualCompactions: 0, autoCompactions: 0, tokensReclaimed: 0,
      staleContextSessions: [{ sessionId: "real-session-abc", contextTokens: 200_000, compactionCount: 0, everCompacted: false }],
      staleContextThreshold: 150_000,
    },
  });
  const finding = buildOptimizationRanking(report).find((f) => f.id === "stale-context")!;
  assert.ok(finding);
  assert.equal((finding.evidence.sessions as any[])[0].sessionId, "real-session-abc");
});

test("rate-limit crossings finding reads from rateLimitTrends when present", () => {
  const report = baseReport({
    rateLimitTrends: { thresholdCrossings: [{ window: "seven_day", ts: "2026-06-01T00:00:00Z", pct: 85 }] },
  });
  const finding = buildOptimizationRanking(report).find((f) => f.id === "rate-limit-crossings");
  assert.ok(finding);
  assert.match(finding!.headline, /80%/);
});
