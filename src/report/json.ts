import type { AnalysisState } from "../analyze/state.js";
import { overallCacheHitRate } from "../analyze/tokens.js";
import { topN, percentile } from "../analyze/state.js";
import { findStaleContextSessions } from "../analyze/compaction.js";
import type { QuotaUsage } from "../quota/official.js";
import type { RateLimitTrends } from "../analyze/rateLimitHistory.js";
import { buildRecentWindowRollup } from "../analyze/historySnapshot.js";

const STALE_CONTEXT_THRESHOLD = 150_000;
const MIN_TOOL_RESULTS_FOR_FRICTION = 5;

function buildToolFriction(state: AnalysisState): Array<{ tool: string; results: number; errors: number; errorRate: number }> {
  const rows: Array<{ tool: string; results: number; errors: number; errorRate: number }> = [];
  for (const [tool, results] of state.toolResultCountByTool.entries()) {
    if (results < MIN_TOOL_RESULTS_FOR_FRICTION) continue;
    const errors = state.toolErrorCountByTool.get(tool) ?? 0;
    rows.push({ tool, results, errors, errorRate: errors / results });
  }
  return rows.sort((a, b) => b.errorRate - a.errorRate).slice(0, 15);
}

export function buildJsonReport(state: AnalysisState, quota: QuotaUsage | null, rateLimitTrends: RateLimitTrends | null = null) {
  const hitRate = overallCacheHitRate(state);

  let totalCompactions = 0;
  let manualCompactions = 0;
  let autoCompactions = 0;
  let tokensReclaimed = 0;
  for (const ctx of state.sessionContext.values()) {
    totalCompactions += ctx.compactionCount;
    manualCompactions += ctx.manualCompactions;
    autoCompactions += ctx.autoCompactions;
    tokensReclaimed += ctx.tokensReclaimed;
  }

  const staleSessions = findStaleContextSessions(state, STALE_CONTEXT_THRESHOLD)
    .slice(0, 20)
    .map((s) => ({
      sessionId: s.sessionId,
      contextTokens: s.contextTokens,
      compactionCount: s.compactionCount,
      everCompacted: s.everCompacted,
    }));

  return {
    schema_version: "0.1",
    note: "Deterministic stats only, no model-generated numbers. Hand this to an LLM for narrative enrichment/recommendations; do not ask it to recompute these counts.",
    filesTotal: state.filesTotal,
    filesProcessed: state.filesProcessed,
    sessionsScanned: state.sessionsSeenForFirstTurn.size,
    tokens: {
      totalInput: state.totalInput,
      totalOutput: state.totalOutput,
      totalCacheCreation: state.totalCacheCreation,
      totalCacheRead: state.totalCacheRead,
      cacheHitRate: hitRate,
    },
    contextOverhead: {
      avgFirstTurnCacheRead: state.firstTurnCacheRead.length
        ? state.firstTurnCacheRead.reduce((a, b) => a + b, 0) / state.firstTurnCacheRead.length
        : 0,
      maxFirstTurnCacheRead: state.firstTurnCacheRead.length ? Math.max(...state.firstTurnCacheRead) : 0,
      sessionsCounted: state.firstTurnCacheRead.length,
    },
    modelMix: Object.fromEntries(state.modelTurns),
    toolCalls: Object.fromEntries(topN(state.toolCounts, 30)),
    fileExtensionsRead: Object.fromEntries(topN(state.fileExtCounts, 30)),
    promptPatterns: {
      realPromptCount: state.promptCount,
      automatedMessageCount: state.automatedPromptCount,
      avgWordsPerPrompt: state.promptCount ? state.promptWordTotal / state.promptCount : 0,
      questionShare: state.promptCount ? state.questionCount / state.promptCount : 0,
      exclaimShare: state.promptCount ? state.exclaimCount / state.promptCount : 0,
      allCapsCount: state.allCapsCount,
      swearCount: state.swearCount,
      hourHistogram: Object.fromEntries(state.promptHours),
      weekdayHistogram: Object.fromEntries(state.promptWeekdays),
    },
    compaction: {
      totalCompactions,
      manualCompactions,
      autoCompactions,
      tokensReclaimed,
      staleContextSessions: staleSessions,
      staleContextThreshold: STALE_CONTEXT_THRESHOLD,
    },
    governance: {
      interruptCount: state.interruptCount,
      toolResultCount: state.toolResultCount,
      toolErrorCount: state.toolErrorCount,
      rejectedToolUseCount: state.rejectedToolUseCount,
      toolErrorRate: state.toolResultCount ? state.toolErrorCount / state.toolResultCount : 0,
    },
    slashCommandsTyped: Object.fromEntries(topN(state.skillUserInvoked, 30)),
    skillsInvokedByModel: Object.fromEntries(topN(state.skillCounts, 30)),
    claudeMdFiles: Object.fromEntries(state.claudeMdSizes),
    workspaces: Object.fromEntries(
      topN(new Map([...state.cwdSessions].map(([dir, ids]) => [dir, ids.size])), 20),
    ),
    workspaceCount: state.cwdSessions.size,
    compactionRetention: {
      compactionsWithRatio: state.compactionRatios.length,
      medianRetainedFraction: percentile(state.compactionRatios, 0.5),
      avgRetainedFraction: state.compactionRatios.length
        ? state.compactionRatios.reduce((a, b) => a + b, 0) / state.compactionRatios.length
        : 0,
    },
    awayWork: {
      awaySummaryCount: state.awaySummaryCount,
      scheduledTaskFireCount: state.scheduledTaskFireCount,
      scheduleWakeupCount: state.scheduleWakeupDelays.length,
      medianWakeupDelaySeconds: percentile(state.scheduleWakeupDelays, 0.5),
    },
    toolFriction: buildToolFriction(state),
    delegation: {
      agentToolCalls: state.toolCounts.get("Agent") ?? 0,
      sidechainRecordCount: state.sidechainRecordCount,
      sidechainSessionCount: state.sidechainSessionIds.size,
    },
    editBlastRadius: {
      snapshotCount: state.snapshotCount,
      avgTrackedFilesPerSnapshot: state.snapshotTrackedFileCounts.length
        ? state.snapshotTrackedFileCounts.reduce((a, b) => a + b, 0) / state.snapshotTrackedFileCounts.length
        : 0,
      maxTrackedFilesPerSnapshot: state.snapshotTrackedFileCounts.length
        ? Math.max(...state.snapshotTrackedFileCounts)
        : 0,
      hottestFiles: Object.fromEntries(topN(state.fileTouchCounts, 20)),
    },
    queueBacklog: Object.fromEntries(state.queueOpCounts),
    turnDuration: {
      turnsCounted: state.turnDurationsMs.length,
      medianMs: percentile(state.turnDurationsMs, 0.5),
      p90Ms: percentile(state.turnDurationsMs, 0.9),
      p95Ms: percentile(state.turnDurationsMs, 0.95),
      maxMs: state.turnDurationsMs.length ? Math.max(...state.turnDurationsMs) : 0,
    },
    officialQuota: quota
      ? {
          five_hour: quota.five_hour
            ? { utilization: quota.five_hour.utilization, resets_at: quota.five_hour.resets_at }
            : null,
          seven_day: quota.seven_day
            ? { utilization: quota.seven_day.utilization, resets_at: quota.seven_day.resets_at }
            : null,
        }
      : null,
    rateLimitTrends,
    recentWindow: buildRecentWindowRollup(state, 30),
  };
}
