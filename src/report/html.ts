import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import { heatmapGrid, lineChart, sortedBarPlot, fmtCompact } from "./charts.js";

type JsonReport = ReturnType<typeof import("./json.js").buildJsonReport>;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function severityBadge(sev: OptimizationFinding["severity"]): string {
  const cls = sev === "high" ? "sev-high" : sev === "medium" ? "sev-medium" : "sev-low";
  return `<span class="sev ${cls}">${sev}</span>`;
}

function evidenceBlock(evidence: Record<string, unknown>): string {
  return `<pre class="evidence">${esc(JSON.stringify(evidence, null, 2))}</pre>`;
}

function findingRow(f: OptimizationFinding): string {
  return `
    <details class="finding">
      <summary>
        ${severityBadge(f.severity)}
        <span class="finding-headline">${esc(f.headline)}</span>
      </summary>
      <div class="finding-body">
        <p>${esc(f.detail)}</p>
        ${evidenceBlock(f.evidence)}
      </div>
    </details>`;
}

function optimizationSection(findings: OptimizationFinding[]): string {
  if (!findings.length) {
    return `<section class="panel"><h2>Optimization opportunities</h2><p class="muted">Nothing crossed a real threshold in this run. Full stats below.</p></section>`;
  }
  return `
    <section class="panel">
      <h2>Optimization opportunities</h2>
      <p class="muted">Ranked by severity. Click any row for the exact numbers behind it.</p>
      ${findings.map(findingRow).join("")}
    </section>`;
}

function historySection(history: DailySnapshot[]): string {
  if (history.length < 2) {
    return `
      <section class="panel">
        <h2>History</h2>
        <p class="muted">History builds up the more you run cc-utility. ${history.length === 1 ? "1 day logged so far." : "No days logged yet."}</p>
      </section>`;
  }

  const dates = history.map((h) => h.date);
  const heatmapData = history.map((h) => ({ date: h.date, value: h.totalInput + h.totalOutput + h.totalCacheRead + h.totalCacheCreation }));

  const cacheHitSeries = history.map((h) => h.cacheHitRate * 100);
  const errorRateSeries = history.map((h) => h.toolErrorRate * 100);
  const turnMedianSeries = history.map((h) => h.turnDurationMedianMs / 1000);

  const tableRows = [...history]
    .slice(-14)
    .reverse()
    .map(
      (h) => `
      <tr>
        <td>${esc(h.date)}</td>
        <td>${fmtCompact(h.totalInput + h.totalOutput)}</td>
        <td>${pct(h.cacheHitRate)}</td>
        <td>${pct(h.toolErrorRate)}</td>
        <td>${(h.turnDurationMedianMs / 1000).toFixed(0)}s</td>
        <td>${fmtNum(h.agentToolCalls)}</td>
      </tr>`,
    )
    .join("");

  return `
    <section class="panel">
      <h2>Daily activity</h2>
      <p class="muted">Total token volume per day, ${history.length} day(s) logged.</p>
      ${heatmapGrid(heatmapData)}
    </section>

    <section class="grid">
      <div class="card">
        <h2>Cache hit rate</h2>
        ${lineChart(cacheHitSeries, dates, { color: "#5b8cff" })}
      </div>
      <div class="card">
        <h2>Tool error rate</h2>
        ${lineChart(errorRateSeries, dates, { color: "#e05a5a" })}
      </div>
      <div class="card">
        <h2>Median turn wait (s)</h2>
        ${lineChart(turnMedianSeries, dates, { color: "#8f5bff" })}
      </div>
    </section>

    <section class="panel">
      <h2>Recent days</h2>
      <table>
        <thead><tr><th>Date</th><th>Tokens</th><th>Cache hit</th><th>Tool errors</th><th>Median wait</th><th>Delegations</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </section>`;
}

