import type { SessionRecord } from "../jsonl/types.js";
import type { AnalysisState } from "./state.js";

export function trackCwd(state: AnalysisState, rec: SessionRecord): void {
  if (typeof rec.cwd !== "string" || !rec.cwd) return;
  state.cwdsSeen.add(rec.cwd);
  if (typeof rec.sessionId === "string" && rec.sessionId) {
    let set = state.cwdSessions.get(rec.cwd);
    if (!set) { set = new Set(); state.cwdSessions.set(rec.cwd, set); }
    set.add(rec.sessionId);
  }
}
