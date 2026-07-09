import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { percentile, type AnalysisState, type DayBucket } from "./state.js";

export interface DailySnapshot {
  date: string;
  ts: string;
  sessionsScanned: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  cacheHitRate: number;
  toolErrorRate: number;
  worstToolFrictionRate: number;
  compactionMedianRetained: number;
  turnDurationMedianMs: number;
  agentToolCalls: number;
  bashShare: number;
  queueEnqueueCount: number;
}

const MIN_DAILY_TOOL_RESULTS_FOR_FRICTION = 3;

export function defaultHistoryPath(): string {
  return join(homedir(), ".cc-utility", "history.jsonl");
}

function worstToolFrictionForDay(bucket: DayBucket): number {
  let worst = 0;
  for (const { results, errors } of bucket.toolResultsByTool.values()) {
    if (results < MIN_DAILY_TOOL_RESULTS_FOR_FRICTION) continue;
    worst = Math.max(worst, errors / results);
  }
  return worst;
}

function snapshotFromBucket(date: string, bucket: DayBucket): DailySnapshot {
  const denom = bucket.totalCacheRead + bucket.totalInput + bucket.totalCacheCreation;
  return {
    date,
    ts: `${date}T23:59:59.999Z`,
    sessionsScanned: bucket.sessionIds.size,
    totalInput: bucket.totalInput,
    totalOutput: bucket.totalOutput,
    totalCacheRead: bucket.totalCacheRead,
    totalCacheCreation: bucket.totalCacheCreation,
    cacheHitRate: denom ? bucket.totalCacheRead / denom : 0,
    toolErrorRate: bucket.toolResultCount ? bucket.toolErrorCount / bucket.toolResultCount : 0,
    worstToolFrictionRate: worstToolFrictionForDay(bucket),
    compactionMedianRetained: percentile(bucket.compactionRatios, 0.5),
    turnDurationMedianMs: percentile(bucket.turnDurationsMs, 0.5),
    agentToolCalls: bucket.agentToolCalls,
    bashShare: bucket.totalToolCalls ? bucket.bashToolCalls / bucket.totalToolCalls : 0,
    queueEnqueueCount: bucket.queueEnqueueCount,
  };
}

export function buildAllDailySnapshots(state: AnalysisState): DailySnapshot[] {
  return [...state.dayBuckets.entries()]
    .map(([date, bucket]) => snapshotFromBucket(date, bucket))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const MIN_WINDOW_TOOL_RESULTS_FOR_FRICTION = 3;

export interface RecentWindowToolFriction {
  tool: string;
  results: number;
  errors: number;
  errorRate: number;
  lastSeenDate: string;
}

export interface RecentWindowRollup {
  windowDays: number;
  daysWithData: number;
  lastActiveDate: string | null;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  cacheHitRate: number;
  toolResultCount: number;
  toolErrorCount: number;
  toolErrorRate: number;
  toolFriction: RecentWindowToolFriction[];
  compactionsWithRatio: number;
  compactionMedianRetained: number;
  bashShare: number;
}

export function buildRecentWindowRollup(state: AnalysisState, windowDays = 30): RecentWindowRollup | null {
  const dates = [...state.dayBuckets.keys()].sort();
  if (!dates.length) return null;

  const lastActiveDate = dates[dates.length - 1];
  const cutoff = new Date(`${lastActiveDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1));
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const windowDates = dates.filter((d) => d >= cutoffKey && d <= lastActiveDate);

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0;
  let toolResultCount = 0, toolErrorCount = 0, bashCalls = 0, totalToolCalls = 0;
  const compactionRatios: number[] = [];
  const perTool = new Map<string, { results: number; errors: number; lastSeenDate: string }>();

  for (const date of windowDates) {
    const bucket = state.dayBuckets.get(date)!;
    totalInput += bucket.totalInput;
    totalOutput += bucket.totalOutput;
    totalCacheRead += bucket.totalCacheRead;
    totalCacheCreation += bucket.totalCacheCreation;
    toolResultCount += bucket.toolResultCount;
    toolErrorCount += bucket.toolErrorCount;
    bashCalls += bucket.bashToolCalls;
    totalToolCalls += bucket.totalToolCalls;
    compactionRatios.push(...bucket.compactionRatios);

    for (const [tool, stats] of bucket.toolResultsByTool.entries()) {
      const existing = perTool.get(tool) ?? { results: 0, errors: 0, lastSeenDate: date };
      existing.results += stats.results;
      existing.errors += stats.errors;
      existing.lastSeenDate = date;
      perTool.set(tool, existing);
    }
  }

  const denom = totalCacheRead + totalInput + totalCacheCreation;
  const toolFriction = [...perTool.entries()]
    .filter(([, s]) => s.results >= MIN_WINDOW_TOOL_RESULTS_FOR_FRICTION)
    .map(([tool, s]) => ({ tool, results: s.results, errors: s.errors, errorRate: s.errors / s.results, lastSeenDate: s.lastSeenDate }))
    .sort((a, b) => b.errorRate - a.errorRate);

  return {
    windowDays,
    daysWithData: windowDates.length,
    lastActiveDate,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreation,
    cacheHitRate: denom ? totalCacheRead / denom : 0,
    toolResultCount,
    toolErrorCount,
    toolErrorRate: toolResultCount ? toolErrorCount / toolResultCount : 0,
    toolFriction,
    compactionsWithRatio: compactionRatios.length,
    compactionMedianRetained: percentile(compactionRatios, 0.5),
    bashShare: totalToolCalls ? bashCalls / totalToolCalls : 0,
  };
}

export function readHistory(filePath: string): DailySnapshot[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const out: DailySnapshot[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (typeof rec === "object" && rec !== null && typeof rec.date === "string") {
        out.push(rec);
      }
    } catch {
      continue;
    }
  }
  return out;
}

export function mergeHistory(
  existing: DailySnapshot[],
  current: DailySnapshot[],
  todayKey = new Date().toISOString().slice(0, 10),
): DailySnapshot[] {
  const volume = (s: DailySnapshot) => s.totalInput + s.totalOutput + s.totalCacheRead + s.totalCacheCreation;
  const byDate = new Map(existing.map((s) => [s.date, s]));
  for (const s of current) {
    const prev = byDate.get(s.date);
    if (prev && s.date !== todayKey && volume(prev) > volume(s)) continue;
    byDate.set(s.date, s);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function writeHistory(filePath: string, snapshots: DailySnapshot[]): void {
  if (!snapshots.length && existsSync(filePath)) return;
  const sorted = mergeHistory(readHistory(filePath), snapshots);

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const body = sorted.map((s) => JSON.stringify(s)).join("\n") + "\n";
  const tmpPath = join(dir, `.history-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmpPath, body);
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
    throw err;
  }
}

const CSV_COLUMNS: Array<keyof DailySnapshot> = [
  "date", "ts", "sessionsScanned", "totalInput", "totalOutput", "totalCacheRead", "totalCacheCreation",
  "cacheHitRate", "toolErrorRate", "worstToolFrictionRate", "compactionMedianRetained", "turnDurationMedianMs",
  "agentToolCalls", "bashShare", "queueEnqueueCount",
];

export function toCsv(history: DailySnapshot[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = history.map((s) => CSV_COLUMNS.map((col) => String(s[col])).join(","));
  return [header, ...rows].join("\n") + "\n";
}
