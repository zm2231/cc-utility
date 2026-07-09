import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import { esc, pct, fmtNum, type JsonReport } from "./shared.js";
import { fmtCompact, shortToolName } from "./charts.js";

interface StatTile {
  label: string;
  value: string;
  sub?: string;
}

function tile(t: StatTile): string {
  return `<div class="tile"><div class="tile-value">${esc(t.value)}</div><div class="tile-label">${esc(t.label)}</div>${t.sub ? `<div class="tile-sub">${esc(t.sub)}</div>` : ""}</div>`;
}

function barList(rows: Array<{ label: string; value: string; share: number }>, cap = 6): string {
  if (!rows.length) return `<p class="empty">No data.</p>`;
  const max = Math.max(...rows.map((r) => r.share), 1e-9);
  const visible = rows.slice(0, cap);
  const rest = rows.slice(cap);
  const render = (list: typeof rows) =>
    list
      .map(
        (r) => `
      <div class="bar-row">
        <div class="bar-label" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${((r.share / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-value">${esc(r.value)}</div>
      </div>`,
      )
      .join("");
  return render(visible) + (rest.length ? `<details class="more"><summary>${rest.length} more</summary>${render(rest)}</details>` : "");
}

function table(headers: string[], rows: string[][], numericCols: Set<number>, cap = 6): string {
  if (!rows.length) return `<p class="empty">Nothing recorded.</p>`;
  const head = headers.map((h, i) => `<th${numericCols.has(i) ? ' class="num"' : ""}>${esc(h)}</th>`).join("");
  const body = (list: string[][]) =>
    list
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td${numericCols.has(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`,
      )
      .join("");
  const visible = rows.slice(0, cap);
  const rest = rows.slice(cap);
  return `<table><thead><tr>${head}</tr></thead><tbody>${body(visible)}</tbody></table>${
    rest.length
      ? `<details class="more"><summary>${rest.length} more</summary><table><tbody>${body(rest)}</tbody></table></details>`
      : ""
  }`;
}

function findingsSection(findings: OptimizationFinding[]): string {
  if (!findings.length) {
    return `<section class="lead"><h2>Optimizations</h2><p class="empty">Nothing crossed a threshold. Your harness looks healthy.</p></section>`;
  }
  const row = (f: OptimizationFinding) => `
      <details class="finding">
        <summary><span class="dot dot-${f.severity}"></span><span>${esc(f.headline)}</span></summary>
        <div class="finding-body"><p>${esc(f.detail)}</p><pre>${esc(JSON.stringify(f.evidence, null, 2))}</pre></div>
      </details>`;
  const top = findings.slice(0, 3).map(row).join("");
  const rest = findings.slice(3).map(row).join("");
  return `<section class="lead">
    <h2>Optimizations <span class="count-pill">${findings.length}</span></h2>
    <p class="lede">Ranked improvements to your harness, biggest measured impact first. Open one for evidence.</p>
    ${top}
    ${rest ? `<details class="more"><summary>View all ${findings.length} optimizations</summary>${rest}</details>` : ""}
  </section>`;
}

function lineChart(
  series: Array<{ name: string; dashed?: boolean; points: Array<{ x: string; y: number }> }>,
  opts: { height?: number; unit?: string } = {},
): string {
  const height = opts.height ?? 170;
  const width = 720;
  const pad = { l: 44, r: 12, t: 10, b: 22 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return `<p class="empty">Not enough history yet.</p>`;

  const xs = [...new Set(all.map((p) => p.x))].sort();
  const xIndex = new Map(xs.map((x, i) => [x, i]));
  const maxY = Math.max(...all.map((p) => p.y), 1e-9);
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const px = (x: string) => pad.l + ((xIndex.get(x) ?? 0) / Math.max(1, xs.length - 1)) * plotW;
  const py = (y: number) => pad.t + plotH - (y / maxY) * plotH;

  const grid = [0.5, 1]
    .map((f) => {
      const y = py(maxY * f);
      return `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" class="grid" /><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" class="axis">${esc(fmtCompact(maxY * f))}</text>`;
    })
    .join("");

  const paths = series
    .map((s) => {
      const pts = s.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
      return `<polyline points="${pts}" class="line${s.dashed ? " dashed" : ""}" />`;
    })
    .join("");

  const legend =
    series.length >= 2
      ? `<div class="legend">${series
          .map((s) => `<span class="legend-item"><span class="swatch${s.dashed ? " dashed" : ""}"></span>${esc(s.name)}</span>`)
          .join("")}</div>`
      : "";

  const data = esc(
    JSON.stringify({
      xs,
      unit: opts.unit ?? "",
      series: series.map((s) => ({ name: s.name, ys: xs.map((x) => s.points.find((p) => p.x === x)?.y ?? null) })),
      pad,
      width,
      height,
    }),
  );

  return `${legend}<div class="linewrap" data-line="${data}">
    <svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none" class="linechart">
      ${grid}${paths}
      <line class="crosshair" x1="0" y1="${pad.t}" x2="0" y2="${height - pad.b}" style="display:none" />
      <text x="${pad.l}" y="${height - 6}" class="axis">${esc(xs[0])}</text>
      <text x="${width - pad.r}" y="${height - 6}" text-anchor="end" class="axis">${esc(xs[xs.length - 1])}</text>
    </svg>
    <div class="tooltip" style="display:none"></div>
  </div>`;
}

function section(title: string, summary: string, body: string, open = false): string {
  return `<details class="section"${open ? " open" : ""}>
    <summary><h2>${esc(title)}</h2><span class="section-summary">${esc(summary)}</span></summary>
    <div class="section-body">${body}</div>
  </details>`;
}

function activityBody(report: JsonReport): string {
  const models = Object.entries(report.modelMix)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => ({ label: m, value: fmtNum(n), share: n }));
  const tools = Object.entries(report.toolCalls)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => ({ label: shortToolName(t), value: fmtNum(n), share: n }));
  return `<div class="cols2">
      <div><h3>Model mix</h3>${barList(models)}</div>
      <div><h3>Tool calls</h3>${barList(tools)}</div>
    </div>`;
}

function contextBody(report: JsonReport): string {
  const co = report.contextOverhead;
  const attr = report.contextAttribution;
  const attrRows = attr
    ? attr.items.map((i) => ({ label: i.component, value: `${fmtCompact(i.estTokens)} tok`, share: i.estTokens }))
    : [];
  const attrDetails = attr ? attr.items.map((i) => `<p class="hint">${esc(i.detail)}</p>`).join("") : "";
  return `
    <div class="tiles">
      ${tile({ label: "Loaded before turn 1", value: `${fmtCompact(co.medianFirstTurnTokens)} tok`, sub: `median · ${fmtNum(co.sessionsCounted)} fresh sessions` })}
      ${tile({ label: "Compactions", value: fmtNum(report.compaction.totalCompactions), sub: `kept ${pct(report.compactionRetention.medianRetainedFraction)} (median)` })}
      ${tile({ label: "Tokens reclaimed", value: fmtCompact(report.compaction.tokensReclaimed) })}
      ${tile({ label: "Stale sessions", value: fmtNum(report.compaction.staleContextSessions.length), sub: "uncompacted growth past threshold" })}
    </div>
    <h3>What loads before turn one</h3>
    ${barList(attrRows)}
    <details class="more"><summary>details</summary>${attrDetails}<p class="hint">${attr ? esc(attr.note) : ""}</p></details>`;
}

function frictionBody(report: JsonReport): string {
  const denialRows = report.denials.topPatterns.map((r) => [
    esc(r.pattern),
    fmtNum(r.count),
    esc(
      Object.entries(r.kinds)
        .map(([k, v]) => `${k} ×${v}`)
        .join(", "),
    ),
  ]);
  const frictionRows = report.toolFriction
    .filter((r) => r.errorRate >= 0.25)
    .map((r) => [esc(shortToolName(r.tool)), `${(r.errorRate * 100).toFixed(0)}%`, `${r.errors}/${r.results}`]);
  const hookRows = report.hooks.rows.map((r) => [
    esc(r.hook) + (r.timeouts ? ` <span class="pill">${r.timeouts} timeouts</span>` : ""),
    fmtNum(r.count),
    `${fmtNum(r.medianMs)}ms`,
    `${(r.totalWaitMs / 60000).toFixed(1)}min`,
  ]);
  return `
    <h3>Failing tools</h3>
    ${table(["Tool", "Fail rate", "n"], frictionRows, new Set([1, 2]))}
    <h3>Permission denials</h3>
    ${table(["Pattern", "Denied", "Kind"], denialRows, new Set([1]))}
    <h3>Hook latency</h3>
    ${table(["Hook", "Firings", "Median", "Total wait"], hookRows, new Set([1, 2, 3]))}
    <p class="hint">Hook counts are floors: successful runs with empty output are never persisted to transcripts.</p>`;
}

function workBody(report: JsonReport): string {
  const projRows = report.projects.map((r) => [
    `<span title="${esc(r.cwd)}">${esc(r.cwd.split("/").slice(-2).join("/"))}</span>`,
    fmtCompact(r.output),
    fmtCompact(r.toolCalls),
    fmtNum(r.sessions),
  ]);
  const skills = Object.entries(report.skillsInvokedByModel)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => ({ label: s, value: fmtNum(n), share: n }));
  const slashes = Object.entries(report.slashCommandsTyped)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => ({ label: `/${s}`, value: fmtNum(n), share: n }));
  return `
    <h3>Projects by output tokens</h3>
    ${table(["Project", "Output", "Tool calls", "Sessions"], projRows, new Set([1, 2, 3]))}
    <div class="cols2">
      <div><h3>Skills the model invoked</h3>${barList(skills)}</div>
      <div><h3>Slash commands you typed</h3>${barList(slashes)}</div>
    </div>
    <p class="hint">Subagents produced ${esc(pct(report.sidechain.outputShare))} of all output tokens across ${esc(fmtNum(report.delegation.sidechainSessionCount))} delegating sessions.</p>`;
}

function codexBody(report: JsonReport): string {
  const cx = report.codex;
  if (!cx) return "";
  const rateSeries = cx.rateLimits.series ?? [];
  const chart =
    rateSeries.length >= 2
      ? lineChart(
          [
            {
              name: "5-hour window %",
              points: rateSeries.filter((s) => s.primaryPct !== null).map((s) => ({ x: new Date(s.ts).toISOString().slice(0, 10), y: s.primaryPct as number })),
            },
            {
              name: "weekly window %",
              dashed: true,
              points: rateSeries.filter((s) => s.secondaryPct !== null).map((s) => ({ x: new Date(s.ts).toISOString().slice(0, 10), y: s.secondaryPct as number })),
            },
          ],
          { unit: "%" },
        )
      : `<p class="empty">No rate-limit history.</p>`;
  const models = Object.entries(cx.models).map(([m, n]) => ({ label: m, value: fmtNum(n), share: n }));
  const tools = Object.entries(cx.toolCalls).map(([t, n]) => ({ label: t, value: fmtNum(n), share: n }));
  return `
    <div class="tiles">
      ${tile({ label: "Input tokens", value: fmtCompact(cx.tokens.totalInput), sub: `${pct(cx.tokens.cacheShareOfInput)} cached` })}
      ${tile({ label: "Output tokens", value: fmtCompact(cx.tokens.totalOutput), sub: `${fmtCompact(cx.tokens.totalReasoningOutput)} reasoning` })}
      ${tile({ label: "Turns completed", value: fmtNum(cx.turnsCompleted) })}
      ${tile({ label: "Context fill at session end", value: pct(cx.contextWindowFill.medianEndOfSessionFill), sub: `median · p90 ${pct(cx.contextWindowFill.p90EndOfSessionFill)}` })}
    </div>
    <h3>Rate-limit utilization over time</h3>
    ${chart}
    <div class="cols2">
      <div><h3>Models</h3>${barList(models)}</div>
      <div><h3>Tools</h3>${barList(tools)}</div>
    </div>`;
}

const INLINE_JS = `
document.querySelectorAll('.linewrap').forEach(function(wrap){
  var cfg = JSON.parse(wrap.getAttribute('data-line'));
  var svg = wrap.querySelector('svg');
  var tip = wrap.querySelector('.tooltip');
  var cross = wrap.querySelector('.crosshair');
  var plotW = cfg.width - cfg.pad.l - cfg.pad.r;
  svg.addEventListener('mousemove', function(ev){
    var rect = svg.getBoundingClientRect();
    var fx = (ev.clientX - rect.left) / rect.width * cfg.width;
    var i = Math.round((fx - cfg.pad.l) / plotW * (cfg.xs.length - 1));
    if (i < 0 || i >= cfg.xs.length) { tip.style.display = 'none'; cross.style.display = 'none'; return; }
    var x = cfg.pad.l + i / Math.max(1, cfg.xs.length - 1) * plotW;
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
    var lines = ['<b>' + cfg.xs[i] + '</b>'];
    cfg.series.forEach(function(s){
      if (s.ys[i] !== null) lines.push(s.name + ': ' + Number(s.ys[i]).toLocaleString() + cfg.unit);
    });
    tip.innerHTML = lines.join('<br>');
    tip.style.display = '';
    var lx = ev.clientX - rect.left + 12;
    if (lx > rect.width - 180) lx = rect.width - 180;
    tip.style.left = lx + 'px';
    tip.style.top = '4px';
  });
  svg.addEventListener('mouseleave', function(){ tip.style.display='none'; cross.style.display='none'; });
});
`;

const CSS = `
:root{
  --surface:#faf9f7;--card:#ffffff;--border:#e7e5e0;--ink:#141310;--ink-2:#5c5a54;--ink-3:#93908a;
  --accent:#2a78d6;--bad:#c73635;--warn:#b57c00;--track:#efede9;
}
@media (prefers-color-scheme: dark){:root{
  --surface:#191918;--card:#201f1e;--border:#373633;--ink:#f4f3f0;--ink-2:#b6b4ad;--ink-3:#807e77;
  --accent:#3987e5;--bad:#e66767;--warn:#c98500;--track:#2b2a28;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px 20px 60px}
main{max-width:820px;margin:0 auto}
header{margin-bottom:28px}
h1{font-size:21px;font-weight:650;margin:0;letter-spacing:-.01em}
h1 .tag{font-weight:400;color:var(--ink-3);font-size:14px;margin-left:8px}
h2{font-size:15px;font-weight:600;margin:0}
h3{font-size:12px;font-weight:600;margin:20px 0 8px;color:var(--ink-2);text-transform:none}
.sub{color:var(--ink-3);font-size:12.5px;margin-top:6px}
.lede{color:var(--ink-2);font-size:12.5px;margin:4px 0 12px}
.count-pill{background:var(--track);border-radius:99px;padding:1px 8px;font-size:11px;color:var(--ink-2);vertical-align:2px;font-weight:500}
.lead{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}
.tile{padding:2px 0}
.tile-value{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.tile-label{font-size:11.5px;color:var(--ink-2);margin-top:1px}
.tile-sub{font-size:11px;color:var(--ink-3)}
.section{background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden}
.section>summary{display:flex;align-items:baseline;gap:12px;padding:16px 20px;cursor:pointer;list-style:none}
.section>summary::-webkit-details-marker{display:none}
.section>summary::after{content:"+";margin-left:auto;color:var(--ink-3);font-size:16px;line-height:1}
.section[open]>summary::after{content:"–"}
.section-summary{color:var(--ink-3);font-size:12.5px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.section-body{padding:0 20px 20px}
.bar-row{display:grid;grid-template-columns:minmax(110px,42%) 1fr 64px;gap:10px;align-items:center;padding:3px 0}
.bar-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
.bar-track{background:var(--track);border-radius:3px;height:10px}
.bar-fill{height:100%;border-radius:0 3px 3px 0;min-width:2px;background:var(--accent)}
.bar-value{text-align:right;font-variant-numeric:tabular-nums;font-size:12px;color:var(--ink-2)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{color:var(--ink-3);font-weight:500;text-align:left;padding:4px 8px 6px 0;border-bottom:1px solid var(--border)}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
td{padding:5px 8px 5px 0;border-bottom:1px solid var(--border);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
.pill{border-radius:99px;padding:1px 7px;font-size:10.5px;background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:10px;flex:none}
.dot-high{background:var(--bad)}.dot-medium{background:var(--warn)}.dot-low{background:var(--ink-3)}
.finding{border-bottom:1px solid var(--border);padding:8px 0}
.finding:last-child{border-bottom:none}
.finding summary{cursor:pointer;display:flex;align-items:center;font-size:13.5px;list-style:none}
.finding summary::-webkit-details-marker{display:none}
.finding-body{padding:8px 0 4px 18px;color:var(--ink-2);font-size:12.5px}
.finding-body pre{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;overflow-x:auto;max-height:180px}
.empty{color:var(--ink-3);font-size:12.5px}
.hint{color:var(--ink-3);font-size:11.5px;margin:6px 0 0}
details.more{margin-top:6px}
details.more>summary{cursor:pointer;color:var(--ink-3);font-size:11.5px;list-style:none}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"▸ "}
details.more[open]>summary::before{content:"▾ "}
.linewrap{position:relative;margin-top:6px}
.linechart .grid{stroke:var(--border);stroke-width:1}
.linechart .axis{fill:var(--ink-3);font-size:10px}
.linechart .line{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linejoin:round}
.linechart .line.dashed{stroke-dasharray:5 4;opacity:.65}
.crosshair{stroke:var(--ink-3);stroke-dasharray:3 3}
.tooltip{position:absolute;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:11.5px;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.10);min-width:140px}
.legend{display:flex;gap:16px;font-size:11.5px;color:var(--ink-2)}
.legend-item{display:flex;align-items:center;gap:6px}
.swatch{width:14px;height:3px;border-radius:2px;background:var(--accent);display:inline-block}
.swatch.dashed{opacity:.65;background:repeating-linear-gradient(90deg,var(--accent) 0 4px,transparent 4px 7px)}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:640px){.cols2{grid-template-columns:1fr}}
footer{max-width:820px;margin:24px auto 0;color:var(--ink-3);font-size:11.5px}
`;

export function buildDashboard(report: JsonReport, findings: OptimizationFinding[], history: DailySnapshot[]): string {
  const co = report.contextOverhead;
  const q = report.officialQuota;
  const cx = report.codex;

  const denialTotal = Object.values(report.denials.byKind).reduce((a, b) => a + b, 0);
  const slowHooks = report.hooks.rows.filter((r) => r.slow).length;
  const frictionCount = report.toolFriction.filter((r) => r.errorRate >= 0.25).length;

  const activitySummary = `${fmtCompact(report.tokens.totalOutput)} output tokens · ${Object.keys(report.modelMix).length} models · ${fmtCompact(Object.values(report.toolCalls).reduce((a, b) => a + b, 0))} tool calls`;
  const contextSummary = `${fmtCompact(co.medianFirstTurnTokens)} tok before turn 1 · ${fmtNum(report.compaction.totalCompactions)} compactions · ${fmtNum(report.compaction.staleContextSessions.length)} stale sessions`;
  const frictionSummary = `${pct(report.governance.toolErrorRate)} tool errors · ${fmtNum(denialTotal)} denials · ${slowHooks ? `${slowHooks} slow hooks` : "hooks healthy"}${frictionCount ? ` · ${frictionCount} failing tools` : ""}`;
  const workSummary = `${fmtNum(report.workspaceCount)} projects · ${pct(report.sidechain.outputShare)} of output from subagents`;
  const codexSummary = cx
    ? `${fmtNum(cx.sessions)} sessions · ${fmtCompact(cx.tokens.totalOutput)} output tokens · weekly limit peak ${cx.rateLimits.peakSecondaryPct}%`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>cc-utility report</title><style>${CSS}</style></head>
<body>
<main>
<header>
  <h1>cc-utility<span class="tag">harness &amp; usage report</span></h1>
  <div class="sub">${fmtNum(report.sessionsScanned)} Claude Code sessions${cx ? ` · ${fmtNum(cx.sessions)} Codex sessions` : ""} · generated ${new Date().toISOString().slice(0, 10)} · 100% local</div>
</header>

<section class="lead">
  <div class="tiles">
    ${tile({ label: "Output tokens", value: fmtCompact(report.tokens.totalOutput), sub: `${pct(report.sidechain.outputShare)} via subagents` })}
    ${tile({ label: "Cache hit rate", value: pct(report.tokens.cacheHitRate) })}
    ${tile({ label: "Context before turn 1", value: `${fmtCompact(co.medianFirstTurnTokens)}`, sub: "tokens, median" })}
    ${tile({ label: "Median turn wait", value: `${(report.turnDuration.medianMs / 1000).toFixed(0)}s`, sub: `p95 ${(report.turnDuration.p95Ms / 1000).toFixed(0)}s` })}
    ${tile({ label: "Real prompts", value: fmtCompact(report.promptPatterns.realPromptCount) })}
    ${q?.five_hour ? tile({ label: "Quota now", value: `${q.five_hour.utilization}%`, sub: q.seven_day ? `5h · weekly ${q.seven_day.utilization}%` : "5h window" }) : ""}
  </div>
  <h3>Daily tokens</h3>
  ${lineChart([
    { name: "output tokens / day", points: history.slice(-90).map((h) => ({ x: h.date, y: h.totalOutput })) },
    { name: "uncached input / day", dashed: true, points: history.slice(-90).map((h) => ({ x: h.date, y: h.totalInput })) },
  ])}
</section>

${findingsSection(findings)}

${section("Models & tools", activitySummary, activityBody(report))}
${section("Context health", contextSummary, contextBody(report))}
${section("Friction", frictionSummary, frictionBody(report))}
${section("Projects & delegation", workSummary, workBody(report))}
${cx ? section("Codex", codexSummary, codexBody(report)) : ""}
</main>
<footer>Deterministic stats from local session logs. No telemetry. The only network call is the optional --quota check against Anthropic's official endpoint; Codex rate-limit history comes from Codex's own rollout files.</footer>
<script>${INLINE_JS}</script>
</body></html>`;
}