export function buildHtmlReport(report: JsonReport, findings: OptimizationFinding[], history: DailySnapshot[]): string {
  const modelBars = sortedBarPlot(
    Object.entries(report.modelMix)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, value: fmtNum(count), share: count })),
  );
  const toolBars = sortedBarPlot(
    Object.entries(report.toolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ label, value: fmtNum(count), share: count })),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cc-utility report</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.5rem 4rem;
    background: #0b0d10; color: #e7e9ec;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; align-items: center;
  }
  .page { width: 100%; max-width: 920px; }
  header { text-align: center; margin-bottom: 2rem; }
  .brand { color: #6b7280; font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .subtitle { color: #9aa1ab; font-size: 0.9rem; margin-top: 0.4rem; }

  .panel { background: #14171c; border: 1px solid #21252c; border-radius: 12px; padding: 1.4rem 1.6rem; margin-bottom: 1.25rem; }
  .panel h2 { margin: 0 0 0.4rem; font-size: 1rem; color: #f4f5f7; }
  .muted { color: #7d8590; font-size: 0.85rem; margin: 0 0 1rem; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem; margin-bottom: 1.25rem; }
  .card { background: #14171c; border: 1px solid #21252c; border-radius: 12px; padding: 1.25rem 1.4rem; }
  .card h2 { margin: 0 0 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: #8a92a0; }

  details.finding { border-top: 1px solid #21252c; padding: 0.7rem 0; }
  details.finding:first-of-type { border-top: none; }
  details.finding summary { cursor: pointer; display: flex; align-items: center; gap: 0.6rem; list-style: none; }
  details.finding summary::-webkit-details-marker { display: none; }
  details.finding summary::before { content: "\\25B8"; color: #6b7280; }
  details.finding[open] summary::before { content: "\\25BE"; }
  .finding-headline { font-weight: 600; color: #f4f5f7; }
  .finding-body { margin-top: 0.6rem; padding-left: 1.4rem; }
  .finding-body p { margin: 0 0 0.6rem; color: #b6bcc6; font-size: 0.9rem; }

  .sev { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.1rem 0.45rem; border-radius: 4px; font-weight: 700; }
  .sev-high { background: #3a1414; color: #e05a5a; }
  .sev-medium { background: #3a2f14; color: #e0b04a; }
  .sev-low { background: #14203a; color: #6b9bff; }

  .evidence { background: #0b0d10; border: 1px solid #21252c; border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.78rem; color: #9aa7b5; overflow-x: auto; }

  .bar-row { display: grid; grid-template-columns: 1fr 3fr auto; align-items: center; gap: 0.6rem; margin: 0.4rem 0; font-size: 0.82rem; }
  .bar-label { color: #b6bcc6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { background: #21252c; border-radius: 5px; height: 8px; overflow: hidden; }
  .bar-fill { background: linear-gradient(90deg, #5b8cff, #8f5bff); height: 100%; border-radius: 5px; }
  .bar-value { color: #7d8590; font-variant-numeric: tabular-nums; }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: #7d8590; font-weight: 500; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.4rem 0.3rem; border-bottom: 1px solid #21252c; }
  td { padding: 0.4rem 0.3rem; border-bottom: 1px solid #21252c; color: #c3c8d1; }

  .chart-line { display: block; }
  .chart-heatmap { display: block; }
  .chart-axis-label { fill: #7d8590; font-size: 9px; }
  .chart-empty { color: #565c66; font-size: 0.85rem; padding: 1rem 0; }

  .footer { text-align: center; margin-top: 2rem; color: #565c66; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="page">
  <header>
    <div class="brand">cc-utility</div>
    <div class="subtitle">${fmtNum(report.sessionsScanned)} sessions scanned &middot; ${fmtNum(report.filesProcessed)} files</div>
  </header>

  ${optimizationSection(findings)}
  ${historySection(history)}

  <section class="grid">
    <div class="card">
      <h2>Model mix</h2>
      ${modelBars}
    </div>
    <div class="card">
      <h2>Tool calls</h2>
      ${toolBars}
    </div>
  </section>

  <div class="footer">100% local. No telemetry, no network calls.</div>
</div>
</body>
</html>
`;
}
