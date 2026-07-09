import type { ContentBlock, SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bump, dateKeyOf } from "./state.js";

export function processDenial(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "user") return;
  const kind = rec.toolDenialKind;
  if (typeof kind !== "string" || !kind) return;

  bump(state.denialsByKind, kind);

  const content = rec.message?.content;
  if (!Array.isArray(content)) return;
  const dateKey = dateKeyOf(rec.timestamp);
  for (const block of content as ContentBlock[]) {
    if (block?.type !== "tool_result") continue;
    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
    if (!toolUseId) continue;
    state.denialEvents.push({ sessionId, toolUseId, kind, dateKey });
  }
}

export function correlateDenials(state: AnalysisState): void {
  for (const evt of state.denialEvents) {
    const key = `${evt.sessionId}\0${evt.toolUseId}`;
    const name = state.toolUseNameById.get(key) ?? "unknown";
    const pattern = name === "Bash"
      ? `Bash: ${state.toolUseBashHeadById.get(key) ?? "?"}`
      : name;
    let entry = state.denialsByPattern.get(pattern);
    if (!entry) {
      entry = { count: 0, kinds: new Map() };
      state.denialsByPattern.set(pattern, entry);
    }
    entry.count += 1;
    bump(entry.kinds, evt.kind);
  }
}

export interface DenialRow {
  pattern: string;
  count: number;
  kinds: Record<string, number>;
}

export function topDenials(state: AnalysisState, n: number): DenialRow[] {
  return [...state.denialsByPattern.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([pattern, v]) => ({ pattern, count: v.count, kinds: Object.fromEntries(v.kinds) }));
}
