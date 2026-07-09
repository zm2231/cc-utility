type JsonReport = ReturnType<typeof import("./json.js").buildJsonReport>;

export interface OptimizationFinding {
  id: string;
  headline: string;
  detail: string;
  severity: "high" | "medium" | "low";
  score: number;
  evidence: Record<string, unknown>;
}

const MIN_TOOL_FRICTION_RATE = 0.3;
const LOW_CACHE_HIT_RATE = 0.9;
const LOW_RETENTION_FRACTION = 0.1;
const HIGH_BASH_SHARE = 0.45;
const HIGH_TURN_P95_MS = 10 * 60 * 1000;

function findToolFriction(report: JsonReport): OptimizationFinding[] {
  const window = report.recentWindow;
  if (!window) return [];
  return window.toolFriction
    .filter((r) => r.errorRate >= MIN_TOOL_FRICTION_RATE)
    .map((r) => ({
      id: `tool-friction:${r.tool}`,
      headline: `${r.tool} fails ${(r.errorRate * 100).toFixed(0)}% of the time in the last ${window.windowDays} days`,
      detail: `${r.errors} errors out of ${r.results} calls, last seen ${r.lastSeenDate}.`,
      severity: r.errorRate >= 0.6 ? "high" : r.errorRate >= 0.4 ? "medium" : "low",
      score: 50 + r.errorRate * 50,
      evidence: { tool: r.tool, errors: r.errors, results: r.results, errorRate: r.errorRate, lastSeenDate: r.lastSeenDate, windowDays: window.windowDays },
    } as OptimizationFinding));
}

function findLowCacheHitRate(report: JsonReport): OptimizationFinding | null {
  const window = report.recentWindow;
  if (!window) return null;
  const { cacheHitRate, totalCacheRead, totalInput, totalCacheCreation } = window;
  if (totalCacheRead + totalInput + totalCacheCreation === 0 || cacheHitRate >= LOW_CACHE_HIT_RATE) return null;
  return {
    id: "cache-hit-rate",
    headline: `Cache hit rate is only ${(cacheHitRate * 100).toFixed(1)}% over the last ${window.windowDays} days`,
    detail: "Below 90% usually means dynamic content near the top of your prompt or CLAUDE.md is invalidating the cached prefix on every turn.",
    severity: cacheHitRate < 0.75 ? "high" : "medium",
    score: 40 + (LOW_CACHE_HIT_RATE - cacheHitRate) * 100,
    evidence: { cacheHitRate, totalCacheRead, totalInput, totalCacheCreation, windowDays: window.windowDays, lastActiveDate: window.lastActiveDate },
  };
}

function findCompactionRetentionLoss(report: JsonReport): OptimizationFinding | null {
  const window = report.recentWindow;
  if (!window) return null;
  const compactionsInWindow = window.compactionsWithRatio;
  if (compactionsInWindow < 5 || window.compactionMedianRetained >= LOW_RETENTION_FRACTION) return null;
  return {
    id: "compaction-retention",
    headline: `Compaction has kept only ${(window.compactionMedianRetained * 100).toFixed(1)}% of context recently`,
    detail: `Over the last ${window.windowDays} days. If real continuity is getting lost, compact earlier and more often instead of waiting for a huge one-shot compaction.`,
    severity: window.compactionMedianRetained < 0.05 ? "high" : "medium",
    score: 35 + (LOW_RETENTION_FRACTION - window.compactionMedianRetained) * 200,
    evidence: { medianRetainedFraction: window.compactionMedianRetained, windowDays: window.windowDays, lastActiveDate: window.lastActiveDate },
  };
}

function findBashBloat(report: JsonReport): OptimizationFinding | null {
  const window = report.recentWindow;
  if (!window || window.bashShare < HIGH_BASH_SHARE) return null;
  return {
    id: "bash-bloat",
    headline: `Bash is ${(window.bashShare * 100).toFixed(0)}% of all tool calls in the last ${window.windowDays} days`,
    detail: "Large or uncompressed command output is a common context-bloat source. Pipe through grep/head where you can.",
    severity: window.bashShare >= 0.6 ? "high" : "medium",
    score: 30 + window.bashShare * 40,
    evidence: { bashShare: window.bashShare, windowDays: window.windowDays, lastActiveDate: window.lastActiveDate },
  };
}

