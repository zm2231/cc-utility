import type { SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, dateKeyOf, getDayBucket } from "./state.js";

export function processTurnDuration(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "system" || rec.subtype !== "turn_duration") return;
  if (typeof rec.durationMs === "number" && Number.isFinite(rec.durationMs)) {
    state.turnDurationsMs.push(rec.durationMs);

    const dateKey = dateKeyOf(rec.timestamp);
    if (dateKey) {
      const bucket = getDayBucket(state, dateKey);
      bucket.turnDurationsMs.push(rec.durationMs);
      bucket.sessionIds.add(sessionId);
    }
  }
}
