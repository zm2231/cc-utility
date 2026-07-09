import type { ContentBlock, SessionRecord, Usage } from "../jsonl/types.js";
import { safeNum } from "./state.js";

interface AssistantCandidate {
  record: SessionRecord;
  completeness: number;
}

export interface PendingSessionData {
  assistantById: Map<string, AssistantCandidate[]>;
  compactionEvents: SessionRecord[];
}

let uniqueCounter = 0;

function completenessScore(rec: SessionRecord): number {
  const usage = rec.message?.usage ?? {};
  return (
    safeNum(usage.output_tokens) +
    safeNum(usage.input_tokens) +
    safeNum(usage.cache_creation_input_tokens) +
    safeNum(usage.cache_read_input_tokens)
  );
}

export function sessionKey(rec: SessionRecord, fallback: string): string {
  return typeof rec.sessionId === "string" && rec.sessionId ? rec.sessionId : fallback;
}

function messageKey(rec: SessionRecord): string {
  if (typeof rec.message?.id === "string" && rec.message.id) return rec.message.id;
  if (typeof rec.uuid === "string" && rec.uuid) return rec.uuid;
  uniqueCounter += 1;
  return `no-id:${uniqueCounter}`;
}

function getOrCreate(pending: Map<string, PendingSessionData>, sid: string): PendingSessionData {
  let data = pending.get(sid);
  if (!data) {
    data = { assistantById: new Map(), compactionEvents: [] };
    pending.set(sid, data);
  }
  return data;
}

export function collectAssistant(
  pending: Map<string, PendingSessionData>,
  rec: SessionRecord,
  fallbackSessionId: string,
): void {
  if (rec.type !== "assistant") return;

  const sid = sessionKey(rec, fallbackSessionId);
  const data = getOrCreate(pending, sid);

  const messageId = messageKey(rec);
  const candidate: AssistantCandidate = { record: rec, completeness: completenessScore(rec) };

  const existing = data.assistantById.get(messageId);
  if (existing) existing.push(candidate);
  else data.assistantById.set(messageId, [candidate]);
}

export function collectCompaction(
  pending: Map<string, PendingSessionData>,
  rec: SessionRecord,
  fallbackSessionId: string,
): void {
  if (rec.type !== "system" || rec.subtype !== "compact_boundary") return;

  const sid = sessionKey(rec, fallbackSessionId);
  const data = getOrCreate(pending, sid);
  data.compactionEvents.push(rec);
}

const USAGE_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;

function mergeUsage(candidates: AssistantCandidate[]): Usage {
  const merged: Usage = {};
  for (const c of candidates) {
    const usage = c.record.message?.usage ?? {};
    for (const field of USAGE_FIELDS) {
      merged[field] = Math.max(safeNum(merged[field]), safeNum(usage[field]));
    }
  }
  return merged;
}

function mergeContent(candidates: AssistantCandidate[]): ContentBlock[] | string | undefined {
  let sawArray = false;
  const blocks = new Map<string, ContentBlock>();

  for (const c of candidates) {
    const content = c.record.message?.content;
    if (!Array.isArray(content)) continue;
    sawArray = true;
    content.forEach((block, localIdx) => {
      const type = typeof block?.type === "string" ? block.type : "<missing>";
      const key = typeof block?.id === "string" && block.id ? `id:${block.id}` : `idx:${localIdx}:${type}`;
      const existing = blocks.get(key);
      if (!existing || (typeof block?.text === "string" && block.text.length > (existing.text?.length ?? 0))) {
        blocks.set(key, block);
      }
    });
  }

  if (sawArray) return [...blocks.values()];

  const best = candidates.reduce((a, b) => (b.completeness >= a.completeness ? b : a));
  return best.record.message?.content as string | undefined;
}

function mergeAssistantGroup(candidates: AssistantCandidate[]): SessionRecord {
  if (candidates.length === 1) return candidates[0].record;

  const base = candidates.reduce((a, b) => (b.completeness >= a.completeness ? b : a)).record;
  return {
    ...base,
    message: {
      ...base.message,
      usage: mergeUsage(candidates),
      content: mergeContent(candidates),
    },
  };
}

function timestampOf(rec: SessionRecord): number {
  if (!rec.timestamp) return 0;
  const t = Date.parse(rec.timestamp);
  return Number.isNaN(t) ? 0 : t;
}

export function resolveChronological(data: PendingSessionData): SessionRecord[] {
  const merged: SessionRecord[] = [
    ...[...data.assistantById.values()].map(mergeAssistantGroup),
    ...data.compactionEvents,
  ];
  merged.sort((a, b) => timestampOf(a) - timestampOf(b));
  return merged;
}