function findBinaryReads(report: JsonReport): OptimizationFinding | null {
  const BINARY_EXTS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".tar", ".gz",
    ".mp4", ".mov", ".mp3", ".wav", ".bin", ".exe", ".dmg", ".woff", ".woff2",
  ]);
  const hits = Object.entries(report.fileExtensionsRead).filter(([ext]) => BINARY_EXTS.has(ext));
  const total = hits.reduce((a, [, c]) => a + c, 0);
  if (total === 0) return null;
  return {
    id: "binary-reads",
    headline: `${total} reads of binary/media files`,
    detail: "These dump raw or base64 content into context for no benefit. A hook blocking Read on these extensions would help.",
    severity: total >= 20 ? "high" : "low",
    score: 20 + Math.min(total, 100) / 2,
    evidence: { total, byExtension: Object.fromEntries(hits) },
  };
}

function findStaleContext(report: JsonReport): OptimizationFinding | null {
  const sessions = report.compaction.staleContextSessions;
  if (!sessions.length) return null;
  const neverCompacted = sessions.filter((s) => !s.everCompacted).length;
  return {
    id: "stale-context",
    headline: `${sessions.length} session(s) carrying stale context past ${Math.round(report.compaction.staleContextThreshold / 1000)}k tokens`,
    detail: `${neverCompacted} of them have never been compacted at all.`,
    severity: neverCompacted > 0 ? "medium" : "low",
    score: 25 + sessions.length * 2,
    evidence: { sessions: sessions.slice(0, 10), threshold: report.compaction.staleContextThreshold },
  };
}

function findRejectedToolUse(report: JsonReport): OptimizationFinding | null {
  const count = report.governance.rejectedToolUseCount;
  if (count < 5) return null;
  return {
    id: "rejected-tool-use",
    headline: `${count} tool calls rejected outright`,
    detail: "Repeated rejections in one session usually mean the agent should have stopped and asked, not retried.",
    severity: count >= 30 ? "high" : "medium",
    score: 20 + Math.min(count, 200) / 4,
    evidence: { rejectedToolUseCount: count, toolResultCount: report.governance.toolResultCount },
  };
}

function findLongTurns(report: JsonReport): OptimizationFinding | null {
  const t = report.turnDuration;
  if (t.turnsCounted < 20 || t.p95Ms < HIGH_TURN_P95_MS) return null;
  return {
    id: "long-turns",
    headline: `p95 turn wait is ${(t.p95Ms / 60000).toFixed(1)} minutes`,
    detail: `Across ${t.turnsCounted} turns, median ${(t.medianMs / 1000).toFixed(0)}s.`,
    severity: t.p95Ms >= 20 * 60 * 1000 ? "high" : "medium",
    score: 15 + Math.min(t.p95Ms / 60000, 60),
    evidence: { turnsCounted: t.turnsCounted, medianMs: t.medianMs, p95Ms: t.p95Ms, maxMs: t.maxMs },
  };
}

function findRateLimitCrossings(report: JsonReport): OptimizationFinding | null {
  const crossings = report.rateLimitTrends?.thresholdCrossings ?? [];
  if (!crossings.length) return null;
  return {
    id: "rate-limit-crossings",
    headline: `Crossed 80% rate-limit utilization ${crossings.length} time(s)`,
    detail: `Most recently: ${crossings[crossings.length - 1].window === "five_hour" ? "5-hour" : "7-day"} window at ${crossings[crossings.length - 1].pct}%.`,
    severity: crossings.length >= 3 ? "high" : "medium",
    score: 45 + crossings.length * 5,
    evidence: { crossings },
  };
}

function findHotFile(report: JsonReport): OptimizationFinding | null {
  const entries = Object.entries(report.editBlastRadius.hottestFiles).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] < 500) return null;
  const [path, count] = entries[0];
  return {
    id: "hot-file",
    headline: `${path} touched in ${count} file-history snapshots`,
    detail: "The single hottest file across every session scanned; a candidate for splitting or excluding from repeated full rewrites.",
    severity: count >= 2000 ? "medium" : "low",
    score: 10 + Math.min(count, 5000) / 100,
    evidence: { path, count },
  };
}

