function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function lineChart(values: number[], labels: string[], opts: { width?: number; height?: number; color?: string } = {}): string {
  const width = opts.width ?? 600;
  const height = opts.height ?? 120;
  const padding = 24;
  if (values.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="chart-line"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">Not enough history yet</text></svg>`;
  }

  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = (width - padding * 2) / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = padding + i * stepX;
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const firstLabel = labels[0] ?? "";
  const lastLabel = labels[labels.length - 1] ?? "";

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="chart-line">
    <polyline points="${points}" fill="none" stroke="${opts.color ?? "#5b8cff"}" stroke-width="2" stroke-linejoin="round" />
    <text x="${padding}" y="${height - 4}" class="chart-axis-label">${esc(firstLabel)}</text>
    <text x="${width - padding}" y="${height - 4}" text-anchor="end" class="chart-axis-label">${esc(lastLabel)}</text>
  </svg>`;
}

const HEATMAP_LEVELS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

function colorForValue(value: number, maxValue: number): string {
  if (value <= 0) return HEATMAP_LEVELS[0];
  const intensity = Math.min(1, Math.log(1 + value) / Math.log(1 + maxValue));
  const idx = 1 + Math.min(HEATMAP_LEVELS.length - 2, Math.floor(intensity * (HEATMAP_LEVELS.length - 1)));
  return HEATMAP_LEVELS[idx];
}

export function heatmapGrid(data: Array<{ date: string; value: number }>): string {
  if (!data.length) {
    return `<div class="chart-empty">Not enough history yet</div>`;
  }

  const map = new Map(data.map((d) => [d.date, d.value]));
  const sortedDates = data.map((d) => new Date(`${d.date}T00:00:00Z`)).sort((a, b) => a.getTime() - b.getTime());
  const start = sortedDates[0];
  const end = sortedDates[sortedDates.length - 1];
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const cellSize = 11;
  const gap = 3;
  const startSunday = new Date(start);
  startSunday.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const totalDays = Math.round((end.getTime() - startSunday.getTime()) / 86_400_000) + 1;
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const width = weeks * (cellSize + gap);
  const height = 7 * (cellSize + gap);

  let rects = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startSunday);
    d.setUTCDate(startSunday.getUTCDate() + i);
    if (d.getTime() > end.getTime()) break;
    const dateStr = d.toISOString().slice(0, 10);
    const value = map.get(dateStr) ?? 0;
    const week = Math.floor(i / 7);
    const day = i % 7;
    const x = week * (cellSize + gap);
    const y = day * (cellSize + gap);
    rects += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colorForValue(value, maxValue)}"><title>${esc(dateStr)}: ${esc(fmtCompact(value))}</title></rect>`;
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="chart-heatmap">${rects}</svg>`;
}

export function sortedBarPlot(rows: Array<{ label: string; value: string; share: number }>): string {
  if (!rows.length) return `<div class="chart-empty">No data</div>`;
  const maxShare = Math.max(...rows.map((r) => r.share), 0.0001);
  return rows
    .map(
      (r) => `
      <div class="bar-row">
        <div class="bar-label">${esc(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${((r.share / maxShare) * 100).toFixed(1)}%"></div></div>
        <div class="bar-value">${esc(r.value)}</div>
      </div>`,
    )
    .join("");
}

export interface AnomalyRow {
  tool: string;
  errors: number;
  results: number;
  errorRate: number;
  lastSeenDate?: string;
}

export function anomalyTable(rows: AnomalyRow[], windowLabel: string): string {
  if (!rows.length) {
    return `<div class="chart-empty">No tool crossed the friction threshold${windowLabel}.</div>`;
  }
  const body = rows
    .map(
      (r) => `
      <tr>
        <td class="tool-name">${esc(shortToolName(r.tool))}</td>
        <td class="num sev-${r.errorRate >= 0.6 ? "high" : r.errorRate >= 0.4 ? "medium" : "low"}">${(r.errorRate * 100).toFixed(0)}%</td>
        <td class="num muted">${r.errors}/${r.results}</td>
        <td class="muted">${esc(r.lastSeenDate ?? "—")}</td>
      </tr>`,
    )
    .join("");
  return `
    <table class="anomaly-table">
      <thead><tr><th>Tool</th><th>Fail rate</th><th>n</th><th>Last seen</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function shortToolName(raw: string): string {
  const mcpMatch = raw.match(/^mcp__(.+?)__(.+)$/);
  if (mcpMatch) return `${mcpMatch[1]}.${mcpMatch[2]}`;
  return raw;
}

export { fmtCompact };
