import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import type { JsonReport } from "./shared.js";

function embed(value: unknown): string {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function buildTerminalReport(report: JsonReport, findings: OptimizationFinding[], history: DailySnapshot[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cc-utility</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0c0d;
    --panel: #0e1113;
    --raise: #12171a;
    --line: #1c2429;
    --line-soft: #151b1f;
    --fg: #d8dee9;
    --dim: #6b7580;
    --faint: #454e56;
    --good: #87d787;
    --warn: #ffd75f;
    --bad: #ff8787;
    --accent: #5fd7d7;
    --mag: #d7afff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); }
  body {
    color: var(--fg);
    font-family: "SFMono-Regular", "JetBrains Mono", "Menlo", "DejaVu Sans Mono", "Consolas", monospace;
    font-size: 13px; line-height: 1.5;
    padding: 1.2rem 1.2rem 4rem;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1120px; margin: 0 auto; }
  a { color: var(--accent); text-decoration: none; }

  .prompt { color: var(--dim); margin-bottom: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prompt .path { color: var(--accent); }
  .prompt .caret { color: var(--good); }
  .prompt .cmd { color: var(--fg); }
  .prompt .meta { color: var(--faint); }

  nav.tabs { display: flex; gap: 0.15rem; flex-wrap: wrap; margin-bottom: 1.1rem; border-bottom: 1px solid var(--line); }
  nav.tabs button {
    font: inherit; background: none; border: none; color: var(--dim);
    padding: 0.4rem 0.8rem; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  nav.tabs button:hover { color: var(--fg); }
  nav.tabs button[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
  nav.tabs button .badge { color: var(--bad); }

  .grid { display: grid; gap: 0.9rem; }
  .grid > * { min-width: 0; }
  .cols-2 { grid-template-columns: 1fr 1fr; }
  .cols-4 { grid-template-columns: repeat(4, 1fr); }
  .span-2 { grid-column: span 2; }
  @media (max-width: 760px) { .cols-2, .cols-4 { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } }

  .panel { border: 1px solid var(--line); border-radius: 4px; background: var(--panel); }
  .panel > .hd {
    color: var(--dim); font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase;
    padding: 0.5rem 0.8rem; border-bottom: 1px solid var(--line-soft); display: flex; justify-content: space-between; align-items: center;
  }
  .panel > .hd .n { color: var(--faint); }
  .panel > .bd { padding: 0.7rem 0.8rem; }

  .kpi { border: 1px solid var(--line); border-radius: 4px; background: var(--panel); padding: 0.7rem 0.85rem; }
  .kpi .k { color: var(--dim); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
  .kpi .v { color: #f2f5f8; font-size: 1.55rem; font-weight: 600; font-variant-numeric: tabular-nums; margin: 0.15rem 0; }
  .kpi .spark { color: var(--accent); font-size: 0.95rem; letter-spacing: -1px; white-space: nowrap; overflow: hidden; }
  .kpi .sub { color: var(--faint); font-size: 11px; }

  .bar { display: grid; grid-template-columns: 8.5rem 1fr auto; align-items: center; gap: 0.5rem; padding: 0.13rem 0; }
  .bar .lbl { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar .gauge { color: var(--accent); letter-spacing: -1px; white-space: nowrap; overflow: hidden; }
  .bar .val { color: var(--dim); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.28rem 0.5rem; border-bottom: 1px solid var(--line-soft); white-space: nowrap; }
  th { color: var(--dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; user-select: none; }
  th:hover { color: var(--fg); }
  th .ar { color: var(--accent); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.tool { color: var(--fg); }
  td.path { color: var(--dim); max-width: 24rem; overflow: hidden; text-overflow: ellipsis; }
  td.path span { display: block; overflow: hidden; text-overflow: ellipsis; }
  tr:last-child td { border-bottom: none; }
  .good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }

  .stat { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3rem 0; border-bottom: 1px solid var(--line-soft); }
  .stat:last-child { border-bottom: none; }
  .stat .s-k { color: var(--dim); } .stat .s-v { color: var(--fg); font-variant-numeric: tabular-nums; }

  .rl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; margin-bottom: 0.6rem; }
  @media (max-width: 620px) { .rl-grid { grid-template-columns: 1fr; } }
  .rl-win { border: 1px solid var(--line); border-radius: 4px; padding: 0.7rem 0.85rem; background: var(--raise); }
  .rl-name { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  .rl-pct { font-size: 1.9rem; font-weight: 650; font-variant-numeric: tabular-nums; margin: 0.15rem 0 0.3rem; }
  .rl-meta { color: var(--faint); font-size: 0.82rem; }
  .faint { color: var(--faint); }
  .trend { display: flex; align-items: flex-end; gap: 1px; height: 52px; width: 100%; }
  .trend span { flex: 1 1 0; min-width: 0; border-radius: 1px 1px 0 0; opacity: 0.85; }
  .heat-scroll { overflow-x: auto; padding-bottom: 2px; }
  .heat { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 12px; grid-template-rows: repeat(7, 12px); gap: 3px; }
  .heat i { width: 12px; height: 12px; border-radius: 2px; display: block; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03); }

  .filter { width: 100%; background: var(--raise); border: 1px solid var(--line); color: var(--fg); font: inherit;
    padding: 0.3rem 0.5rem; border-radius: 4px; margin-bottom: 0.5rem; }
  .filter:focus { outline: none; border-color: var(--accent); }
  .empty { color: var(--faint); padding: 0.4rem 0; }

  details.find { border-bottom: 1px solid var(--line-soft); padding: 0.4rem 0; }
  details.find:last-child { border-bottom: none; }
  details.find summary { cursor: pointer; list-style: none; display: flex; gap: 0.55rem; align-items: baseline; }
  details.find summary::-webkit-details-marker { display: none; }
  details.find .dot { flex-shrink: 0; }
  details.find pre { background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0.5rem 0.65rem;
    color: var(--dim); font-size: 11px; overflow-x: auto; margin: 0.4rem 0 0 1.1rem; white-space: pre-wrap; word-break: break-word; }
  details.find p { margin: 0.3rem 0 0 1.1rem; color: var(--dim); }

  .hero { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 4px; background: var(--panel);
    padding: 1rem 1.1rem; margin-bottom: 0.9rem; }
  .hero .hk { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; }
  .hero .hv { color: #f2f5f8; font-size: 1.3rem; margin-top: 0.2rem; }
  .hero .hv b { color: var(--accent); }

  .foot { color: var(--faint); font-size: 11px; margin-top: 1.4rem; text-align: center; }
  .view { display: none; } .view.on { display: block; }
</style>
</head>
<body>
<div class="wrap">
  <div class="prompt" id="prompt"></div>
  <nav class="tabs" id="tabs"></nav>
  <main id="main"></main>
  <div class="foot">100% local &middot; no telemetry, no network calls &middot; generated by cc-utility</div>
</div>
<script>
const REPORT = ${embed(report)};
const HISTORY = ${embed(history)};
const FINDINGS = ${embed(findings)};
${APP_JS}
</script>
</body>
</html>
`;
}

const APP_JS = String.raw`
"use strict";
const $ = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fnum = (n) => { n = Number(n) || 0; if (n >= 1e9) return (n/1e9).toFixed(1)+"B"; if (n >= 1e6) return (n/1e6).toFixed(1)+"M"; if (n >= 1e3) return (n/1e3).toFixed(1)+"K"; return String(Math.round(n)); };
const commas = (n) => (Number(n)||0).toLocaleString("en-US");
const pct = (f) => (Number(f)*100).toFixed(1)+"%";
const shortTool = (raw) => { const m = /^mcp__(.+?)__(.+)$/.exec(raw); return m ? m[1]+"."+m[2] : raw; };
const shortPath = (raw) => {
  const parts = String(raw).replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 3) return raw;
  return ".../" + parts.slice(-3).join("/");
};
function humanDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return d + "d " + h + "h";
  if (h) return h + "h " + m + "m";
  return m + "m";
}
function paceLabel(p) {
  if (p == null) return '<span class="faint">not enough data</span>';
  const cls = p > 15 ? "bad" : p < -15 ? "good" : "warn";
  const word = p > 15 ? "over pace" : p < -15 ? "under pace" : "on pace";
  return '<span class="' + cls + '">' + (p > 0 ? "+" : "") + p.toFixed(0) + "% " + word + "</span>";
}

const BLOCKS = [" ","▏","▎","▍","▌","▋","▊","▉","█"];
function gauge(frac, width) {
  frac = Math.max(0, Math.min(1, frac || 0));
  const cells = width * frac; const full = Math.floor(cells);
  let out = "█".repeat(full);
  const rem = Math.round((cells - full) * 8); if (rem > 0 && full < width) out += BLOCKS[rem];
  return out + "·".repeat(Math.max(0, width - out.length));
}
const SPARK = "▁▂▃▄▅▆▇█";
function spark(vals) {
  if (!vals.length) return "";
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  return vals.map((v) => SPARK[Math.min(7, Math.floor(((v - mn) / rng) * 7.999))]).join("");
}
function barTrend(vals, color) {
  if (!vals.length) return '<div class="empty">no data</div>';
  const max = Math.max(...vals, 0.0001);
  return '<div class="trend">' + vals.map((v) =>
    '<span style="height:' + Math.max(2, (v / max) * 100).toFixed(1) + "%;background:" + color + '"></span>').join("") + "</div>";
}

function topEntries(obj, n) { return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n); }
function bars(entries, valfmt) {
  if (!entries.length) return '<div class="empty">no data</div>';
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return entries.map(([k, v]) =>
    '<div class="bar"><span class="lbl">' + esc(shortTool(k)) + '</span><span class="gauge">' +
    gauge(v / max, 22) + '</span><span class="val">' + esc(valfmt(v)) + '</span></div>').join("");
}
function statRows(pairs) {
  return pairs.map(([k, v]) => '<div class="stat"><span class="s-k">' + esc(k) + '</span><span class="s-v">' + esc(v) + '</span></div>').join("");
}

function heatSeries() {
  return HISTORY.map((h) => ({ date: h.date, value: (h.totalInput||0)+(h.totalOutput||0)+(h.totalCacheRead||0)+(h.totalCacheCreation||0) }));
}
const HEAT_LVL = ["#1a2126", "#1f4a34", "#2c7d4c", "#46b567", "#87d787"];
function heatmap() {
  const data = heatSeries();
  if (!data.length) return '<div class="empty">not enough history yet</div>';
  const max = Math.max(...data.map((d) => d.value), 1);
  const byDate = new Map(data.map((d) => [d.date, d.value]));
  const dates = data.map((d) => new Date(d.date + "T00:00:00Z")).sort((a, b) => a - b);
  const start = new Date(dates[0]); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = dates[dates.length - 1];
  let cells = "";
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10); const v = byDate.get(ds) || 0;
    const lvl = v <= 0 ? 0 : 1 + Math.min(3, Math.floor((Math.log(1 + v) / Math.log(1 + max)) * 4));
    cells += '<i style="background:' + HEAT_LVL[lvl] + '" title="' + ds + ": " + fnum(v) + '"></i>';
  }
  return '<div class="heat-scroll"><div class="heat">' + cells + "</div></div>";
}

const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function busiest(hist, isHour) {
  const e = topEntries(hist, 1)[0]; if (!e) return "—";
  return isHour ? String(e[0]).padStart(2,"0") + ":00" : (WD[Number(e[0])] || e[0]);
}

function recentAnomalies() {
  const rw = REPORT.recentWindow;
  const useRecent = !!(rw && rw.toolFriction && rw.toolFriction.length);
  const src = useRecent ? rw.toolFriction : (REPORT.toolFriction || []);
  const label = useRecent ? "last " + rw.windowDays + "d" : "lifetime";
  const rows = src.filter((r) => r.errorRate >= 0.3).map((r) => ({
    tool: r.tool, rate: r.errorRate, errors: r.errors, results: r.results, last: r.lastSeenDate || "—",
  }));
  return { rows, label };
}

// ---- sortable table ----
function sortTable(rows, cols, state, opts) {
  const dir = state.dir || 1, key = state.key || cols[0].key;
  const sorted = [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  const head = cols.map((c) =>
    '<th class="' + (c.num ? "num" : "") + '" data-k="' + c.key + '">' + esc(c.label) +
    (c.key === key ? ' <span class="ar">' + (dir > 0 ? "↑" : "↓") + "</span>" : "") + "</th>").join("");
  const body = sorted.length ? sorted.map((r) => "<tr>" + cols.map((c) => {
    const raw = c.render ? c.render(r[c.key], r) : esc(r[c.key]);
    return '<td class="' + (c.cls ? c.cls(r) : (c.num ? "num" : "")) + '">' + raw + "</td>";
  }).join("") + "</tr>").join("") : '<tr><td colspan="' + cols.length + '" class="empty">' + (opts.empty || "no rows") + "</td></tr>";
  return "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
}
function mountTable(el, rows, cols, opts) {
  opts = opts || {}; const state = { key: opts.key || cols[0].key, dir: opts.dir || 1 };
  let filter = "";
  const draw = () => {
    const fr = filter ? rows.filter((r) => (opts.filterOn || []).some((k) => String(r[k]).toLowerCase().includes(filter))) : rows;
    el.querySelector(".tbl").innerHTML = sortTable(fr, cols, state, opts);
    el.querySelectorAll("th[data-k]").forEach((th) => th.onclick = () => {
      const k = th.dataset.k; if (state.key === k) state.dir *= -1; else { state.key = k; state.dir = th.classList.contains("num") ? -1 : 1; } draw();
    });
  };
  if (opts.filterOn) {
    const inp = $('<input class="filter" placeholder="' + (opts.placeholder || "filter…") + '">');
    inp.oninput = () => { filter = inp.value.trim().toLowerCase(); draw(); };
    el.appendChild(inp);
  }
  el.appendChild($('<div class="tbl"></div>'));
  draw();
}

function panel(title, n, inner) {
  return '<section class="panel"><div class="hd"><span>' + esc(title) + '</span>' +
    (n != null ? '<span class="n">' + esc(n) + "</span>" : "") + '</div><div class="bd">' + inner + "</div></section>";
}

function rateCls(r) { return r.rate >= 0.6 ? "num bad" : r.rate >= 0.4 ? "num warn" : "num good"; }
const ANOM_COLS = [
  { key: "tool", label: "tool", cls: () => "tool", render: (v) => esc(shortTool(v)) },
  { key: "rate", label: "fail", num: true, cls: rateCls, render: (v) => (v * 100).toFixed(0) + "%" },
  { key: "results", label: "n", num: true, render: (v, r) => r.errors + "/" + r.results },
  { key: "last", label: "last seen", render: (v) => esc(v) },
];

function heroInsight() {
  const td = REPORT.turnDuration || {};
  const hours = (td.medianMs && td.turnsCounted) ? (td.medianMs * td.turnsCounted) / 3.6e6 : 0;
  const anom = recentAnomalies();
  const worst = anom.rows[0];
  const cand = [];
  if (worst && worst.rate >= 0.5) cand.push([90 * worst.rate, "Your worst tool", '<b>' + esc(shortTool(worst.tool)) + '</b> is failing <b>' + (worst.rate*100).toFixed(0) + '%</b> of the time (' + worst.errors + "/" + worst.results + " calls, " + anom.label + ")."]);
  if (hours >= 1) cand.push([Math.min(80, hours), "Time spent waiting", 'You have spent about <b>' + hours.toFixed(0) + ' hours</b> waiting on turns to finish, across <b>' + commas(td.turnsCounted) + '</b> turns.']);
  const hit = (REPORT.tokens && REPORT.tokens.cacheHitRate) || 0;
  cand.push([hit * 60, "Cache efficiency", 'Your cache hit rate is <b>' + pct(hit) + '</b> across <b>' + fnum((REPORT.tokens||{}).totalCacheRead) + '</b> cached tokens read.']);
  cand.sort((a, b) => b[0] - a[0]);
  const [, k, v] = cand[0];
  return '<div class="hero"><div class="hk">' + k + '</div><div class="hv">' + v + "</div></div>";
}

function rateLimitPanel() {
  const rl = REPORT.rateLimitTrends;
  const q = REPORT.officialQuota;
  if ((!rl || !rl.snapshotsCounted) && !q) {
    return panel("rate limits & pace", null, '<div class="empty">No rate-limit history yet. Enable the pacekit statusline sidecar (writes ~/.cc-utility/sidecar-log.jsonl) and this fills in over time.</div>');
  }
  const qutil = (w) => (w && typeof w.utilization === "number" ? Math.round(w.utilization) : null);
  const wins = [
    { name: "5-hour", pct: rl ? rl.latestFiveHourPct : null, reset: rl ? rl.latestFiveHourResetSec : null, pace: rl ? rl.latestFiveHourPace : null,
      qpct: q ? qutil(q.five_hour) : null },
    { name: "7-day", pct: rl ? rl.latestSevenDayPct : null, reset: rl ? rl.latestSevenDayResetSec : null, pace: rl ? rl.latestSevenDayPace : null,
      qpct: q ? qutil(q.seven_day) : null },
  ].map((w) => ({ ...w, usage: w.qpct != null ? w.qpct : (w.pct == null ? null : w.pct) }));
  wins.sort((a, b) => (b.usage || 0) - (a.usage || 0));
  const blocks = wins.map((w) => {
    const u = w.usage == null ? null : Math.round(w.usage);
    const cls = u == null ? "faint" : u >= 80 ? "bad" : u >= 50 ? "warn" : "good";
    return '<div class="rl-win"><div class="rl-name">' + w.name + " window</div>" +
      '<div class="rl-pct ' + cls + '">' + (u == null ? "—" : u + "%") + "</div>" +
      '<div class="rl-meta">' + (w.reset != null ? "resets in " + humanDur(w.reset) : "reset unknown") +
      "</div><div class=\"rl-meta\">" + paceLabel(w.pace == null ? null : w.pace) + "</div></div>";
  }).join("");
  const foot = rl && rl.snapshotsCounted ? statRows([
    ["snapshots logged", commas(rl.snapshotsCounted)],
    ["80% threshold crossings", rl.thresholdCrossings.length ? String(rl.thresholdCrossings.length) : "none yet"],
    ["heaviest burn", (rl.busiestWeekday || "—") + (rl.busiestHourUtc != null ? " · " + String(rl.busiestHourUtc).padStart(2, "0") + ":00 utc" : "")],
  ]) : '<div class="sub" style="color:var(--faint);margin-top:.5rem">Live quota from --quota; enable the sidecar for pace trends over time.</div>';
  return panel("rate limits & pace", rl && rl.snapshotsCounted ? commas(rl.snapshotsCounted) + " snaps" : "live", '<div class="rl-grid">' + blocks + "</div>" + foot);
}

// ---- views ----
const VIEWS = {
  overview() {
    const t = REPORT.tokens || {}, pp = REPORT.promptPatterns || {};
    const hp = HISTORY.map((h) => (h.totalInput||0)+(h.totalOutput||0));
    const cache = HISTORY.map((h) => h.cacheHitRate || 0);
    const waits = HISTORY.map((h) => h.turnDurationMedianMs || 0);
    const kpis = [
      ["tokens processed", fnum((t.totalInput||0)+(t.totalOutput||0)+(t.totalCacheRead||0)+(t.totalCacheCreation||0)), spark(hp), commas(t.totalInput) + " in / " + commas(t.totalOutput) + " out"],
      ["sessions scanned", commas(REPORT.sessionsScanned), spark(hp), HISTORY.length + " days of history"],
      ["cache hit rate", pct(t.cacheHitRate || 0), spark(cache), fnum(t.totalCacheRead) + " cached read"],
      ["median turn wait", ((REPORT.turnDuration||{}).medianMs/1000||0).toFixed(1) + "s", spark(waits), "p95 " + (((REPORT.turnDuration||{}).p95Ms/1000)||0).toFixed(1) + "s"],
    ];
    const anom = recentAnomalies();
    const kpiHtml = kpis.map(([k, v, s, sub]) =>
      '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="spark">' + s + '</div><div class="sub">' + esc(sub) + "</div></div>").join("");
    const grid = document.createElement("div");
    grid.innerHTML =
      heroInsight() +
      '<div class="grid cols-4" style="margin-bottom:0.9rem">' + kpiHtml + "</div>" +
      '<div class="grid cols-2" style="margin-bottom:0.9rem">' +
        '<div class="span-2">' + panel("daily activity", HISTORY.length + "d", heatmap()) + "</div>" +
      "</div>" +
      '<div class="grid cols-2" style="margin-bottom:0.9rem">' +
        panel("model mix", null, bars(topEntries(REPORT.modelMix, 6), (v) => fnum(v) + " turns")) +
        panel("tool usage", null, bars(topEntries(REPORT.toolCalls, 8), (v) => fnum(v))) +
      "</div>" +
      '<div class="grid cols-2">' +
        '<div id="ov-anom"></div>' +
        panel("how you work", null, statRows([
          ["real / automated prompts", commas(pp.realPromptCount) + " / " + commas(pp.automatedMessageCount)],
          ["avg words per prompt", (pp.avgWordsPerPrompt||0).toFixed(0)],
          ["questions", pct(pp.questionShare||0)],
          ["busiest weekday", busiest(pp.weekdayHistogram, false)],
          ["busiest hour (utc)", busiest(pp.hourHistogram, true)],
        ])) +
      "</div>";
    const ap = $('<section class="panel"><div class="hd"><span>health & anomalies</span><span class="n">' + (anom.rows.length || "clear") + '</span></div><div class="bd"><div class="mt"></div></div></section>');
    grid.querySelector("#ov-anom").replaceWith(ap);
    mountTable(ap.querySelector(".mt"), anom.rows, ANOM_COLS, { key: "rate", dir: -1, empty: "no tool crossed the friction threshold (" + anom.label + ")" });
    return grid;
  },

  health() {
    const anom = recentAnomalies();
    const rest = FINDINGS.filter((f) => !f.id.startsWith("tool-friction:"));
    const wrap = document.createElement("div");
    wrap.className = "grid";
    const ap = $(panelEl("tool friction", anom.rows.length || "clear"));
    mountTable(ap.querySelector(".bd"), anom.rows, ANOM_COLS, { key: "rate", dir: -1, filterOn: ["tool"], placeholder: "filter tools…", empty: "no friction (" + anom.label + ")" });
    wrap.appendChild(ap);
    const findEl = $(panelEl("other findings", rest.length || "0"));
    findEl.querySelector(".bd").innerHTML = rest.length ? rest.map((f) => {
      const dot = f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : "good";
      return '<details class="find"><summary><span class="dot ' + dot + '">●</span><span>' + esc(f.headline) + '</span></summary>' +
        "<p>" + esc(f.detail) + '</p><pre>' + esc(JSON.stringify(f.evidence, null, 2)) + "</pre></details>";
    }).join("") : '<div class="empty">nothing else crossed a threshold this run.</div>';
    wrap.appendChild(findEl);
    return wrap;
  },

  behavior() {
    const pp = REPORT.promptPatterns || {}, g = REPORT.governance || {};
    const errSeries = HISTORY.map((h) => (h.toolErrorRate || 0) * 100);
    const wrap = document.createElement("div"); wrap.className = "grid cols-2";
    wrap.innerHTML =
      panel("usage patterns", null, statRows([
        ["real prompts", commas(pp.realPromptCount)],
        ["automated messages", commas(pp.automatedMessageCount)],
        ["avg words / prompt", (pp.avgWordsPerPrompt||0).toFixed(1)],
        ["questions / exclaims", pct(pp.questionShare||0) + " / " + pct(pp.exclaimShare||0)],
        ["ALL-CAPS prompts", commas(pp.allCapsCount)],
        ["interrupts", commas(g.interruptCount)],
        ["tool error rate", pct(g.toolErrorRate||0)],
      ])) +
      panel("tool error rate over time", HISTORY.length + "d", barTrend(errSeries, "var(--bad)") + '<div class="sub" style="color:var(--faint);margin-top:.4rem">' + (errSeries.length ? errSeries[errSeries.length-1].toFixed(1) + "% latest" : "no data") + "</div>") +
      panel("slash commands typed", null, bars(topEntries(REPORT.slashCommandsTyped, 10), (v) => fnum(v))) +
      panel("skills invoked by model", null, bars(topEntries(REPORT.skillsInvokedByModel, 10), (v) => fnum(v)));
    return wrap;
  },

  footprint() {
    const wsRows = topEntries(REPORT.workspaces, 20).map(([path, sessions]) => ({ path, dir: shortPath(path), sessions }));
    const wrap = document.createElement("div"); wrap.className = "grid cols-2";
    wrap.innerHTML =
      panel("file types read", null, bars(topEntries(REPORT.fileExtensionsRead, 8), (v) => fnum(v))) +
      panel("edit blast radius", null, statRows([
        ["distinct workspaces", commas(REPORT.workspaceCount)],
        ["snapshots", commas((REPORT.editBlastRadius||{}).snapshotCount)],
        ["avg files / snapshot", ((REPORT.editBlastRadius||{}).avgTrackedFilesPerSnapshot||0).toFixed(1)],
        ["max files / snapshot", commas((REPORT.editBlastRadius||{}).maxTrackedFilesPerSnapshot)],
      ]));
    const ws = $(panelEl("workspaces", REPORT.workspaceCount || "0"));
    mountTable(ws.querySelector(".bd"), wsRows,
      [{ key: "dir", label: "directory", cls: () => "path", render: (v, r) => '<span title="' + esc(r.path) + '">' + esc(v) + "</span>" },
       { key: "sessions", label: "sessions", num: true, render: (v) => commas(v) }],
      { key: "sessions", dir: -1, filterOn: ["path"], placeholder: "filter directories…", empty: "no directories recorded" });
    const pathCol = { key: "path", label: "path", cls: () => "path", render: (v) => '<span title="' + esc(v) + '">' + esc(shortPath(v)) + "</span>" };
    const cmd = $(panelEl("CLAUDE.md files", null));
    mountTable(cmd.querySelector(".bd"), topEntries(REPORT.claudeMdFiles, 20).map(([path, tokens]) => ({ path, tokens })),
      [pathCol, { key: "tokens", label: "tokens", num: true, render: (v) => fnum(v) }],
      { key: "tokens", dir: -1, filterOn: ["path"], placeholder: "filter paths…", empty: "no CLAUDE.md files" });
    const hot = $(panelEl("hottest files", null));
    mountTable(hot.querySelector(".bd"), topEntries((REPORT.editBlastRadius||{}).hottestFiles, 20).map(([path, touches]) => ({ path, touches })),
      [pathCol, { key: "touches", label: "touches", num: true, render: (v) => commas(v) }],
      { key: "touches", dir: -1, filterOn: ["path"], placeholder: "filter paths…", empty: "no file-history snapshots" });
    const holder = document.createElement("div"); holder.className = "grid";
    holder.appendChild(wrap);
    holder.appendChild(ws);
    const bottom = document.createElement("div"); bottom.className = "grid cols-2";
    bottom.appendChild(cmd); bottom.appendChild(hot); holder.appendChild(bottom);
    return holder;
  },

  automation() {
    const d = REPORT.delegation || {}, aw = REPORT.awayWork || {}, cr = REPORT.compactionRetention || {}, co = REPORT.contextOverhead || {}, cp = REPORT.compaction || {};
    const holder = document.createElement("div"); holder.className = "grid";
    holder.innerHTML = rateLimitPanel();
    const wrap = document.createElement("div"); wrap.className = "grid cols-2";
    wrap.innerHTML =
      panel("delegation & away-work", null, statRows([
        ["agent (delegated) calls", commas(d.agentToolCalls)],
        ["sidechain sessions", commas(d.sidechainSessionCount)],
        ["away-work summaries", commas(aw.awaySummaryCount)],
        ["scheduled task fires", commas(aw.scheduledTaskFireCount)],
        ["schedule wakeups", commas(aw.scheduleWakeupCount)],
        ["median wakeup delay", (aw.medianWakeupDelaySeconds ? humanDur(aw.medianWakeupDelaySeconds) : "—")],
        ["queue enqueues", commas((REPORT.queueBacklog||{}).enqueue || 0)],
      ])) +
      panel("context & compaction", null, statRows([
        ["median retention after compaction", pct(cr.medianRetainedFraction||0)],
        ["compactions measured", commas(cr.compactionsWithRatio)],
        ["avg first-turn cache read", fnum(co.avgFirstTurnCacheRead) + " tok"],
        ["max first-turn cache read", fnum(co.maxFirstTurnCacheRead) + " tok"],
        ["stale-context sessions", commas((cp.staleContextSessions||[]).length)],
      ]));
    holder.appendChild(wrap);
    return holder;
  },
};
function panelEl(title, n) {
  return '<section class="panel"><div class="hd"><span>' + esc(title) + '</span>' + (n != null ? '<span class="n">' + esc(n) + "</span>" : "") + '</div><div class="bd"></div></section>';
}

const TABS = [
  ["overview", "overview"], ["health", "health & anomalies"], ["behavior", "behavior"],
  ["footprint", "workspace footprint"], ["automation", "automation"],
];
function render() {
  const anomN = recentAnomalies().rows.length;
  const promptEl = document.getElementById("prompt");
  promptEl.innerHTML = '<span class="path">~/.claude</span> <span class="caret">❯</span> <span class="cmd">cc-utility --report</span>  ' +
    '<span class="meta"># ' + commas(REPORT.sessionsScanned) + " sessions · " + HISTORY.length + " days · 100% local</span>";
  const nav = document.getElementById("tabs"); nav.innerHTML = "";
  const main = document.getElementById("main");
  const show = (id) => {
    [...nav.children].forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
    main.innerHTML = ""; main.appendChild(VIEWS[id]());
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  };
  TABS.forEach(([id, label]) => {
    const b = document.createElement("button"); b.dataset.id = id;
    b.innerHTML = esc(label) + (id === "health" && anomN ? ' <span class="badge">(' + anomN + ")</span>" : "");
    b.onclick = () => show(id); nav.appendChild(b);
  });
  const start = TABS.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  show(start);
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (TABS.some(([t]) => t === id)) show(id);
  });
}
render();
`;
