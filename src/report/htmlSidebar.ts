import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import { heatmapGrid, lineChart } from "./charts.js";
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

function claudeMdRows(report: JsonReport): string {
  const entries = Object.entries(report.claudeMdFiles).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) return `<p class="muted">No CLAUDE.md files discovered.</p>`;
  return `<table class="plain-table"><tbody>${entries
    .map(([path, tokens]) => `<tr><td class="path">${esc(path)}</td><td class="num">${fmtNum(tokens)} tok</td></tr>`)
    .join("")}</tbody></table>`;
}

function hotFileRows(report: JsonReport): string {
  const entries = Object.entries(report.editBlastRadius.hottestFiles).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) return `<p class="muted">No file-history snapshots recorded.</p>`;
  return `<table class="plain-table"><tbody>${entries
    .map(([path, count]) => `<tr><td class="path">${esc(path)}</td><td class="num">${fmtNum(count)} touches</td></tr>`)
    .join("")}</tbody></table>`;
}

export function buildSidebarReport(report: JsonReport, findings: OptimizationFinding[], history: DailySnapshot[]): string {
  const kpis = buildKpis(report, history);
  const anomalies = anomalyRows(report);
  const rest = otherFindings(findings);
  const dates = history.map((h) => h.date);
  const errorRateSeries = history.map((h) => h.toolErrorRate * 100);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cc-utility — sidebar</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0b0d10; color: #e7e9ec;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .tab-radio { display: none; }

  .shell { display: flex; min-height: 100vh; }
  .sidebar {
    width: 240px; flex-shrink: 0; background: #0b0d10; border-right: 1px solid #21252c;
    padding: 1.5rem 1rem; position: sticky; top: 0; align-self: flex-start; height: 100vh;
  }
  .brand { color: #6b7280; font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 1.5rem; padding: 0 0.5rem; }
  .nav-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.55rem 0.7rem; border-radius: 8px; color: #9aa1ab; font-size: 0.86rem;
    cursor: pointer; margin-bottom: 0.15rem;
  }
  .nav-item:hover { background: #14171c; color: #d6dae1; }
  .count { font-size: 0.72rem; background: #21252c; color: #b6bcc6; padding: 0.05rem 0.4rem; border-radius: 10px; }

  .stage { flex: 1; padding: 2rem 2.5rem 4rem; max-width: 980px; }
  .panel-view { display: none; }

  .panel { background: #14171c; border: 1px solid #21252c; border-radius: 12px; padding: 1.3rem 1.5rem; margin-bottom: 1.1rem; }
  .panel h2 { margin: 0 0 0.9rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #8a92a0; }
  .muted { color: #7d8590; font-size: 0.82rem; margin: 0 0 0.8rem; }

  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.1rem; }
  .kpi { background: #14171c; border: 1px solid #21252c; border-radius: 12px; padding: 1.1rem 1.3rem; }
  .kpi-label { font-size: 0.75rem; color: #8a92a0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
  .kpi-value { font-size: 1.7rem; font-weight: 650; color: #f4f5f7; font-variant-numeric: tabular-nums; margin-bottom: 0.4rem; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; }

  .bar-row { display: grid; grid-template-columns: 1fr 3fr auto; align-items: center; gap: 0.6rem; margin: 0.4rem 0; font-size: 0.82rem; }
  .bar-label { color: #b6bcc6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { background: #21252c; border-radius: 5px; height: 8px; overflow: hidden; }
  .bar-fill { background: linear-gradient(90deg, #5b8cff, #8f5bff); height: 100%; border-radius: 5px; }
  .bar-value { color: #7d8590; font-variant-numeric: tabular-nums; }

  .anomaly-table, .plain-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .anomaly-table th, .plain-table th { text-align: left; color: #7d8590; font-weight: 500; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.35rem 0.3rem; border-bottom: 1px solid #21252c; }
  .anomaly-table td, .plain-table td { padding: 0.4rem 0.3rem; border-bottom: 1px solid #1a1e24; }
  .path { color: #b6bcc6; font-family: ui-monospace, monospace; font-size: 0.78rem; }
  .tool-name { color: #c3c8d1; }
  .num { font-variant-numeric: tabular-nums; text-align: right; }
  .sev-high { color: #e05a5a; font-weight: 700; }
  .sev-medium { color: #e0b04a; font-weight: 700; }
  .sev-low { color: #6b9bff; font-weight: 700; }

  .stat-line { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.4rem 0; border-bottom: 1px solid #1a1e24; color: #c3c8d1; }
  .stat-line:last-child { border-bottom: none; }
  .stat-line span:last-child { color: #f4f5f7; font-variant-numeric: tabular-nums; }

  details.finding-compact { border-top: 1px solid #1a1e24; padding: 0.5rem 0; }
  details.finding-compact:first-of-type { border-top: none; }
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

  /* pure-CSS tabs: radios precede .shell so the general sibling combinator reaches into it */
  #tab-overview:checked ~ .shell .panel-overview,
  #tab-health:checked ~ .shell .panel-health,
  #tab-behavior:checked ~ .shell .panel-behavior,
  #tab-footprint:checked ~ .shell .panel-footprint,
  #tab-automation:checked ~ .shell .panel-automation { display: block; }

  #tab-overview:checked ~ .shell .sidebar label[for="tab-overview"],
  #tab-health:checked ~ .shell .sidebar label[for="tab-health"],
  #tab-behavior:checked ~ .shell .sidebar label[for="tab-behavior"],
  #tab-footprint:checked ~ .shell .sidebar label[for="tab-footprint"],
  #tab-automation:checked ~ .shell .sidebar label[for="tab-automation"] { background: #14171c; color: #f4f5f7; }
</style>
</head>
<body>
  <input type="radio" name="tab" id="tab-overview" class="tab-radio" checked>
  <input type="radio" name="tab" id="tab-health" class="tab-radio">
  <input type="radio" name="tab" id="tab-behavior" class="tab-radio">
  <input type="radio" name="tab" id="tab-footprint" class="tab-radio">
  <input type="radio" name="tab" id="tab-automation" class="tab-radio">

  <div class="shell">
    <nav class="sidebar">
      <div class="brand">cc-utility</div>
      <label class="nav-item" for="tab-overview">Overview</label>
      <label class="nav-item" for="tab-health">Health &amp; anomalies <span class="count">${anomalies.count + rest.length}</span></label>
      <label class="nav-item" for="tab-behavior">Behavior</label>
      <label class="nav-item" for="tab-footprint">Workspace footprint</label>
      <label class="nav-item" for="tab-automation">Automation</label>
    </nav>

    <main class="stage">
      <section class="panel-view panel-overview">
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
        <div class="panel">
          <h2>Daily activity</h2>
          <p class="muted">Total token volume, ${history.length} day(s) backfilled from your full corpus.</p>
          ${heatmapGrid(heatmapSeries(history))}
        </div>
        <div class="grid2">
          <div class="panel">
            <h2>Model mix</h2>
            ${modelMixBars(report)}
          </div>
          <div class="panel">
            <h2>Tool usage</h2>
            ${toolUsageBars(report)}
          </div>
        </div>
      </section>

      <section class="panel-view panel-health">
        <div class="panel">
          <h2>Tool reliability${anomalies.count ? ` (${anomalies.count})` : ""}</h2>
          ${anomalies.html}
        </div>
        <div class="panel">
          <h2>Other findings${rest.length ? ` (${rest.length})` : ""}</h2>
          ${rest.length ? rest.map(findingRowCompact).join("") : `<p class="muted">Nothing else crossed a real threshold this run.</p>`}
        </div>
      </section>

      <section class="panel-view panel-behavior">
        <div class="panel">
          <h2>Usage patterns</h2>
          <div class="stat-line"><span>Real prompts / automated</span><span>${fmtNum(report.promptPatterns.realPromptCount)} / ${fmtNum(report.promptPatterns.automatedMessageCount)}</span></div>
          <div class="stat-line"><span>Avg words per prompt</span><span>${report.promptPatterns.avgWordsPerPrompt.toFixed(0)}</span></div>
          <div class="stat-line"><span>Questions</span><span>${pct(report.promptPatterns.questionShare)}</span></div>
          <div class="stat-line"><span>Busiest weekday</span><span>${esc(busiestWeekday(report))}</span></div>
          <div class="stat-line"><span>Busiest hour</span><span>${esc(busiestHour(report))}</span></div>
        </div>
        <div class="panel">
          <h2>Tool error rate over time</h2>
          ${lineChart(errorRateSeries, dates, { color: "#e05a5a" })}
        </div>
        <div class="panel">
          <h2>Slash commands typed</h2>
          ${slashCommandBars(report)}
        </div>
      </section>

      <section class="panel-view panel-footprint">
        <div class="panel">
          <h2>File types read</h2>
          ${fileTypeBars(report)}
        </div>
        <div class="panel">
          <h2>CLAUDE.md files (largest first)</h2>
          ${claudeMdRows(report)}
        </div>
        <div class="panel">
          <h2>Hottest files (edit blast radius)</h2>
          ${hotFileRows(report)}
        </div>
      </section>

      <section class="panel-view panel-automation">
        <div class="panel">
          <h2>Delegation &amp; away-work</h2>
          <div class="stat-line"><span>Delegated calls (Agent)</span><span>${fmtNum(report.delegation.agentToolCalls)} across ${fmtNum(report.delegation.sidechainSessionCount)} sessions</span></div>
          <div class="stat-line"><span>Away-work summaries</span><span>${fmtNum(report.awayWork.awaySummaryCount)}</span></div>
          <div class="stat-line"><span>Scheduled wakeups</span><span>${fmtNum(report.awayWork.scheduleWakeupCount)}</span></div>
          <div class="stat-line"><span>Median wakeup delay</span><span>${(report.awayWork.medianWakeupDelaySeconds / 60).toFixed(0)}min</span></div>
        </div>
        <div class="panel">
          <h2>Context &amp; compaction</h2>
          <div class="stat-line"><span>Median retention after compaction</span><span>${pct(report.compactionRetention.medianRetainedFraction)}</span></div>
          <div class="stat-line"><span>Avg first-turn cache read</span><span>${fmtNum(report.contextOverhead.avgFirstTurnCacheRead)} tok</span></div>
          <div class="stat-line"><span>Stale-context sessions</span><span>${fmtNum(report.compaction.staleContextSessions.length)}</span></div>
          <div class="stat-line"><span>Queue enqueues</span><span>${fmtNum(report.queueBacklog.enqueue ?? 0)}</span></div>
        </div>
      </section>
    </main>
  </div>
</body>
</html>
`;
}
