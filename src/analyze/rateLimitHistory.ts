import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { safeNum } from "./state.js";

export function defaultSidecarLogPath(): string {
  return join(homedir(), ".cc-utility", "sidecar-log.jsonl");
}

const FIVE_HOUR_SECONDS = 5 * 3600;
const SEVEN_DAY_SECONDS = 7 * 86400;
const THRESHOLD_PCT = 80;
const MIN_ELAPSED_FRACTION_FOR_PACE = 0.1;

export interface RateLimitSnapshot {
  ts: string;
  sessionId: string;
  fiveHourPct: number | null;
  fiveHourResetSec: number | null;
  sevenDayPct: number | null;
  sevenDayResetSec: number | null;
  costUsd: number;
}

export interface ThresholdCrossing {
  window: "five_hour" | "seven_day";
  ts: string;
  pct: number;
}

export interface RateLimitTrends {
  snapshotsCounted: number;
  latestTs: string | null;
  latestFiveHourPct: number | null;
  latestSevenDayPct: number | null;
  latestFiveHourResetSec: number | null;
  latestSevenDayResetSec: number | null;
  latestFiveHourPace: number | null;
  latestSevenDayPace: number | null;
  avgFiveHourPace: number | null;
  avgSevenDayPace: number | null;
  busiestHourUtc: number | null;
  busiestWeekday: string | null;
  thresholdCrossings: ThresholdCrossing[];
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseSidecarLog(filePath: string): RateLimitSnapshot[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const out: RateLimitSnapshot[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) continue;

    out.push({
      ts: typeof rec.ts === "string" ? rec.ts : "",
      sessionId: typeof rec.session_id === "string" ? rec.session_id : "",
      fiveHourPct: nullableNum(rec.five_hour_pct),
      fiveHourResetSec: nullableNum(rec.five_hour_reset),
      sevenDayPct: nullableNum(rec.seven_day_pct),
      sevenDayResetSec: nullableNum(rec.seven_day_reset),
      costUsd: safeNum(rec.cost_usd),
    });
  }
  return out;
}

export function computePace(usagePct: number, remainingSeconds: number, totalSeconds: number): number {
  let elapsed = totalSeconds - remainingSeconds;
  if (elapsed < 0) elapsed = 0;
  let elapsedPct = (elapsed / totalSeconds) * 100;
  if (elapsedPct < 1) elapsedPct = 1;
  return (usagePct / elapsedPct - 1) * 100;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeRateLimitTrends(snapshots: RateLimitSnapshot[]): RateLimitTrends | null {
  if (!snapshots.length) return null;

  const fiveHourPaces: number[] = [];
  const sevenDayPaces: number[] = [];
  const hourCounts = new Map<number, number>();
  const weekdayCounts = new Map<string, number>();
  const crossings: ThresholdCrossing[] = [];

  let prevFiveHourPct: number | null = null;
  let prevSevenDayPct: number | null = null;

  for (const s of snapshots) {
    if (s.fiveHourPct !== null && s.fiveHourResetSec !== null &&
        (FIVE_HOUR_SECONDS - s.fiveHourResetSec) / FIVE_HOUR_SECONDS >= MIN_ELAPSED_FRACTION_FOR_PACE) {
      fiveHourPaces.push(computePace(s.fiveHourPct, s.fiveHourResetSec, FIVE_HOUR_SECONDS));
    }
    if (s.sevenDayPct !== null && s.sevenDayResetSec !== null &&
        (SEVEN_DAY_SECONDS - s.sevenDayResetSec) / SEVEN_DAY_SECONDS >= MIN_ELAPSED_FRACTION_FOR_PACE) {
      sevenDayPaces.push(computePace(s.sevenDayPct, s.sevenDayResetSec, SEVEN_DAY_SECONDS));
    }

    const dt = s.ts ? new Date(s.ts) : null;
    if (dt && !Number.isNaN(dt.getTime())) {
      hourCounts.set(dt.getUTCHours(), (hourCounts.get(dt.getUTCHours()) ?? 0) + 1);
      const weekday = WEEKDAYS[dt.getUTCDay()];
      weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
    }

    if (s.fiveHourPct !== null) {
      if (prevFiveHourPct !== null && prevFiveHourPct < THRESHOLD_PCT && s.fiveHourPct >= THRESHOLD_PCT) {
        crossings.push({ window: "five_hour", ts: s.ts, pct: s.fiveHourPct });
      }
      prevFiveHourPct = s.fiveHourPct;
    }
    if (s.sevenDayPct !== null) {
      if (prevSevenDayPct !== null && prevSevenDayPct < THRESHOLD_PCT && s.sevenDayPct >= THRESHOLD_PCT) {
        crossings.push({ window: "seven_day", ts: s.ts, pct: s.sevenDayPct });
      }
      prevSevenDayPct = s.sevenDayPct;
    }
  }

  const avg = (values: number[]): number | null =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const busiestHourUtc = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const busiestWeekday = [...weekdayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const last = snapshots[snapshots.length - 1];
  const latestPace = (pct: number | null, resetSec: number | null, totalSeconds: number): number | null => {
    if (pct === null || resetSec === null) return null;
    if ((totalSeconds - resetSec) / totalSeconds < MIN_ELAPSED_FRACTION_FOR_PACE) return null;
    return computePace(pct, resetSec, totalSeconds);
  };

  return {
    snapshotsCounted: snapshots.length,
    latestTs: last?.ts ?? null,
    latestFiveHourPct: last?.fiveHourPct ?? null,
    latestSevenDayPct: last?.sevenDayPct ?? null,
    latestFiveHourResetSec: last?.fiveHourResetSec ?? null,
    latestSevenDayResetSec: last?.sevenDayResetSec ?? null,
    latestFiveHourPace: last ? latestPace(last.fiveHourPct, last.fiveHourResetSec, FIVE_HOUR_SECONDS) : null,
    latestSevenDayPace: last ? latestPace(last.sevenDayPct, last.sevenDayResetSec, SEVEN_DAY_SECONDS) : null,
    avgFiveHourPace: avg(fiveHourPaces),
    avgSevenDayPace: avg(sevenDayPaces),
    busiestHourUtc,
    busiestWeekday,
    thresholdCrossings: crossings,
  };
}
