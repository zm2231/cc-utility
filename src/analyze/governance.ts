import type { ContentBlock, SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, dateKeyOf, getDayBucket } from "./state.js";

const INTERRUPTED_TEXT = "[Request interrupted by user]";
const TOOL_USE_REJECTED_RE =
  /\btool use\b[^.!?]{0,20}\brejected\b|\brejected\b[^.!?]{0,20}\btool use\b/i;

function blockText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .join(" ");
}

export function isInterruptedMessage(content: string | ContentBlock[] | undefined): boolean {
  if (typeof content === "string") return content.trim() === INTERRUPTED_TEXT;
  if (!Array.isArray(content)) return false;
  return content.some((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim() === INTERRUPTED_TEXT);
}

export function processGovernance(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "user") return;
  const content = rec.message?.content;
  if (!content) return;

  if (isInterruptedMessage(content)) {
    state.interruptCount += 1;
  }

  if (!Array.isArray(content)) return;

  const dateKey = dateKeyOf(rec.timestamp);

  for (const block of content as ContentBlock[]) {
    if (block?.type !== "tool_result") continue;
    state.toolResultCount += 1;

    const isError = block.is_error === true;
    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
    state.toolResultEvents.push({ sessionId, toolUseId, isError, dateKey });

    if (dateKey) {
      const bucket = getDayBucket(state, dateKey);
      bucket.toolResultCount += 1;
      bucket.sessionIds.add(sessionId);
      if (isError) bucket.toolErrorCount += 1;
    }

    if (!isError) continue;

    state.toolErrorCount += 1;

    const text = typeof block.content === "string"
      ? block.content
      : Array.isArray(block.content)
        ? blockText(block.content as ContentBlock[])
        : "";

    if (TOOL_USE_REJECTED_RE.test(text)) {
      state.rejectedToolUseCount += 1;
    }
  }
}
