export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlock[];
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface ClaudeMessage {
  id?: string;
  role?: string;
  model?: string;
  usage?: Usage;
  content?: string | ContentBlock[];
}

export interface CompactMetadata {
  trigger?: string;
  preTokens?: number;
  postTokens?: number;
  durationMs?: number;
}

export interface FileHistorySnapshot {
  trackedFileBackups?: Record<string, unknown>;
}

export interface SessionRecord {
  type?: string;
  subtype?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  userType?: string;
  requestId?: string;
  message?: ClaudeMessage;
  compactMetadata?: CompactMetadata;
  content?: string;
  operation?: string;
  snapshot?: FileHistorySnapshot;
  durationMs?: number;
  messageCount?: number;
}
