import { homedir } from "node:os";
import { join } from "node:path";
import { findSessionFiles } from "../jsonl/walker.js";
import { readRecords } from "../jsonl/parser.js";
import { bump, percentile, safeNum, topN } from "../analyze/state.js";

export function defaultCodexRoot(): string {
  return join(homedir(), ".codex", "sessions");
}

export function findCodexFiles(root: string, minMtimeMs = 0): string[] {
  return findSessionFiles(root, minMtimeMs);
}

interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    source?: string;
    originator?: string;
    model?: string;
    effort?: string;
    approval_policy?: string;
    sandbox_policy?: { type?: string };
    name?: string;
    arguments?: string;
    message?: string;
    info?: {
      total_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
      };
      last_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
      };
      model_context_window?: number;
    };
    rate_limits?: {
      primary?: { used_percent?: number; window_minutes?: number };
      secondary?: { used_percent?: number; window_minutes?: number };
      plan_type?: string;
    };
  };
}

export interface CodexRateLimitSample {
  ts: number;
  primaryPct: number | null;
  secondaryPct: number | null;
}

export interface CodexState {
  filesScanned: number;
  sessions: number;
  totalInput: number;
  totalCachedInput: number;
  totalOutput: number;
  totalReasoningOutput: number;
  models: Map<string, number>;
  toolCalls: Map<string, number>;
  execHeads: Map<string, number>;
  cwdSessions: Map<string, Set<string>>;
  sources: Map<string, number>;
  approvalPolicies: Map<string, number>;
  sandboxTypes: Map<string, number>;
  userMessages: number;
  turnsStarted: number;
  turnsCompleted: number;
  daily: Map<string, { input: number; output: number }>;
  rateLimitSamples: CodexRateLimitSample[];
  peakPrimaryPct: number;
  peakSecondaryPct: number;
  planTypes: Map<string, number>;
  contextWindowFillRatios: number[];
  firstTs: number | null;
  lastTs: number | null;
}

function createCodexState(): CodexState {
  return {
    filesScanned: 0,
    sessions: 0,
    totalInput: 0,
    totalCachedInput: 0,
    totalOutput: 0,
    totalReasoningOutput: 0,
    models: new Map(),
    toolCalls: new Map(),
    execHeads: new Map(),
    cwdSessions: new Map(),
    sources: new Map(),
    approvalPolicies: new Map(),
    sandboxTypes: new Map(),
    userMessages: 0,
    turnsStarted: 0,
    turnsCompleted: 0,
    daily: new Map(),
    rateLimitSamples: [],
    peakPrimaryPct: 0,
    peakSecondaryPct: 0,
    planTypes: new Map(),
    contextWindowFillRatios: [],
    firstTs: null,
    lastTs: null,
  };
}

function execHead(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { cmd?: unknown };
    if (typeof parsed.cmd !== "string") return null;
    const head = parsed.cmd.trim().split(/\s+/).slice(0, 2).join(" ");
    return head || null;
  } catch {
    return null;
  }
}

const RATE_LIMIT_SAMPLE_INTERVAL_MS = 3_600_000;

