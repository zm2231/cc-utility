import type { SessionRecord } from "../jsonl/types.js";
import type { AnalysisState } from "./state.js";

export function trackSidechain(state: AnalysisState, rec: SessionRecord): void {
  if (rec.isSidechain !== true) return;
  state.sidechainRecordCount += 1;
  if (typeof rec.sessionId === "string" && rec.sessionId) {
    state.sidechainSessionIds.add(rec.sessionId);
  }
}
