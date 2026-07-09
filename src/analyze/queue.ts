import type { SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bump, dateKeyOf, getDayBucket } from "./state.js";

export function processQueueOperation(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "queue-operation") return;
  const op = typeof rec.operation === "string" && rec.operation ? rec.operation : "unknown";
  bump(state.queueOpCounts, op);

  const dateKey = dateKeyOf(rec.timestamp);
  if (dateKey && op === "enqueue") {
    const bucket = getDayBucket(state, dateKey);
    bucket.queueEnqueueCount += 1;
    bucket.sessionIds.add(sessionId);
  }
}
