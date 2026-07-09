import { extname } from "node:path";
import type { ContentBlock, SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bump, dateKeyOf, getDayBucket } from "./state.js";

function toolUseKey(sessionId: string, toolUseId: string): string {
  return `${sessionId}\0${toolUseId}`;
}

export function processTools(state: AnalysisState, rec: SessionRecord, sessionId: string): void {
  if (rec.type !== "assistant") return;
  const content = rec.message?.content;
  if (!Array.isArray(content)) return;

  const dateKey = dateKeyOf(rec.timestamp);

  for (const block of content as ContentBlock[]) {
    if (block?.type !== "tool_use") continue;
    const name = typeof block.name === "string" && block.name ? block.name : "unknown";
    bump(state.toolCounts, name);

    if (typeof block.id === "string" && block.id) {
      state.toolUseNameById.set(toolUseKey(sessionId, block.id), name);
    }

    if (dateKey) {
      const bucket = getDayBucket(state, dateKey);
      bucket.totalToolCalls += 1;
      bucket.sessionIds.add(sessionId);
      if (name === "Bash") bucket.bashToolCalls += 1;
      if (name === "Agent") bucket.agentToolCalls += 1;
    }

    if (name === "Read") {
      const filePathRaw = block.input?.file_path;
      const filePath = typeof filePathRaw === "string" ? filePathRaw : "";
      const ext = filePath ? extname(filePath).toLowerCase() || "(no ext)" : "(no ext)";
      bump(state.fileExtCounts, ext);
    }

    if (name === "Skill") {
      const skillRaw = block.input?.skill;
      const skillName = typeof skillRaw === "string" && skillRaw ? skillRaw : "unknown";
      bump(state.skillCounts, skillName);
    }

    if (name === "ScheduleWakeup") {
      const delay = block.input?.delaySeconds;
      if (typeof delay === "number" && Number.isFinite(delay)) {
        state.scheduleWakeupDelays.push(delay);
      }
    }
  }
}

export function correlateToolFriction(state: AnalysisState): void {
  for (const evt of state.toolResultEvents) {
    const name = state.toolUseNameById.get(toolUseKey(evt.sessionId, evt.toolUseId)) ?? "unknown";
    bump(state.toolResultCountByTool, name);
    if (evt.isError) bump(state.toolErrorCountByTool, name);

    if (evt.dateKey) {
      const bucket = getDayBucket(state, evt.dateKey);
      const perTool = bucket.toolResultsByTool.get(name) ?? { results: 0, errors: 0 };
      perTool.results += 1;
      if (evt.isError) perTool.errors += 1;
      bucket.toolResultsByTool.set(name, perTool);
    }
  }
}