function findSlowHooks(report: JsonReport): OptimizationFinding[] {
  return (report.hooks?.rows ?? [])
    .filter((r) => r.slow)
    .map((r) => ({
      id: `slow-hook:${r.hook}`,
      headline: r.timeouts
        ? `Hook ${r.hook} timed out ${r.timeouts} time(s)`
        : `Hook ${r.hook} blocks ~${(r.medianMs / 1000).toFixed(1)}s per firing (${r.count} firings)`,
      detail: `Total measured wait ${(r.totalWaitMs / 60000).toFixed(1)} minutes (median ${r.medianMs}ms, p95 ${r.p95Ms}ms). Make it async, cache its output, or narrow its matcher.`,
      severity: (r.timeouts > 0 || r.medianMs > 5000 ? "high" : "medium") as OptimizationFinding["severity"],
      score: 30 + Math.min(r.totalWaitMs / 60000, 60),
      evidence: { ...r },
    }));
}

function findSkillListingOverBudget(report: JsonReport): OptimizationFinding | null {
  const attr = report.contextAttribution;
  if (!attr) return null;
  const skillItem = attr.items.find((i) => i.component.startsWith("Skill listing"));
  if (!skillItem || skillItem.estTokens <= attr.skillListingBudgetTokens) return null;
  const ratio = skillItem.estTokens / attr.skillListingBudgetTokens;
  return {
    id: "skill-listing-over-budget",
    headline: `Skill listing is ~${(ratio).toFixed(1)}x its context budget (${Math.round(skillItem.estTokens / 1000)}k est. tokens)`,
    detail: `${skillItem.count} model-invocable skills. Past ~${Math.round(attr.skillListingBudgetTokens / 1000)}k tokens entries get truncated and skill routing degrades. Set disable-model-invocation: true on rarely-dispatched skills or shorten descriptions.`,
    severity: ratio >= 3 ? "high" : "medium",
    score: 40 + Math.min(ratio * 10, 50),
    evidence: { estTokens: skillItem.estTokens, budget: attr.skillListingBudgetTokens, skillCount: skillItem.count },
  };
}

function findDenialHotspots(report: JsonReport): OptimizationFinding | null {
  const patterns = (report.denials?.topPatterns ?? []).filter((p) => p.count >= 5);
  if (!patterns.length) return null;
  const top = patterns[0];
  return {
    id: "denial-hotspots",
    headline: `${top.pattern} was denied ${top.count} time(s)`,
    detail: `Top repeated permission denials: ${patterns.slice(0, 5).map((p) => `${p.pattern} (${p.count})`).join(", ")}. For genuinely read-only commands, consider allow rules in settings; for user-rejected ones, the agent kept trying something you said no to.`,
    severity: top.count >= 20 ? "high" : "medium",
    score: 25 + Math.min(top.count, 60),
    evidence: { patterns: patterns.slice(0, 10), kindsOverall: report.denials.byKind },
  };
}

function findCodexContextFill(report: JsonReport): OptimizationFinding | null {
  const cx = report.codex;
  if (!cx || cx.contextWindowFill.sessionsMeasured < 20) return null;
  const p90 = cx.contextWindowFill.p90EndOfSessionFill;
  if (p90 < 0.7) return null;
  return {
    id: "codex-context-fill",
    headline: `Codex sessions end at ${(p90 * 100).toFixed(0)}% context fill (p90)`,
    detail: `Across ${cx.contextWindowFill.sessionsMeasured} sessions. Sessions routinely running near the window ceiling lose early context; split work or start fresh threads sooner.`,
    severity: p90 >= 0.9 ? "high" : "medium",
    score: 20 + p90 * 30,
    evidence: { ...cx.contextWindowFill },
  };
}

const SINGLE_FINDERS: Array<(report: JsonReport) => OptimizationFinding | null> = [
  findSkillListingOverBudget,
  findDenialHotspots,
  findCodexContextFill,
  findLowCacheHitRate,
  findCompactionRetentionLoss,
  findBashBloat,
  findBinaryReads,
  findStaleContext,
  findRejectedToolUse,
  findLongTurns,
  findRateLimitCrossings,
  findHotFile,
];

export function buildOptimizationRanking(report: JsonReport): OptimizationFinding[] {
  const findings: OptimizationFinding[] = [
    ...findToolFriction(report),
    ...findSlowHooks(report),
    ...SINGLE_FINDERS.map((fn) => fn(report)).filter((f): f is OptimizationFinding => f !== null),
  ];
  return findings.sort((a, b) => b.score - a.score);
}