export async function scanCodex(files: string[], minTs = 0): Promise<CodexState | null> {
  if (!files.length) return null;
  const state = createCodexState();
  const hourlySamples = new Map<number, CodexRateLimitSample>();
  const sessionIds = new Set<string>();
  const prevTurnKeyBySession = new Map<string, string>();
  const seenTurnEventsBySession = new Map<string, Set<string>>();
  const fillBySession = new Map<string, { fill: number; ts: number }>();

  for (const file of files) {
    let sessionId = file;

    for await (const raw of readRecords(file)) {
      const rec = raw as CodexRecord;
      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
      const inWindow = !minTs || Number.isNaN(ts) || ts >= minTs;
      const p = rec.payload;
      if (!p) continue;
      if (!inWindow && rec.type !== "session_meta" && p.type !== "token_count") continue;
      if (inWindow && !Number.isNaN(ts)) {
        if (state.firstTs === null || ts < state.firstTs) state.firstTs = ts;
        if (state.lastTs === null || ts > state.lastTs) state.lastTs = ts;
      }

      if (rec.type === "session_meta") {
        if (typeof p.id === "string" && p.id) sessionId = p.id;
        if (!sessionIds.has(sessionId)) {
          sessionIds.add(sessionId);
          state.sessions += 1;
        }
        if (typeof p.cwd === "string" && p.cwd) {
          let set = state.cwdSessions.get(p.cwd);
          if (!set) {
            set = new Set();
            state.cwdSessions.set(p.cwd, set);
          }
          set.add(sessionId);
        }
        const source = typeof p.originator === "string" && p.originator ? p.originator : (p.source ?? "unknown");
        bump(state.sources, String(source));
        continue;
      }

      if (rec.type === "turn_context") {
        if (typeof p.model === "string" && p.model) bump(state.models, p.model);
        if (typeof p.approval_policy === "string") bump(state.approvalPolicies, p.approval_policy);
        if (typeof p.sandbox_policy?.type === "string") bump(state.sandboxTypes, p.sandbox_policy.type);
        continue;
      }

      if (rec.type === "response_item" && p.type === "function_call") {
        const name = typeof p.name === "string" && p.name ? p.name : "unknown";
        bump(state.toolCalls, name);
        if (name === "exec_command" && typeof p.arguments === "string") {
          const head = execHead(p.arguments);
          if (head) bump(state.execHeads, head);
        }
        continue;
      }

      if (rec.type === "event_msg") {
        if (p.type === "user_message") state.userMessages += 1;
        else if (p.type === "task_started") state.turnsStarted += 1;
        else if (p.type === "task_complete") state.turnsCompleted += 1;
        else if (p.type === "token_count") {
          const turn = p.info?.last_token_usage;
          if (turn) {
            const t = {
              input: safeNum(turn.input_tokens),
              cached: safeNum(turn.cached_input_tokens),
              output: safeNum(turn.output_tokens),
              reasoning: safeNum(turn.reasoning_output_tokens),
            };
            const key = `${t.input}|${t.cached}|${t.output}|${t.reasoning}`;
            let seen = seenTurnEventsBySession.get(sessionId);
            if (!seen) {
              seen = new Set();
              seenTurnEventsBySession.set(sessionId, seen);
            }
            const eventId = `${rec.timestamp ?? ""}|${key}`;
            const isRepeat = key === prevTurnKeyBySession.get(sessionId) || seen.has(eventId);
            prevTurnKeyBySession.set(sessionId, key);
            seen.add(eventId);
            if (inWindow && !isRepeat) {
              state.totalInput += t.input;
              state.totalCachedInput += t.cached;
              state.totalOutput += t.output;
              state.totalReasoningOutput += t.reasoning;
              if (!Number.isNaN(ts)) {
                const dateKey = new Date(ts).toISOString().slice(0, 10);
                const day = state.daily.get(dateKey) ?? { input: 0, output: 0 };
                day.input += t.input;
                day.output += t.output;
                state.daily.set(dateKey, day);
              }
            }
            const window = safeNum(p.info?.model_context_window);
            if (inWindow && window > 0 && t.input > 0) {
              const existing = fillBySession.get(sessionId);
              const fillTs = Number.isNaN(ts) ? existing?.ts ?? 0 : ts;
              if (!existing || fillTs >= existing.ts) {
                fillBySession.set(sessionId, { fill: t.input / window, ts: fillTs });
              }
            }
          }
          const rl = p.rate_limits;
          if (inWindow && rl && !Number.isNaN(ts)) {
            const primaryPct = typeof rl.primary?.used_percent === "number" ? rl.primary.used_percent : null;
            const secondaryPct = typeof rl.secondary?.used_percent === "number" ? rl.secondary.used_percent : null;
            if (primaryPct !== null) state.peakPrimaryPct = Math.max(state.peakPrimaryPct, primaryPct);
            if (secondaryPct !== null) state.peakSecondaryPct = Math.max(state.peakSecondaryPct, secondaryPct);
            const hourKey = Math.floor(ts / RATE_LIMIT_SAMPLE_INTERVAL_MS);
            const existing = hourlySamples.get(hourKey);
            if (!existing || ts >= existing.ts) {
              hourlySamples.set(hourKey, { ts, primaryPct, secondaryPct });
            }
            if (typeof rl.plan_type === "string" && rl.plan_type) bump(state.planTypes, rl.plan_type);
          }
        }
      }
    }

    state.filesScanned += 1;
  }

  state.contextWindowFillRatios = [...fillBySession.values()].map((f) => f.fill);
  state.rateLimitSamples = [...hourlySamples.values()].sort((a, b) => a.ts - b.ts);
  return state;
}

export function buildCodexReport(state: CodexState) {
  const latestSample = state.rateLimitSamples.length
    ? state.rateLimitSamples[state.rateLimitSamples.length - 1]
    : null;
  return {
    filesScanned: state.filesScanned,
    sessions: state.sessions,
    window: {
      firstTs: state.firstTs ? new Date(state.firstTs).toISOString() : null,
      lastTs: state.lastTs ? new Date(state.lastTs).toISOString() : null,
    },
    tokens: {
      totalInput: state.totalInput,
      totalCachedInput: state.totalCachedInput,
      totalOutput: state.totalOutput,
      totalReasoningOutput: state.totalReasoningOutput,
      cacheShareOfInput: state.totalInput ? state.totalCachedInput / state.totalInput : 0,
    },
    models: Object.fromEntries(topN(state.models, 10)),
    toolCalls: Object.fromEntries(topN(state.toolCalls, 15)),
    execCommandHeads: Object.fromEntries(topN(state.execHeads, 15)),
    workspaces: Object.fromEntries(
      topN(new Map([...state.cwdSessions].map(([dir, ids]) => [dir, ids.size])), 15),
    ),
    sources: Object.fromEntries(state.sources),
    approvalPolicies: Object.fromEntries(state.approvalPolicies),
    sandboxTypes: Object.fromEntries(state.sandboxTypes),
    userMessages: state.userMessages,
    turnsStarted: state.turnsStarted,
    turnsCompleted: state.turnsCompleted,
    daily: [...state.daily.entries()]
      .map(([date, d]) => ({ date, input: d.input, output: d.output }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    planTypes: Object.fromEntries(state.planTypes),
    contextWindowFill: {
      sessionsMeasured: state.contextWindowFillRatios.length,
      medianEndOfSessionFill: percentile(state.contextWindowFillRatios, 0.5),
      p90EndOfSessionFill: percentile(state.contextWindowFillRatios, 0.9),
      note: "Fill = the final turn's full prompt (last_token_usage.input_tokens, the live context re-sent on that call) over model_context_window. Cumulative session input counts the context once per turn and would exceed 100%.",
    },
    rateLimits: {
      samples: state.rateLimitSamples.length,
      latest: latestSample
        ? {
            at: new Date(latestSample.ts).toISOString(),
            primaryPct: latestSample.primaryPct,
            secondaryPct: latestSample.secondaryPct,
          }
        : null,
      peakPrimaryPct: state.peakPrimaryPct,
      peakSecondaryPct: state.peakSecondaryPct,
      series: state.rateLimitSamples,
    },
  };
}

export type CodexReport = ReturnType<typeof buildCodexReport>;
