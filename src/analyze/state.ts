export interface AnalysisState {
  filesTotal: number;
  filesProcessed: number;

  totalInput: number;
  totalOutput: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  modelTurns: Map<string, number>;
  cacheByMonth: Map<string, [number, number]>;
  firstTurnCacheRead: number[];
  sessionsSeenForFirstTurn: Set<string>;

  toolCounts: Map<string, number>;
  fileExtCounts: Map<string, number>;

  promptCount: number;
  promptWordTotal: number;
  promptHours: Map<number, number>;
  promptWeekdays: Map<string, number>;
  questionCount: number;
  exclaimCount: number;
  allCapsCount: number;
  swearCount: number;
  longestPromptWords: number;
  shortestPromptWords: number;

  automatedPromptCount: number;

  sessionContext: Map<string, SessionContextEntry>;

  interruptCount: number;
  rejectedToolUseCount: number;
  toolErrorCount: number;
  toolResultCount: number;

  skillCounts: Map<string, number>;
  skillUserInvoked: Map<string, number>;

  claudeMdSizes: Map<string, number>;
  cwdsSeen: Set<string>;
  cwdSessions: Map<string, Set<string>>;

  turnDurationsMs: number[];

  awaySummaryCount: number;
  scheduledTaskFireCount: number;
  scheduleWakeupDelays: number[];

  toolUseNameById: Map<string, string>;
  toolResultEvents: Array<{ sessionId: string; toolUseId: string; isError: boolean; dateKey: string | null }>;
  toolResultCountByTool: Map<string, number>;
  toolErrorCountByTool: Map<string, number>;

  sidechainRecordCount: number;
  sidechainSessionIds: Set<string>;

  compactionRatios: number[];

  snapshotCount: number;
  snapshotTrackedFileCounts: number[];
  fileTouchCounts: Map<string, number>;

  queueOpCounts: Map<string, number>;

  dayBuckets: Map<string, DayBucket>;
}

export interface DayBucket {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  toolResultCount: number;
  toolErrorCount: number;
  toolResultsByTool: Map<string, { results: number; errors: number }>;
  compactionRatios: number[];
  turnDurationsMs: number[];
  agentToolCalls: number;
  bashToolCalls: number;
  totalToolCalls: number;
  queueEnqueueCount: number;
  sessionIds: Set<string>;
}

export interface SessionContextEntry {
  latestContext: number;
  compactionCount: number;
  manualCompactions: number;
  autoCompactions: number;
  tokensReclaimed: number;
  lastCompactionPostTokens: number | null;
}

export function createState(): AnalysisState {
  return {
    filesTotal: 0,
    filesProcessed: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheCreation: 0,
    totalCacheRead: 0,
    modelTurns: new Map(),
    cacheByMonth: new Map(),
    firstTurnCacheRead: [],
    sessionsSeenForFirstTurn: new Set(),
    toolCounts: new Map(),
    fileExtCounts: new Map(),
    promptCount: 0,
    promptWordTotal: 0,
    promptHours: new Map(),
    promptWeekdays: new Map(),
    questionCount: 0,
    exclaimCount: 0,
    allCapsCount: 0,
    swearCount: 0,
    longestPromptWords: 0,
    shortestPromptWords: Number.MAX_SAFE_INTEGER,
    automatedPromptCount: 0,
    sessionContext: new Map(),
    interruptCount: 0,
    rejectedToolUseCount: 0,
    toolErrorCount: 0,
    toolResultCount: 0,
    skillCounts: new Map(),
    skillUserInvoked: new Map(),
    claudeMdSizes: new Map(),
    cwdsSeen: new Set(),
    cwdSessions: new Map(),
    turnDurationsMs: [],
    awaySummaryCount: 0,
    scheduledTaskFireCount: 0,
    scheduleWakeupDelays: [],
    toolUseNameById: new Map(),
    toolResultEvents: [],
    toolResultCountByTool: new Map(),
    toolErrorCountByTool: new Map(),
    sidechainRecordCount: 0,
    sidechainSessionIds: new Set(),
    compactionRatios: [],
    snapshotCount: 0,
    snapshotTrackedFileCounts: [],
    fileTouchCounts: new Map(),
    queueOpCounts: new Map(),
    dayBuckets: new Map(),
  };
}

export function dateKeyOf(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function getDayBucket(state: AnalysisState, dateKey: string): DayBucket {
  let bucket = state.dayBuckets.get(dateKey);
  if (!bucket) {
    bucket = {
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheCreation: 0,
      toolResultCount: 0,
      toolErrorCount: 0,
      toolResultsByTool: new Map(),
      compactionRatios: [],
      turnDurationsMs: [],
      agentToolCalls: 0,
      bashToolCalls: 0,
      totalToolCalls: 0,
      queueEnqueueCount: 0,
      sessionIds: new Set(),
    };
    state.dayBuckets.set(dateKey, bucket);
  }
  return bucket;
}

export function getSessionContext(state: AnalysisState, sessionId: string): SessionContextEntry {
  let entry = state.sessionContext.get(sessionId);
  if (!entry) {
    entry = {
      latestContext: 0,
      compactionCount: 0,
      manualCompactions: 0,
      autoCompactions: 0,
      tokensReclaimed: 0,
      lastCompactionPostTokens: null,
    };
    state.sessionContext.set(sessionId, entry);
  }
  return entry;
}

export function safeNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function bumpNum(map: Map<number, number>, key: number, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function topN(map: Map<string, number>, n: number): Array<[string, number]> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
