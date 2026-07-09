import kleur from "kleur";
import type { AnalysisState } from "../analyze/state.js";
import { overallCacheHitRate } from "../analyze/tokens.js";
import { topN, percentile } from "../analyze/state.js";
import { findStaleContextSessions } from "../analyze/compaction.js";
import type { QuotaUsage } from "../quota/official.js";
import type { RateLimitTrends } from "../analyze/rateLimitHistory.js";
import { summarizeHooks, isSlowHook } from "../analyze/hooks.js";
import { topDenials } from "../analyze/denials.js";
import type { ContextAttribution } from "../analyze/contextAttribution.js";
import { buildCodexReport, type CodexState } from "../codex/scan.js";

const MIN_TOOL_RESULTS_FOR_FRICTION = 5;

const STALE_CONTEXT_THRESHOLD = 150_000;

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".tar", ".gz",
  ".mp4", ".mov", ".mp3", ".wav", ".bin", ".exe", ".dmg", ".woff", ".woff2",
]);

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function bar(value: number, max: number, width = 30): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled));
}

export function renderReport(
  state: AnalysisState,
  quota: QuotaUsage | null,
  rateLimitTrends: RateLimitTrends | null = null,
  attribution: ContextAttribution | null = null,
  codex: CodexState | null = null,
): void {
  const line = () => console.log(kleur.dim("─".repeat(64)));

  console.log();
  console.log(kleur.bold().cyan("  cc-utility") + kleur.dim("  (local Claude Code session report)"));
  line();

  console.log(`  Sessions scanned: ${kleur.bold(String(state.sessionsSeenForFirstTurn.size))}  (${state.filesProcessed}/${state.filesTotal} files)`);
  console.log();

  console.log(kleur.bold("  Token & cache health"));
  const hitRate = overallCacheHitRate(state);
  console.log(`    Cache hit rate:      ${kleur.bold(pct(hitRate))}`);
  console.log(`    Input (uncached):    ${fmt(state.totalInput)}`);
  console.log(`    Cache reads:         ${fmt(state.totalCacheRead)}`);
  console.log(`    Cache writes:        ${fmt(state.totalCacheCreation)}`);
  console.log(`    Output tokens:       ${fmt(state.totalOutput)}`);
  if (hitRate < 0.9 && state.totalCacheRead + state.totalInput > 0) {
    console.log(kleur.yellow(`    ⚠ Cache hit rate below 90%, check for early-context churn (dynamic content near the top of your prompt/CLAUDE.md invalidates the cached prefix downstream).`));
  }
  console.log();

  console.log(kleur.bold("  Context overhead (measured, not estimated)"));
  if (state.firstTurnContext.length) {
    const avg = state.firstTurnContext.reduce((a, b) => a + b, 0) / state.firstTurnContext.length;
    const max = Math.max(...state.firstTurnContext);
    console.log(`    Median loaded before first turn: ${fmt(percentile(state.firstTurnContext, 0.5))} tokens  (avg ${fmt(avg)}, max ${fmt(max)}, across ${fmt(state.firstTurnContext.length)} fresh sessions)`);
    console.log(kleur.dim(`    Total input on each fresh session's first assistant turn: system prompt + CLAUDE.md + MCP/skill defs + auto-memory. ${fmt(state.continuationSessions.size)} continuation sessions excluded.`));
  } else {
    console.log(kleur.dim("    No data."));
  }
  console.log();

  if (attribution) {
    console.log(kleur.bold("  Context overhead attribution") + kleur.dim("  (disk-based estimates of what loads before turn one)"));
    for (const item of attribution.items) {
      console.log(`    ${fmt(item.estTokens).padStart(7)} tok  ${item.component}`);
      console.log(kleur.dim(`                 ${item.detail}`));
    }
    const skillItem = attribution.items.find((i) => i.component.startsWith("Skill listing"));
    if (skillItem && skillItem.estTokens > attribution.skillListingBudgetTokens) {
      console.log(kleur.yellow(`    ⚠ Skill listing (${fmt(skillItem.estTokens)} est. tokens) exceeds its ~${fmt(attribution.skillListingBudgetTokens)}-token budget (~1% of context); entries get truncated and skill routing degrades. Trim descriptions or set disable-model-invocation on unused skills.`));
    }
    console.log();
  }

  console.log(kleur.bold("  Model mix"));
  const modelEntries = [...state.modelTurns.entries()].sort((a, b) => b[1] - a[1]);
  const totalTurns = modelEntries.reduce((a, [, v]) => a + v, 0);
  for (const [model, count] of modelEntries.slice(0, 8)) {
    console.log(`    ${model.padEnd(28)} ${bar(count, modelEntries[0][1], 20)} ${fmt(count)} (${pct(count / totalTurns)})`);
  }
  console.log();

  console.log(kleur.bold("  Tool calls"));
  const toolEntries = topN(state.toolCounts, 10);
  const totalTools = [...state.toolCounts.values()].reduce((a, b) => a + b, 0);
  for (const [tool, count] of toolEntries) {
    console.log(`    ${tool.padEnd(28)} ${bar(count, toolEntries[0][1], 20)} ${fmt(count)} (${pct(count / totalTools)})`);
  }
  const bashShare = (state.toolCounts.get("Bash") ?? 0) / (totalTools || 1);
  if (bashShare > 0.45) {
    console.log(kleur.yellow(`    ⚠ Bash is ${pct(bashShare)} of tool calls; large/uncompressed command output is a common context-bloat source; pipe through grep/head where you can.`));
  }
  console.log();

  console.log(kleur.bold("  File types read"));
  const extEntries = topN(state.fileExtCounts, 10);
  for (const [ext, count] of extEntries) {
    console.log(`    ${ext.padEnd(12)} ${fmt(count)}`);
  }
  const binaryReads = [...state.fileExtCounts.entries()]
    .filter(([ext]) => BINARY_EXTS.has(ext))
    .reduce((a, [, c]) => a + c, 0);
  if (binaryReads > 0) {
    console.log(kleur.yellow(`    ⚠ ${binaryReads} reads of binary/media file types, these dump raw or base64 content into context for no benefit; worth a hook that blocks Read on these extensions.`));
  }
  console.log();

  console.log(kleur.bold("  Usage patterns"));
  console.log(`    Real prompts:        ${fmt(state.promptCount)}  (${fmt(state.automatedPromptCount)} automated/synthetic messages excluded)`);
  console.log(`    Avg words/prompt:    ${state.promptCount ? (state.promptWordTotal / state.promptCount).toFixed(1) : "0"}`);
  console.log(`    Questions:           ${pct(state.promptCount ? state.questionCount / state.promptCount : 0)}`);
  const lateNight = [0, 1, 2, 3, 4].reduce((a, h) => a + (state.promptHours.get(h) ?? 0), 0);
  if (state.promptCount) {
    console.log(`    Midnight-5am share:  ${pct(lateNight / state.promptCount)}`);
  }
  const weekdayEntries = [...state.promptWeekdays.entries()].sort((a, b) => b[1] - a[1]);
  if (weekdayEntries.length) {
    console.log(`    Busiest day:         ${weekdayEntries[0][0]} (${fmt(weekdayEntries[0][1])} prompts)`);
  }
  console.log();

  console.log(kleur.bold("  Context compaction"));
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
  console.log(`    Total compactions:   ${fmt(totalCompactions)}  (${fmt(manualCompactions)} manual, ${fmt(autoCompactions)} auto)`);
  console.log(`    Tokens reclaimed:    ${fmt(tokensReclaimed)}`);
  if (state.compactionRatios.length) {
    const avgRatio = state.compactionRatios.reduce((a, b) => a + b, 0) / state.compactionRatios.length;
    console.log(`    Retained after compaction: median ${pct(percentile(state.compactionRatios, 0.5))}, avg ${pct(avgRatio)} of pre-compaction tokens`);
  }
  const staleSessions = findStaleContextSessions(state, STALE_CONTEXT_THRESHOLD);
  if (staleSessions.length) {
    const neverCompacted = staleSessions.filter((s) => !s.everCompacted).length;
    console.log(kleur.yellow(`    ⚠ ${staleSessions.length} session(s) active in the last 7 days carrying >${fmt(STALE_CONTEXT_THRESHOLD)} tokens of context without a recent compaction (${neverCompacted} never compacted at all). A long session with frequent, efficient compactions is fine; this flags context that's grown stale since the last one.`));
  } else {
    console.log(kleur.dim(`    No sessions found carrying excessive uncompacted context.`));
  }
  console.log();

  const hookRows = summarizeHooks(state);
  if (hookRows.length) {
    console.log(kleur.bold("  Hook latency") + kleur.dim("  (blocking time from transcript hook records; counts are floors)"));
    for (const r of hookRows.slice(0, 8)) {
      const label = `${r.hook}:`.padEnd(36);
      const lineTxt = `    ${label} n=${fmt(r.count)}  med ${fmt(r.medianMs)}ms  p95 ${fmt(r.p95Ms)}ms  max ${fmt(r.maxMs)}ms  total wait ${(r.totalWaitMs / 60000).toFixed(1)}min`;
      console.log(isSlowHook(r) ? kleur.yellow(lineTxt + (r.timeouts ? `  (${r.timeouts} timeouts)` : "  ⚠ slow")) : lineTxt);
    }
    console.log();
  }

  if (state.denialsByKind.size) {
    console.log(kleur.bold("  Permission denials") + kleur.dim("  (CLI-stamped toolDenialKind)"));
    const kindLine = [...state.denialsByKind.entries()].map(([k, v]) => `${k}: ${fmt(v)}`).join(", ");
    console.log(`    By kind:  ${kindLine}`);
    for (const d of topDenials(state, 8)) {
      const kinds = Object.entries(d.kinds).map(([k, v]) => `${k}×${v}`).join(", ");
      console.log(`    ${d.pattern.padEnd(36)} ${fmt(d.count)}  (${kinds})`);
    }
    console.log();
  }

  console.log(kleur.bold("  Interrupts & tool errors"));
  console.log(`    User interruptions:  ${fmt(state.interruptCount)}`);
  console.log(`    Tool errors:         ${fmt(state.toolErrorCount)} / ${fmt(state.toolResultCount)} tool results (${pct(state.toolResultCount ? state.toolErrorCount / state.toolResultCount : 0)})`);
  if (state.rejectedToolUseCount > 0) {
    console.log(kleur.yellow(`    ⚠ ${fmt(state.rejectedToolUseCount)} tool calls rejected outright. Repeated rejections in one session usually mean the agent should have stopped and asked, not retried.`));
  }
  console.log();

  const frictionRows = [...state.toolResultCountByTool.entries()]
    .filter(([, results]) => results >= MIN_TOOL_RESULTS_FOR_FRICTION)
    .map(([tool, results]) => ({ tool, results, errors: state.toolErrorCountByTool.get(tool) ?? 0 }))
    .map((r) => ({ ...r, errorRate: r.errors / r.results }))
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 8);
  if (frictionRows.length) {
    console.log(kleur.bold("  Tool friction by type") + kleur.dim(`  (min ${MIN_TOOL_RESULTS_FOR_FRICTION} results)`));
    for (const r of frictionRows) {
      console.log(`    ${r.tool.padEnd(28)} ${fmt(r.errors)}/${fmt(r.results)} (${pct(r.errorRate)})`);
    }
    console.log();
  }

  if (state.turnDurationsMs.length) {
    console.log(kleur.bold("  Turn duration (operator wait time)"));
    console.log(`    Median: ${(percentile(state.turnDurationsMs, 0.5) / 1000).toFixed(1)}s   p90: ${(percentile(state.turnDurationsMs, 0.9) / 1000).toFixed(1)}s   p95: ${(percentile(state.turnDurationsMs, 0.95) / 1000).toFixed(1)}s   max: ${(Math.max(...state.turnDurationsMs) / 1000 / 60).toFixed(1)}min`);
    const over30min = state.turnDurationsMs.filter((ms) => ms > 30 * 60 * 1000).length;
    if (over30min > 0) {
      console.log(kleur.yellow(`    ⚠ ${over30min} turn(s) over 30 minutes.`));
    }
    console.log();
  }

  if (state.awaySummaryCount || state.scheduledTaskFireCount || state.scheduleWakeupDelays.length) {
    console.log(kleur.bold("  Autonomous / away-work"));
    console.log(`    Away summaries:      ${fmt(state.awaySummaryCount)}`);
    console.log(`    Scheduled wakeups:   ${fmt(state.scheduledTaskFireCount)} fired, ${fmt(state.scheduleWakeupDelays.length)} scheduled`);
    if (state.scheduleWakeupDelays.length) {
      console.log(`    Median wake delay:   ${Math.round(percentile(state.scheduleWakeupDelays, 0.5) / 60)}min`);
    }
    console.log();
  }

  const agentCalls = state.toolCounts.get("Agent") ?? 0;
  if (agentCalls || state.sidechainRecordCount) {
    console.log(kleur.bold("  Delegation (subagents)"));
    console.log(`    Agent tool calls:    ${fmt(agentCalls)}`);
    console.log(`    Sidechain records:   ${fmt(state.sidechainRecordCount)}  (${fmt(state.sidechainSessionIds.size)} sessions delegated at least once)`);
    if (state.totalOutput) {
      console.log(`    Subagent share:      ${pct(state.sidechainOutput / state.totalOutput)} of output tokens, ${fmt(state.sidechainToolCalls)} tool calls`);
    }
    console.log();
  }

  if (state.projectStats.size) {
    console.log(kleur.bold("  Top projects by output tokens"));
    const projRows = [...state.projectStats.entries()]
      .sort((a, b) => b[1].output - a[1].output)
      .slice(0, 8);
    for (const [cwd, p] of projRows) {
      console.log(`    ${fmt(p.output).padStart(11)} out  ${fmt(p.sessionIds.size).padStart(5)} sessions  ${cwd}`);
    }
    console.log();
  }

  if (state.snapshotCount) {
    console.log(kleur.bold("  Edit blast radius"));
    const avgTracked = state.snapshotTrackedFileCounts.reduce((a, b) => a + b, 0) / state.snapshotTrackedFileCounts.length;
    console.log(`    Snapshots:           ${fmt(state.snapshotCount)}`);
    console.log(`    Avg tracked files:   ${avgTracked.toFixed(1)}  (max ${fmt(Math.max(...state.snapshotTrackedFileCounts))})`);
    const hotFiles = topN(state.fileTouchCounts, 5);
    if (hotFiles.length) {
      console.log(`    Hottest files:`);
      for (const [path, count] of hotFiles) {
        console.log(`      ${fmt(count).padStart(6)}  ${path}`);
      }
    }
    console.log();
  }

  if (state.queueOpCounts.size) {
    console.log(kleur.bold("  Queue backlog"));
    for (const [op, count] of [...state.queueOpCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${op.padEnd(28)} ${fmt(count)}`);
    }
    console.log();
  }

  if (state.skillUserInvoked.size) {
    console.log(kleur.bold("  Slash commands typed"));
    for (const [command, count] of topN(state.skillUserInvoked, 10)) {
      console.log(`    /${command.padEnd(27)} ${fmt(count)}`);
    }
    console.log();
  }

  if (state.skillCounts.size) {
    console.log(kleur.bold("  Skills invoked by the model") + kleur.dim("  (its own decision, not a typed command)"));
    for (const [skill, count] of topN(state.skillCounts, 10)) {
      console.log(`    ${skill.padEnd(28)} ${fmt(count)}`);
    }
    console.log();
  }

  if (state.claudeMdSizes.size) {
    console.log(kleur.bold("  CLAUDE.md files (measured)"));
    const sorted = [...state.claudeMdSizes.entries()].sort((a, b) => b[1] - a[1]);
    for (const [path, tokens] of sorted.slice(0, 10)) {
      console.log(`    ${fmt(tokens).padStart(7)} tok  ${path}`);
    }
    console.log();
  }

  if (quota) {
    console.log(kleur.bold("  Official subscription quota") + kleur.dim("  (live, from Anthropic, not estimated)"));
    if (quota.five_hour) {
      const severity = quota.five_hour.utilization >= 80 ? kleur.red : quota.five_hour.utilization >= 50 ? kleur.yellow : kleur.green;
      console.log(`    5-hour window:  ${severity(`${quota.five_hour.utilization}%`)}  resets ${quota.five_hour.resets_at ?? "unknown"}`);
    }
    if (quota.seven_day) {
      const severity = quota.seven_day.utilization >= 80 ? kleur.red : quota.seven_day.utilization >= 50 ? kleur.yellow : kleur.green;
      console.log(`    7-day window:   ${severity(`${quota.seven_day.utilization}%`)}  resets ${quota.seven_day.resets_at ?? "unknown"}`);
    }
    console.log();
  }

  if (rateLimitTrends) {
    console.log(kleur.bold("  Rate-limit history") + kleur.dim("  (from the optional pacekit sidecar log)"));
    console.log(`    Snapshots logged:    ${fmt(rateLimitTrends.snapshotsCounted)}`);
    if (rateLimitTrends.avgFiveHourPace !== null) {
      const sign = rateLimitTrends.avgFiveHourPace >= 0 ? "+" : "";
      console.log(`    5-hour avg pace:     ${sign}${rateLimitTrends.avgFiveHourPace.toFixed(1)}%`);
    }
    if (rateLimitTrends.avgSevenDayPace !== null) {
      const sign = rateLimitTrends.avgSevenDayPace >= 0 ? "+" : "";
      console.log(`    7-day avg pace:      ${sign}${rateLimitTrends.avgSevenDayPace.toFixed(1)}%`);
    }
    if (rateLimitTrends.busiestWeekday) {
      console.log(`    Busiest weekday:     ${rateLimitTrends.busiestWeekday}`);
    }
    if (rateLimitTrends.thresholdCrossings.length) {
      console.log(kleur.yellow(`    ⚠ Crossed 80% utilization ${rateLimitTrends.thresholdCrossings.length} time(s):`));
      for (const c of rateLimitTrends.thresholdCrossings.slice(-5)) {
        console.log(`      ${c.window === "five_hour" ? "5h " : "7d "} ${c.ts}  ${c.pct}%`);
      }
    }
    console.log();
  }

  if (codex) {
    const cx = buildCodexReport(codex);
    console.log(kleur.bold().magenta("  Codex") + kleur.dim(`  (~/.codex/sessions: ${fmt(cx.filesScanned)} rollout files, ${fmt(cx.sessions)} sessions)`));
    console.log(`    Input tokens:        ${fmt(cx.tokens.totalInput)}  (${pct(cx.tokens.cacheShareOfInput)} served from cache)`);
    console.log(`    Output tokens:       ${fmt(cx.tokens.totalOutput)}  (${fmt(cx.tokens.totalReasoningOutput)} reasoning)`);
    const cxModels = Object.entries(cx.models);
    if (cxModels.length) {
      console.log(`    Models:              ${cxModels.map(([m, n]) => `${m} ×${fmt(n)}`).join(", ")}`);
    }
    const cxTools = Object.entries(cx.toolCalls).slice(0, 5);
    if (cxTools.length) {
      console.log(`    Top tools:           ${cxTools.map(([t, n]) => `${t} ×${fmt(n)}`).join(", ")}`);
    }
    if (cx.contextWindowFill.sessionsMeasured) {
      console.log(`    End-of-session context fill: median ${pct(cx.contextWindowFill.medianEndOfSessionFill)}, p90 ${pct(cx.contextWindowFill.p90EndOfSessionFill)}`);
    }
    if (cx.rateLimits.latest) {
      console.log(`    Rate limits (latest logged ${cx.rateLimits.latest.at}): 5h ${cx.rateLimits.latest.primaryPct ?? "?"}%, weekly ${cx.rateLimits.latest.secondaryPct ?? "?"}%  (peaks: ${cx.rateLimits.peakPrimaryPct}% / ${cx.rateLimits.peakSecondaryPct}%)`);
    }
    console.log();
  }

  line();
  console.log(kleur.dim("  100% local. No telemetry, no network calls unless --quota is passed."));
  console.log();
}
