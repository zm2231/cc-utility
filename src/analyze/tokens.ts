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

  if (rec.isSidechain === true) {
    state.sidechainInput += inputTokens;
    state.sidechainOutput += outputTokens;
    state.sidechainCacheRead += cacheRead;
    state.sidechainCacheCreation += cacheCreation;
  }

  if (typeof rec.cwd === "string" && rec.cwd) {
    let proj = state.projectStats.get(rec.cwd);
    if (!proj) {
      proj = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, toolCalls: 0, sessionIds: new Set() };
      state.projectStats.set(rec.cwd, proj);
    }
    proj.input += inputTokens;
    proj.output += outputTokens;
    proj.cacheRead += cacheRead;
    proj.cacheCreation += cacheCreation;
    proj.sessionIds.add(sessionId);
  }

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
    if (!state.continuationSessions.has(sessionId) && rec.isSidechain !== true) {
      state.firstTurnContext.push(cacheRead + inputTokens + cacheCreation);
    }
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
  const denom = state.totalCacheRead + state.totalInput + state.totalCacheCreation;
  return denom ? state.totalCacheRead / denom : 0;
}
