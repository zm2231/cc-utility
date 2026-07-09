import type { SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, dateKeyOf, getDayBucket, getSessionContext, safeNum } from "./state.js";

export function processCompaction(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "system" || rec.subtype !== "compact_boundary") return;

  const meta = rec.compactMetadata ?? {};
  const pre = safeNum(meta.preTokens);
  const post = safeNum(meta.postTokens);
  const trigger = typeof meta.trigger === "string" ? meta.trigger : "unknown";

  const ctx = getSessionContext(state, sessionId);
  ctx.compactionCount += 1;
  if (trigger === "manual") ctx.manualCompactions += 1;
  else if (trigger === "auto") ctx.autoCompactions += 1;
  ctx.tokensReclaimed += Math.max(0, pre - post);
  ctx.lastCompactionPostTokens = post;

  if (pre > 0) {
    state.compactionRatios.push(post / pre);
    const dateKey = dateKeyOf(rec.timestamp);
    if (dateKey) {
      const bucket = getDayBucket(state, dateKey);
      bucket.compactionRatios.push(post / pre);
      bucket.sessionIds.add(sessionId);
    }
  }
}

export interface StaleSession {
  sessionId: string;
  contextTokens: number;
  compactionCount: number;
  everCompacted: boolean;
}

const STALE_RECENCY_MS = 7 * 86_400_000;

export function findStaleContextSessions(state: AnalysisState, threshold: number, now = Date.now()): StaleSession[] {
  const out: StaleSession[] = [];
  for (const [sessionId, ctx] of state.sessionContext.entries()) {
    if (ctx.lastActivityTs && now - ctx.lastActivityTs > STALE_RECENCY_MS) continue;
    const growthSinceCompaction = ctx.lastCompactionPostTokens === null
      ? ctx.latestContext
      : ctx.latestContext - ctx.lastCompactionPostTokens;
    if (growthSinceCompaction > threshold) {
      out.push({
        sessionId,
        contextTokens: ctx.latestContext,
        compactionCount: ctx.compactionCount,
        everCompacted: ctx.compactionCount > 0,
      });
    }
  }
  return out.sort((a, b) => b.contextTokens - a.contextTokens);
}
