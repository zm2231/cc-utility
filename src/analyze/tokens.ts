import type { SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bump, dateKeyOf, getDayBucket, getSessionContext, safeNum } from "./state.js";

export function processTokens(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "assistant") return;
  const msg = rec.message;
  if (!msg) return;

  const model = typeof msg.model === "string" && msg.model ? msg.model : "unknown";
  bump(state.modelTurns, model);

  const usage = msg.usage ?? {};
  const inputTokens = safeNum(usage.input_tokens);
  const outputTokens = safeNum(usage.output_tokens);
  const cacheCreation = safeNum(usage.cache_creation_input_tokens);
  const cacheRead = safeNum(usage.cache_read_input_tokens);

  state.totalInput += inputTokens;
  state.totalOutput += outputTokens;
  state.totalCacheCreation += cacheCreation;
  state.totalCacheRead += cacheRead;

  if (rec.timestamp) {
    const dt = new Date(rec.timestamp);
    if (!Number.isNaN(dt.getTime())) {
      const monthKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
      const entry = state.cacheByMonth.get(monthKey) ?? [0, 0];
      entry[0] += cacheRead;
      entry[1] += cacheRead + inputTokens;
      state.cacheByMonth.set(monthKey, entry);
    }
  }

  if (!state.sessionsSeenForFirstTurn.has(sessionId)) {
    state.sessionsSeenForFirstTurn.add(sessionId);
    state.firstTurnCacheRead.push(cacheRead);
  }

  const ctx = getSessionContext(state, sessionId);
  ctx.latestContext = cacheRead + inputTokens;

  const dateKey = dateKeyOf(rec.timestamp);
  if (dateKey) {
    const bucket = getDayBucket(state, dateKey);
    bucket.totalInput += inputTokens;
    bucket.totalOutput += outputTokens;
    bucket.totalCacheRead += cacheRead;
    bucket.totalCacheCreation += cacheCreation;
    bucket.sessionIds.add(sessionId);
  }
}

export function overallCacheHitRate(state: AnalysisState): number {
  const denom = state.totalCacheRead + state.totalInput;
  return denom ? state.totalCacheRead / denom : 0;
}
