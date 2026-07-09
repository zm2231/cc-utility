import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAssistant, collectCompaction, resolveChronological, type PendingSessionData } from "../src/analyze/resolve.js";

function assistantTurn(sessionId: unknown, id: string | undefined, tokens: number, timestamp: string) {
  return {
    type: "assistant",
    sessionId: sessionId as string,
    timestamp,
    message: id
      ? { id, role: "assistant", model: "m", usage: { input_tokens: tokens, output_tokens: tokens } }
      : { role: "assistant", model: "m", usage: { input_tokens: tokens, output_tokens: tokens } },
  };
}

test("cross-file duplicate message.id keeps the more complete record", () => {
  const pending = new Map<string, PendingSessionData>();
  collectAssistant(pending, assistantTurn("s1", "m1", 10, "2026-01-01T00:00:00Z"), "fileA");
  collectAssistant(pending, assistantTurn("s1", "m1", 100, "2026-01-01T00:00:01Z"), "fileB");
  const resolved = resolveChronological(pending.get("s1")!);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].message?.usage?.input_tokens, 100);
});

test("id-less records with identical shape are NOT silently merged", () => {
  const pending = new Map<string, PendingSessionData>();
  collectAssistant(pending, assistantTurn("s2", undefined, 5, "2026-01-01T00:00:00Z"), "fileA");
  collectAssistant(pending, assistantTurn("s2", undefined, 5, "2026-01-01T00:00:00Z"), "fileA");
  const resolved = resolveChronological(pending.get("s2")!);
  assert.equal(resolved.length, 2, "both distinct turns must be counted, not collapsed");
});

test("non-string sessionId groups under the file-path fallback consistently", () => {
  const pending = new Map<string, PendingSessionData>();
  collectAssistant(pending, assistantTurn({ weird: "object" }, "m1", 5, "2026-01-01T00:00:00Z"), "fileA");
  collectCompaction(pending, {
    type: "system",
    subtype: "compact_boundary",
    sessionId: { weird: "object" } as unknown as string,
    timestamp: "2026-01-01T00:00:01Z",
    compactMetadata: { trigger: "manual", preTokens: 100, postTokens: 10 },
  }, "fileA");
  assert.equal(pending.size, 1, "assistant and compaction with the same non-string sessionId must group together");
  const resolved = resolveChronological(pending.get("fileA")!);
  assert.equal(resolved.length, 2);
});

test("duplicate resolution merges usage and content across candidates instead of picking one winner", () => {
  const pending = new Map<string, PendingSessionData>();
  collectAssistant(pending, {
    type: "assistant",
    sessionId: "s4",
    timestamp: "2026-01-01T00:00:00Z",
    message: { id: "m1", role: "assistant", model: "m", usage: {}, content: [{ type: "tool_use", id: "t1", name: "Bash" }] },
  }, "fileA");
  collectAssistant(pending, {
    type: "assistant",
    sessionId: "s4",
    timestamp: "2026-01-01T00:00:01Z",
    message: { id: "m1", role: "assistant", model: "m", usage: { input_tokens: 100, output_tokens: 100 } },
  }, "fileA");
  const resolved = resolveChronological(pending.get("s4")!);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].message?.usage?.input_tokens, 100);
  const content = resolved[0].message?.content;
  assert.ok(Array.isArray(content) && content.some((b) => b.type === "tool_use" && b.name === "Bash"), "tool_use content must survive even though the usage-bearing duplicate carried no content");
});

test("duplicate resolution does not double-count id-less blocks at the same position", () => {
  const pending = new Map<string, PendingSessionData>();
  collectAssistant(pending, {
    type: "assistant",
    sessionId: "s5",
    timestamp: "2026-01-01T00:00:00Z",
    message: { id: "m1", role: "assistant", model: "m", usage: {}, content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] },
  }, "fileA");
  collectAssistant(pending, {
    type: "assistant",
    sessionId: "s5",
    timestamp: "2026-01-01T00:00:01Z",
    message: { id: "m1", role: "assistant", model: "m", usage: { input_tokens: 5 }, content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] },
  }, "fileA");
  const resolved = resolveChronological(pending.get("s5")!);
  assert.equal(resolved.length, 1);
  const content = resolved[0].message?.content;
  assert.ok(Array.isArray(content));
  assert.equal(content!.length, 1, "id-less blocks at the same position across duplicates must dedupe, not double-count");
});

test("duplicate resolution preserves both blocks when candidates disagree on type at the same position", () => {
  const pending = new Map<string, PendingSessionData>();
  collectAssistant(pending, {
    type: "assistant",
    sessionId: "s6",
    timestamp: "2026-01-01T00:00:00Z",
    message: { id: "m1", role: "assistant", model: "m", usage: {}, content: [{ type: "thinking", text: "short thought" }] },
  }, "fileA");
  collectAssistant(pending, {
    type: "assistant",
    sessionId: "s6",
    timestamp: "2026-01-01T00:00:01Z",
    message: { id: "m1", role: "assistant", model: "m", usage: { input_tokens: 5 }, content: [{ type: "tool_use", name: "Read" }] },
  }, "fileA");
  const resolved = resolveChronological(pending.get("s6")!);
  const content = resolved[0].message?.content;
  assert.ok(Array.isArray(content));
  assert.equal(content!.length, 2, "blocks of different types at the same position must both survive, never silently overwrite each other");
  assert.ok(content!.some((b) => b.type === "thinking"));
  assert.ok(content!.some((b) => b.type === "tool_use"));
});

test("chronological merge interleaves assistant turns and compaction events by timestamp", () => {
  const pending = new Map<string, PendingSessionData>();
  collectCompaction(pending, {
    type: "system",
    subtype: "compact_boundary",
    sessionId: "s3",
    timestamp: "2026-01-01T00:00:05Z",
    compactMetadata: { trigger: "manual", preTokens: 100, postTokens: 10 },
  }, "fileA");
  collectAssistant(pending, assistantTurn("s3", "m1", 1, "2026-01-01T00:00:00Z"), "fileA");
  collectAssistant(pending, assistantTurn("s3", "m2", 2, "2026-01-01T00:00:10Z"), "fileA");
  const resolved = resolveChronological(pending.get("s3")!);
  assert.equal(resolved.length, 3);
  assert.equal(resolved[0].message?.id, "m1");
  assert.equal(resolved[1].subtype, "compact_boundary");
  assert.equal(resolved[2].message?.id, "m2");
});
