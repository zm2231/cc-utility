import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import { anomalyTable, fmtCompact, lineChart, sortedBarPlot, shortToolName } from "./charts.js";

export type JsonReport = ReturnType<typeof import("./json.js").buildJsonReport>;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export interface Kpi {
  label: string;
  value: string;
  sparkline: string;
}

export function buildKpis(report: JsonReport, history: DailySnapshot[]): Kpi[] {
  const dates = history.map((h) => h.date);
  const totalTokens =
    report.tokens.totalInput + report.tokens.totalOutput + report.tokens.totalCacheCreation + report.tokens.totalCacheRead;
  const tokenSeries = history.map((h) => h.totalInput + h.totalOutput + h.totalCacheRead + h.totalCacheCreation);
  const cacheSeries = history.map((h) => h.cacheHitRate * 100);
  const sessionSeries = history.map((h) => h.sessionsScanned);
  const turnSeries = history.map((h) => h.turnDurationMedianMs / 1000);

  return [
    { label: "Tokens processed", value: fmtCompact(totalTokens), sparkline: lineChart(tokenSeries, dates, { height: 42, color: "#5b8cff" }) },
    { label: "Sessions scanned", value: fmtNum(report.sessionsScanned), sparkline: lineChart(sessionSeries, dates, { height: 42, color: "#39d353" }) },
    { label: "Cache hit rate", value: pct(report.tokens.cacheHitRate), sparkline: lineChart(cacheSeries, dates, { height: 42, color: "#8f5bff" }) },
    {
      label: "Median turn wait",
      value: `${(report.turnDuration.medianMs / 1000).toFixed(0)}s`,
      sparkline: lineChart(turnSeries, dates, { height: 42, color: "#e0b04a" }),
    },
  ];
}

export function modelMixBars(report: JsonReport): string {
  return sortedBarPlot(
    Object.entries(report.modelMix)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, value: fmtNum(count), share: count })),
  );
}

export function toolUsageBars(report: JsonReport): string {
  return sortedBarPlot(
    Object.entries(report.toolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ label: shortToolName(label), value: fmtNum(count), share: count })),
  );
}

export function fileTypeBars(report: JsonReport): string {
  return sortedBarPlot(
    Object.entries(report.fileExtensionsRead)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, value: fmtNum(count), share: count })),
  );
}

export function slashCommandBars(report: JsonReport): string {
  return sortedBarPlot(
    Object.entries(report.slashCommandsTyped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, value: fmtNum(count), share: count })),
  );
}

export function busiestWeekday(report: JsonReport): string {
  const entries = Object.entries(report.promptPatterns.weekdayHistogram) as Array<[string, number]>;
  if (!entries.length) return "—";
  const [day, count] = entries.sort((a, b) => b[1] - a[1])[0];
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[Number(day)] ?? day} (${fmtNum(count)} prompts)`;
}

export function busiestHour(report: JsonReport): string {
  const entries = Object.entries(report.promptPatterns.hourHistogram) as Array<[string, number]>;
  if (!entries.length) return "—";
  const [hour, count] = entries.sort((a, b) => b[1] - a[1])[0];
  return `${hour}:00 UTC (${fmtNum(count)} prompts)`;
}

export function anomalyRows(report: JsonReport): { html: string; count: number; windowLabel: string } {
  const window = report.recentWindow;
  const rows = window
    ? window.toolFriction
        .filter((r) => r.errorRate >= 0.3)
        .sort((a, b) => b.errorRate - a.errorRate)
        .slice(0, 8)
        .map((r) => ({ tool: r.tool, errors: r.errors, results: r.results, errorRate: r.errorRate, lastSeenDate: r.lastSeenDate }))
    : report.toolFriction
        .filter((r) => r.errorRate >= 0.3)
        .slice(0, 8);
  const windowLabel = window ? ` in the last ${window.windowDays} days` : "";
  return { html: anomalyTable(rows, windowLabel), count: rows.length, windowLabel };
}

const TOOL_FRICTION_PREFIX = "tool-friction:";

export function otherFindings(findings: OptimizationFinding[]): OptimizationFinding[] {
  return findings.filter((f) => !f.id.startsWith(TOOL_FRICTION_PREFIX));
}

export function findingRowCompact(f: OptimizationFinding): string {
  const dot = f.severity === "high" ? "sev-dot-high" : f.severity === "medium" ? "sev-dot-medium" : "sev-dot-low";
  return `
    <details class="finding-compact">
      <summary>
        <span class="sev-dot ${dot}"></span>
        <span class="finding-headline">${esc(f.headline)}</span>
      </summary>
      <div class="finding-body">
        <p>${esc(f.detail)}</p>
        <pre class="evidence">${esc(JSON.stringify(f.evidence, null, 2))}</pre>
      </div>
    </details>`;
}

export function heatmapSeries(history: DailySnapshot[]): Array<{ date: string; value: number }> {
  return history.map((h) => ({ date: h.date, value: h.totalInput + h.totalOutput + h.totalCacheRead + h.totalCacheCreation }));
}
