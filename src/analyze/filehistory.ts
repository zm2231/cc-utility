import type { SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bump } from "./state.js";

export function processFileHistorySnapshot(state: AnalysisState, rec: SessionRecord): void {
  if (rec.type !== "file-history-snapshot") return;
  const backups = rec.snapshot?.trackedFileBackups;
  if (!backups || typeof backups !== "object") return;

  const paths = Object.keys(backups);
  state.snapshotCount += 1;
  state.snapshotTrackedFileCounts.push(paths.length);
  for (const path of paths) bump(state.fileTouchCounts, path);
}
