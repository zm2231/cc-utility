import type { SessionRecord } from "../jsonl/types.js";
import type { AnalysisState, HookStat } from "./state.js";
import { percentile } from "./state.js";

const HOOK_ATTACHMENT_TYPES = new Set([
  "hook_success",
  "hook_non_blocking_error",
  "hook_error_during_execution",
  "hook_cancelled",
]);

function getHookStat(state: AnalysisState, key: string): HookStat {
  let stat = state.hookStats.get(key);
  if (!stat) {
    stat = { count: 0, errors: 0, timeouts: 0, durations: [] };
    state.hookStats.set(key, stat);
  }
  return stat;
}

export function processHookAttachment(state: AnalysisState, rec: SessionRecord): void {
  if (rec.type !== "attachment") return;
  const att = rec.attachment;
  if (!att || typeof att.type !== "string" || !HOOK_ATTACHMENT_TYPES.has(att.type)) return;

  const timedOut = att.type === "hook_cancelled" && att.timedOut === true;
  if (att.type === "hook_cancelled" && !timedOut) return;

  const key = `${att.hookName ?? "?"} @ ${att.hookEvent ?? "?"}`;
  const stat = getHookStat(state, key);
  stat.count += 1;
  if (att.type === "hook_non_blocking_error" || att.type === "hook_error_during_execution") stat.errors += 1;
  if (timedOut) stat.timeouts += 1;

  const duration = typeof att.durationMs === "number" && Number.isFinite(att.durationMs)
    ? att.durationMs
    : timedOut && typeof att.timeoutMs === "number"
      ? att.timeoutMs
      : null;
  if (duration !== null) stat.durations.push(duration);
}

export interface HookSummaryRow {
  hook: string;
  count: number;
  errors: number;
  timeouts: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  totalWaitMs: number;
}

const PER_EVENT_SLOW_MS = 2000;
const PER_SESSION_SLOW_MS = 10000;

export function summarizeHooks(state: AnalysisState): HookSummaryRow[] {
  const rows: HookSummaryRow[] = [];
  for (const [hook, stat] of state.hookStats.entries()) {
    const totalWaitMs = stat.durations.reduce((a, b) => a + b, 0);
    rows.push({
      hook,
      count: stat.count,
      errors: stat.errors,
      timeouts: stat.timeouts,
      medianMs: percentile(stat.durations, 0.5),
      p95Ms: percentile(stat.durations, 0.95),
      maxMs: stat.durations.length ? Math.max(...stat.durations) : 0,
      totalWaitMs,
    });
  }
  return rows.sort((a, b) => b.totalWaitMs - a.totalWaitMs);
}

export function isSlowHook(row: HookSummaryRow): boolean {
  const perSession = row.hook.includes("SessionStart") || row.hook.includes("@ Stop");
  const threshold = perSession ? PER_SESSION_SLOW_MS : PER_EVENT_SLOW_MS;
  return row.medianMs > threshold || row.timeouts > 0;
}
