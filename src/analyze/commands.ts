import type { ContentBlock, SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bump } from "./state.js";

const COMMAND_NAME_RE = /<command-name>\/?([a-zA-Z0-9_:-]+)<\/command-name>/g;

function extractText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .join(" ");
}

export function processCommandInvocation(state: AnalysisState, rec: SessionRecord): void {
  if (rec.type !== "user") return;

  const text = extractText(rec.message?.content);
  if (!text.includes("<command-name>")) return;

  for (const match of text.matchAll(COMMAND_NAME_RE)) {
    const command = match[1];
    if (command) bump(state.skillUserInvoked, command);
  }
}
