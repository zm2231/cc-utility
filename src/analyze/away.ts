import type { SessionRecord } from "../jsonl/types.js";
import type { AnalysisState } from "./state.js";

export function processAwayWork(state: AnalysisState, rec: SessionRecord): void {
  if (rec.type !== "system") return;
  if (rec.subtype === "away_summary") state.awaySummaryCount += 1;
  else if (rec.subtype === "scheduled_task_fire") state.scheduledTaskFireCount += 1;
}
