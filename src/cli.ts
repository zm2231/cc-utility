#!/usr/bin/env node
import { createState } from "./analyze/state.js";
import { processTokens } from "./analyze/tokens.js";
import { processTools, correlateToolFriction } from "./analyze/tools.js";
import { processPrompt } from "./analyze/prompts.js";
import { processCompaction } from "./analyze/compaction.js";
import { processGovernance } from "./analyze/governance.js";
import { processCommandInvocation } from "./analyze/commands.js";
import { trackCwd } from "./analyze/cwd.js";
import { trackSidechain } from "./analyze/sidechain.js";
import { processTurnDuration } from "./analyze/turns.js";
import { processAwayWork } from "./analyze/away.js";
import { processQueueOperation } from "./analyze/queue.js";
import { processFileHistorySnapshot } from "./analyze/filehistory.js";
import { collectClaudeMdSizes } from "./analyze/claudemd.js";
import { computeRateLimitTrends, defaultSidecarLogPath, parseSidecarLog } from "./analyze/rateLimitHistory.js";
import { buildAllDailySnapshots, defaultHistoryPath, toCsv, writeHistory } from "./analyze/historySnapshot.js";
import { collectAssistant, collectCompaction, resolveChronological, sessionKey, type PendingSessionData } from "./analyze/resolve.js";
import { defaultProjectsRoot, findSessionFiles } from "./jsonl/walker.js";
import { readRecords } from "./jsonl/parser.js";
import { fetchOfficialQuota } from "./quota/official.js";
import { renderReport } from "./report/render.js";
import { buildJsonReport } from "./report/json.js";
import { buildOptimizationRanking } from "./report/optimizationRanking.js";
import { buildHtmlReport } from "./report/html.js";
import { buildGridReport } from "./report/htmlGrid.js";
import { buildSidebarReport } from "./report/htmlSidebar.js";
import { buildTerminalReport } from "./report/htmlTerminal.js";
import { serveReport } from "./serve.js";
import { writeFileSync } from "node:fs";

function flagValue(args: string[], name: string, defaultValue: string): string | null {
  const flag = args.find((a) => a === name || a.startsWith(`${name}=`));
  if (!flag) return null;
  const eq = flag.indexOf("=");
  return eq === -1 ? defaultValue : flag.slice(eq + 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantQuota = args.includes("--quota");
  const wantJson = args.includes("--json");
  const htmlOutPath = flagValue(args, "--html", "cc-utility-report.html");
  const csvOutPath = flagValue(args, "--csv", "cc-utility-history.csv");
  const wantServe = args.includes("--serve") || args[0] === "serve";
  const servePort = Number(flagValue(args, "--port", "0") ?? "0") || 4173;
  const layoutArg = flagValue(args, "--layout", "terminal") ?? (wantServe ? "terminal" : "classic");
  const LAYOUTS = ["classic", "grid", "sidebar", "terminal"] as const;
  if (!LAYOUTS.includes(layoutArg as (typeof LAYOUTS)[number])) {
    console.error(`Unknown --layout "${layoutArg}". Allowed: ${LAYOUTS.join(", ")}.`);
    process.exit(1);
  }
  const layout = layoutArg as (typeof LAYOUTS)[number];
  const builders = {
    classic: buildHtmlReport,
    grid: buildGridReport,
    sidebar: buildSidebarReport,
    terminal: buildTerminalReport,
  } as const;
  const root = defaultProjectsRoot();

  const state = createState();
  const files = findSessionFiles(root);
  state.filesTotal = files.length;

  const pending = new Map<string, PendingSessionData>();

  for (const file of files) {
    for await (const rec of readRecords(file)) {
      trackCwd(state, rec);
      trackSidechain(state, rec);

      if (rec.type === "assistant") {
        collectAssistant(pending, rec, file);
        continue;
      }
      if (rec.type === "system" && rec.subtype === "compact_boundary") {
        collectCompaction(pending, rec, file);
        continue;
      }

      processPrompt(state, rec);
      processGovernance(state, rec, sessionKey(rec, file));
      processCommandInvocation(state, rec);
      processTurnDuration(state, rec, sessionKey(rec, file));
      processAwayWork(state, rec);
      processQueueOperation(state, rec, sessionKey(rec, file));
      processFileHistorySnapshot(state, rec);
    }
    state.filesProcessed += 1;
  }

  for (const [sid, data] of pending.entries()) {
    for (const rec of resolveChronological(data)) {
      processTokens(state, rec, sid);
      processTools(state, rec, sid);
      processCompaction(state, rec, sid);
    }
  }

  correlateToolFriction(state);
  collectClaudeMdSizes(state);

  const quota = wantQuota ? await fetchOfficialQuota() : null;
  if (wantQuota && !quota && !wantJson) {
    console.log("Could not fetch official quota (no credentials found or request failed). Showing local stats only.\n");
  }

  const rateLimitTrends = computeRateLimitTrends(parseSidecarLog(defaultSidecarLogPath()));
  const report = buildJsonReport(state, quota, rateLimitTrends);

  const history = buildAllDailySnapshots(state);
  writeHistory(defaultHistoryPath(), history);

  if (csvOutPath) {
    writeFileSync(csvOutPath, toCsv(history));
    console.log(`Wrote ${csvOutPath}`);
  }

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (wantServe) {
    const findings = buildOptimizationRanking(report);
    const html = builders[layout](report, findings, history);
    await serveReport(html, servePort);
    return;
  }

  if (htmlOutPath) {
    const findings = buildOptimizationRanking(report);
    writeFileSync(htmlOutPath, builders[layout](report, findings, history));
    console.log(`Wrote ${htmlOutPath} (layout: ${layout})`);
    return;
  }

  renderReport(state, quota, rateLimitTrends);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
