import { test } from "node:test";
import assert from "node:assert/strict";
import { createState } from "../src/analyze/state.js";
import { processTokens } from "../src/analyze/tokens.js";
import { processCompaction, findStaleContextSessions } from "../src/analyze/compaction.js";

test("processTokens uses the explicitly threaded sessionId, not the raw record field", () => {
  const state = createState();
  processTokens(
    state,
    { type: "assistant", sessionId: { weird: "object" } as unknown as string, message: { model: "m", usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 3 } } },
    "resolved-key",
  );
  assert.equal(state.sessionsSeenForFirstTurn.has("resolved-key"), true);
  assert.equal(state.sessionContext.get("resolved-key")?.latestContext, 8);
});

test("processCompaction coerces non-numeric/non-string fields safely", () => {
  const state = createState();
  processCompaction(
    state,
    { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: 123 as unknown as string, preTokens: "lots" as unknown as number, postTokens: null as unknown as number } },
    "s1",
  );
  const ctx = state.sessionContext.get("s1")!;
  assert.equal(ctx.compactionCount, 1);
  assert.equal(ctx.manualCompactions, 0);
  assert.equal(ctx.autoCompactions, 0);
  assert.equal(ctx.tokensReclaimed, 0);
});

test("stale-context detection credits sessions with recent compaction, flags those without", () => {
  const state = createState();
  processTokens(state, { type: "assistant", message: { usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 200_000 } } }, "compacted-session");
  processCompaction(state, { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "manual", preTokens: 900_000, postTokens: 190_000 } }, "compacted-session");
  processTokens(state, { type: "assistant", message: { usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 200_000 } } }, "stale-session");

  const stale = findStaleContextSessions(state, 150_000);
  const sessionIds = stale.map((s) => s.sessionId);
  assert.ok(!sessionIds.includes("compacted-session"), "recently compacted session should not be flagged (growth since compaction is small)");
  assert.ok(sessionIds.includes("stale-session"), "never-compacted session over threshold should be flagged");
});
