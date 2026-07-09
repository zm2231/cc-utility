import type { ContentBlock, SessionRecord } from "../jsonl/types.js";
import { type AnalysisState, bumpNum, bump } from "./state.js";

const SWEAR_EXACT_RE = /\b(fuck\w*|shit\w*|damn\w*|crap\w*|wtf|bullshit\w*|hell)\b/i;
const TAG_PREFIX_RE = /^<[a-zA-Z][a-zA-Z0-9_-]*[ >]/;
const BRACKET_TAG_RE = /^\[[a-zA-Z][a-zA-Z0-9_-]*:/;

function extractText(content: string | ContentBlock[] | undefined): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
  return texts.length ? texts.join(" ") : null;
}

function looksAutomated(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (TAG_PREFIX_RE.test(trimmed)) return true;
  if (BRACKET_TAG_RE.test(trimmed)) return true;
  if (trimmed.startsWith("Caveat:")) return true;
  if (trimmed === "[Request interrupted by user]") return true;
  return false;
}

export function processPrompt(state: AnalysisState, rec: SessionRecord): void {
  if (rec.type !== "user") return;
  if (rec.isSidechain) return;

  const text = extractText(rec.message?.content);
  if (text === null) return;
  if (looksAutomated(text)) {
    state.automatedPromptCount += 1;
    return;
  }

  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return;

  state.promptCount += 1;
  state.promptWordTotal += wordCount;

  if (wordCount > state.longestPromptWords) {
    state.longestPromptWords = wordCount;
  }
  if (wordCount < state.shortestPromptWords) {
    state.shortestPromptWords = wordCount;
  }

  if (rec.timestamp) {
    const dt = new Date(rec.timestamp);
    if (!Number.isNaN(dt.getTime())) {
      bumpNum(state.promptHours, dt.getUTCHours());
      const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      bump(state.promptWeekdays, weekday);
    }
  }

  if (trimmed.includes("?")) state.questionCount += 1;
  if (trimmed.includes("!")) state.exclaimCount += 1;
  if (trimmed === trimmed.toUpperCase() && wordCount > 2 && /[A-Z]/.test(trimmed)) {
    state.allCapsCount += 1;
  }
  if (SWEAR_EXACT_RE.test(trimmed)) state.swearCount += 1;
}
