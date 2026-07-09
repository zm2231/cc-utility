import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import { heatmapGrid } from "./charts.js";
import {
  anomalyRows,
  busiestHour,
  busiestWeekday,
  buildKpis,
  esc,
  findingRowCompact,
  fmtNum,
  heatmapSeries,
  modelMixBars,
  otherFindings,
  pct,
  slashCommandBars,
  toolUsageBars,
  fileTypeBars,
  type JsonReport,
} from "./shared.js";

export function buildGridReport(report: JsonReport, findings: OptimizationFinding[], history: DailySnapshot[]): string {
  const kpis = buildKpis(report, history);
  const anomalies = anomalyRows(report);
  const rest = otherFindings(findings);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cc-utility — grid</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 2rem 4rem;
    background: #0b0d10; color: #e7e9ec;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .page { max-width: 1240px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.5rem; }
  .brand { color: #6b7280; font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .subtitle { color: #9aa1ab; font-size: 0.85rem; }

  .panel { background: #14171c; border: 1px solid #21252c; border-radius: 12px; padding: 1.3rem 1.5rem; }
  .panel h2 { margin: 0 0 0.9rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #8a92a0; }
  .muted { color: #7d8590; font-size: 0.82rem; margin: 0 0 0.8rem; }

  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.1rem; }
  .kpi { background: #14171c; border: 1px solid #21252c; border-radius: 12px; padding: 1.1rem 1.3rem; }
  .kpi-label { font-size: 0.75rem; color: #8a92a0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
  .kpi-value { font-size: 1.7rem; font-weight: 650; color: #f4f5f7; font-variant-numeric: tabular-nums; margin-bottom: 0.4rem; }

  .split { display: grid; grid-template-columns: 1.5fr 1fr; gap: 1.1rem; margin-bottom: 1.1rem; align-items: start; }
  .stack { display: flex; flex-direction: column; gap: 1.1rem; }

  .bar-row { display: grid; grid-template-columns: 1fr 3fr auto; align-items: center; gap: 0.6rem; margin: 0.4rem 0; font-size: 0.82rem; }
  .bar-label { color: #b6bcc6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { background: #21252c; border-radius: 5px; height: 8px; overflow: hidden; }
  .bar-fill { background: linear-gradient(90deg, #5b8cff, #8f5bff); height: 100%; border-radius: 5px; }
  .bar-value { color: #7d8590; font-variant-numeric: tabular-nums; }

  .anomaly-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .anomaly-table th { text-align: left; color: #7d8590; font-weight: 500; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.35rem 0.3rem; border-bottom: 1px solid #21252c; }
  .anomaly-table td { padding: 0.4rem 0.3rem; border-bottom: 1px solid #1a1e24; }
  .tool-name { color: #c3c8d1; }
  .num { font-variant-numeric: tabular-nums; text-align: right; }
  .muted { color: #7d8590; }
  .sev-high { color: #e05a5a; font-weight: 700; }
  .sev-medium { color: #e0b04a; font-weight: 700; }
  .sev-low { color: #6b9bff; font-weight: 700; }

  .stat-line { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.4rem 0; border-bottom: 1px solid #1a1e24; color: #c3c8d1; }
  .stat-line:last-child { border-bottom: none; }
  .stat-line span:last-child { color: #f4f5f7; font-variant-numeric: tabular-nums; }

  .findings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.5rem; }
  details.finding-compact { border-top: 1px solid #1a1e24; padding: 0.5rem 0; }
  details.finding-compact summary { cursor: pointer; display: flex; align-items: center; gap: 0.5rem; list-style: none; font-size: 0.85rem; }
  details.finding-compact summary::-webkit-details-marker { display: none; }
  .sev-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .sev-dot-high { background: #e05a5a; }
  .sev-dot-medium { background: #e0b04a; }
  .sev-dot-low { background: #6b9bff; }
  .finding-headline { color: #d6dae1; }
  .finding-body { margin-top: 0.5rem; padding-left: 1.2rem; }
  .finding-body p { margin: 0 0 0.5rem; color: #9aa1ab; font-size: 0.82rem; }
  .evidence { background: #0b0d10; border: 1px solid #21252c; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.75rem; color: #9aa7b5; overflow-x: auto; }

  .chart-line, .chart-heatmap { display: block; }
  .chart-empty { color: #565c66; font-size: 0.82rem; padding: 0.5rem 0; }

  .footer { text-align: center; margin-top: 2rem; color: #565c66; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="page">
  <header>
    <div class="brand">cc-utility</div>
    <div class="subtitle">${fmtNum(report.sessionsScanned)} sessions &middot; ${history.length} day(s) of history &middot; 100% local</div>
  </header>

  <section class="kpi-row">
    ${kpis
      .map(
        (k) => `
      <div class="kpi">
        <div class="kpi-label">${esc(k.label)}</div>
        <div class="kpi-value">${esc(k.value)}</div>
        ${k.sparkline}
      </div>`,
      )
      .join("")}
  </section>

  <section class="split">
    <div class="stack">
      <div class="panel">
        <h2>Model mix</h2>
        ${modelMixBars(report)}
      </div>
      <div class="panel">
        <h2>Tool usage</h2>
        ${toolUsageBars(report)}
      </div>
    </div>
    <div class="panel">
      <h2>Health &amp; anomalies${anomalies.count ? ` (${anomalies.count})` : ""}</h2>
      ${anomalies.html}
    </div>
  </section>

  <section class="split">
    <div class="panel">
      <h2>Daily activity</h2>
      <p class="muted">Total token volume, ${history.length} day(s) backfilled from your full corpus.</p>
      ${heatmapGrid(heatmapSeries(history))}
    </div>
    <div class="panel">
      <h2>How you work</h2>
      <div class="stat-line"><span>Real prompts / automated</span><span>${fmtNum(report.promptPatterns.realPromptCount)} / ${fmtNum(report.promptPatterns.automatedMessageCount)}</span></div>
      <div class="stat-line"><span>Avg words per prompt</span><span>${report.promptPatterns.avgWordsPerPrompt.toFixed(0)}</span></div>
      <div class="stat-line"><span>Questions</span><span>${pct(report.promptPatterns.questionShare)}</span></div>
      <div class="stat-line"><span>Busiest weekday</span><span>${esc(busiestWeekday(report))}</span></div>
      <div class="stat-line"><span>Busiest hour</span><span>${esc(busiestHour(report))}</span></div>
    </div>
  </section>

  <section class="split">
    <div class="panel">
      <h2>Behavior &amp; automation</h2>
      <div class="stat-line"><span>Delegated calls (Agent)</span><span>${fmtNum(report.delegation.agentToolCalls)} across ${fmtNum(report.delegation.sidechainSessionCount)} sessions</span></div>
      <div class="stat-line"><span>Away-work summaries</span><span>${fmtNum(report.awayWork.awaySummaryCount)}</span></div>
      <div class="stat-line"><span>Scheduled wakeups</span><span>${fmtNum(report.awayWork.scheduleWakeupCount)}</span></div>
      <div class="stat-line"><span>Queue enqueues</span><span>${fmtNum(report.queueBacklog.enqueue ?? 0)}</span></div>
      ${slashCommandBars(report)}
    </div>
    <div class="panel">
      <h2>Context &amp; compaction</h2>
      <div class="stat-line"><span>Median retention after compaction</span><span>${pct(report.compactionRetention.medianRetainedFraction)}</span></div>
      <div class="stat-line"><span>Avg first-turn cache read</span><span>${fmtNum(report.contextOverhead.avgFirstTurnCacheRead)} tok</span></div>
      <div class="stat-line"><span>Stale-context sessions</span><span>${fmtNum(report.compaction.staleContextSessions.length)}</span></div>
      <div class="stat-line"><span>Tool error rate</span><span>${pct(report.governance.toolErrorRate)}</span></div>
      <h2 style="margin-top:1rem">File types read</h2>
      ${fileTypeBars(report)}
    </div>
  </section>

  <section class="panel">
    <h2>Other findings${rest.length ? ` (${rest.length})` : ""}</h2>
    ${rest.length ? `<div class="findings-grid">${rest.map(findingRowCompact).join("")}</div>` : `<p class="muted">Nothing else crossed a real threshold this run.</p>`}
  </section>

  <div class="footer">100% local. No telemetry, no network calls.</div>
</div>
</body>
</html>
`;
}
