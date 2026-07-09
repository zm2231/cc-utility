import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState } from "../src/analyze/state.js";
import { processHookAttachment, summarizeHooks, isSlowHook } from "../src/analyze/hooks.js";
import { processDenial, correlateDenials, topDenials } from "../src/analyze/denials.js";
import { processTokens, overallCacheHitRate } from "../src/analyze/tokens.js";
import { processTools } from "../src/analyze/tools.js";
import { processPrompt } from "../src/analyze/prompts.js";
import { scanCodex } from "../src/codex/scan.js";
import { buildRecentWindowRollup } from "../src/analyze/historySnapshot.js";
import { getDayBucket } from "../src/analyze/state.js";

test("hook attachments aggregate durations and flag timeouts; user-Esc cancels excluded", () => {
  const state = createState();
  processHookAttachment(state, {
    type: "attachment",
    attachment: { type: "hook_success", hookName: "Stop", hookEvent: "Stop", durationMs: 700 },
  });
  processHookAttachment(state, {
    type: "attachment",
    attachment: { type: "hook_success", hookName: "Stop", hookEvent: "Stop", durationMs: 900 },
  });
  processHookAttachment(state, {
    type: "attachment",
    attachment: { type: "hook_cancelled", hookName: "Stop", hookEvent: "Stop", timedOut: true, timeoutMs: 60000 },
  });
  processHookAttachment(state, {
    type: "attachment",
    attachment: { type: "hook_cancelled", hookName: "Stop", hookEvent: "Stop" },
  });
  processHookAttachment(state, {
    type: "attachment",
    attachment: { type: "deferred_tools_delta" },
  });

  const rows = summarizeHooks(state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].timeouts, 1);
  assert.equal(rows[0].maxMs, 60000);
  assert.ok(isSlowHook(rows[0]));
});

test("fast per-session hooks are not flagged slow", () => {
  const state = createState();
  for (let i = 0; i < 5; i++) {
    processHookAttachment(state, {
      type: "attachment",
      attachment: { type: "hook_success", hookName: "SessionStart:startup", hookEvent: "SessionStart", durationMs: 80 },
    });
  }
  const rows = summarizeHooks(state);
  assert.equal(rows[0].timeouts, 0);
  assert.ok(!isSlowHook(rows[0]));
});

test("denials resolve back to tool name and bash command head with kind mix", () => {
  const state = createState();
  processTools(
    state,
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "git log --oneline" } },
          { type: "tool_use", id: "t2", name: "mcp__foo__get_thing", input: {} },
        ],
      },
    },
    "s1",
  );
  processDenial(
    state,
    {
      type: "user",
      toolDenialKind: "user-rejected",
      message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
    },
    "s1",
  );
  processDenial(
    state,
    {
      type: "user",
      toolDenialKind: "permission-rule",
      message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
    },
    "s1",
  );
  processDenial(
    state,
    {
      type: "user",
      toolDenialKind: "automode-blocked",
      message: { content: [{ type: "tool_result", tool_use_id: "t2" }] },
    },
    "s1",
  );
  correlateDenials(state);

  assert.equal(state.denialsByKind.get("user-rejected"), 1);
  assert.equal(state.denialsByKind.get("permission-rule"), 1);
  const rows = topDenials(state, 10);
  assert.equal(rows[0].pattern, "Bash: git log");
  assert.equal(rows[0].count, 2);
  assert.deepEqual(rows[0].kinds, { "user-rejected": 1, "permission-rule": 1 });
  assert.equal(rows[1].pattern, "mcp__foo__get_thing");
});

test("user records without toolDenialKind are not counted as denials", () => {
  const state = createState();
  processDenial(state, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x" }] } }, "s1");
  assert.equal(state.denialsByKind.size, 0);
  assert.equal(state.denialEvents.length, 0);
});

test("recent-window cache hit rate counts cache writes as misses", () => {
  const state = createState();
  const bucket = getDayBucket(state, "2026-07-01");
  bucket.totalCacheRead = 800;
  bucket.totalInput = 100;
  bucket.totalCacheCreation = 100;
  const window = buildRecentWindowRollup(state, 30);
  assert.ok(window);
  assert.equal(window.cacheHitRate, 0.8);
});

test("cache hit rate counts cache writes as misses", () => {
  const state = createState();
  processTokens(
    state,
    { type: "assistant", message: { usage: { input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 } } },
    "s1",
  );
  assert.equal(overallCacheHitRate(state), 0.8);
});

test("first-turn context sums all input classes and skips continuation sessions and sidechains", () => {
  const state = createState();
  state.continuationSessions.add("cont");
  processTokens(
    state,
    { type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } } },
    "fresh",
  );
  processTokens(
    state,
    { type: "assistant", message: { usage: { input_tokens: 999, cache_read_input_tokens: 999 } } },
    "cont",
  );
  processTokens(
    state,
    { type: "assistant", isSidechain: true, message: { usage: { input_tokens: 50 } } },
    "side",
  );
  assert.deepEqual(state.firstTurnContext, [35]);
});

test("continuation prompts are detected, excluded from real prompts, and mark the session", () => {
  const state = createState();
  processPrompt(
    state,
    { type: "user", message: { content: "This session is being continued from a previous conversation that ran out of context." } },
    "s9",
  );
  assert.equal(state.promptCount, 0);
  assert.equal(state.automatedPromptCount, 1);
  assert.ok(state.continuationSessions.has("s9"));
});

test("sidechain and project token attribution split from main-line totals", () => {
  const state = createState();
  processTokens(
    state,
    { type: "assistant", cwd: "/repo/a", message: { usage: { input_tokens: 10, output_tokens: 100 } } },
    "s1",
  );
  processTokens(
    state,
    { type: "assistant", cwd: "/repo/a", isSidechain: true, message: { usage: { output_tokens: 40 } } },
    "s1",
  );
  assert.equal(state.totalOutput, 140);
  assert.equal(state.sidechainOutput, 40);
  const proj = state.projectStats.get("/repo/a");
  assert.ok(proj);
  assert.equal(proj.output, 140);
  assert.equal(proj.sessionIds.size, 1);
});

test("scanCodex aggregates session meta, models, tools, exec heads, final usage, and rate limits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ccu-codex-"));
  const file = join(dir, "rollout-test.jsonl");
  const lines = [
    { timestamp: "2026-07-01T00:00:00.000Z", type: "session_meta", payload: { id: "sess1", cwd: "/repo/x", originator: "codex_exec" } },
    { timestamp: "2026-07-01T00:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.5", approval_policy: "never", sandbox_policy: { type: "workspace-write" } } },
    { timestamp: "2026-07-01T00:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "git status --short" }) } },
    { timestamp: "2026-07-01T00:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "list_projects", arguments: "{}" } },
    { timestamp: "2026-07-01T00:00:04.000Z", type: "event_msg", payload: { type: "user_message", message: "hi" } },
    { timestamp: "2026-07-01T00:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50, reasoning_output_tokens: 10 }, last_token_usage: { input_tokens: 1000, output_tokens: 50 }, model_context_window: 10000 }, rate_limits: { primary: { used_percent: 5 }, secondary: { used_percent: 12 }, plan_type: "pro" } } },
    { timestamp: "2026-07-01T00:10:06.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 120, reasoning_output_tokens: 30 }, last_token_usage: { input_tokens: 1200, output_tokens: 70 }, model_context_window: 10000 }, rate_limits: { primary: { used_percent: 6 }, secondary: { used_percent: 12 } } } },
    { timestamp: "2026-07-01T00:10:07.000Z", type: "event_msg", payload: { type: "task_complete" } },
    { timestamp: "2026-07-01T00:10:08.000Z", type: "session_meta", payload: { id: "sess1", cwd: "/repo/x", originator: "codex_exec" } },
  ];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const state = await scanCodex([file]);
  assert.ok(state);
  assert.equal(state.sessions, 1);
  assert.equal(state.totalInput, 2000);
  assert.equal(state.totalCachedInput, 1500);
  assert.equal(state.totalOutput, 120);
  assert.equal(state.models.get("gpt-5.5"), 1);
  assert.equal(state.toolCalls.get("exec_command"), 1);
  assert.equal(state.execHeads.get("git status"), 1);
  assert.equal(state.userMessages, 1);
  assert.equal(state.turnsCompleted, 1);
  assert.equal(state.contextWindowFillRatios.length, 1);
  assert.ok(Math.abs(state.contextWindowFillRatios[0] - 1200 / 10000) < 1e-9);
  assert.equal(state.planTypes.get("pro"), 1);
  assert.ok(state.rateLimitSamples.length >= 1);
});

test("scanCodex returns null for an empty file list", async () => {
  assert.equal(await scanCodex([]), null);
});

test("resumed Codex sessions across files count once and take max cumulative totals, not the sum", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ccu-codex-resume-"));
  const fileA = join(dir, "rollout-a.jsonl");
  const fileB = join(dir, "rollout-b.jsonl");
  writeFileSync(
    fileA,
    [
      { timestamp: "2026-07-01T00:00:00.000Z", type: "session_meta", payload: { id: "s1", cwd: "/r" } },
      { timestamp: "2026-07-01T00:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10, reasoning_output_tokens: 1 }, last_token_usage: { input_tokens: 100 }, model_context_window: 1000 } } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  writeFileSync(
    fileB,
    [
      { timestamp: "2026-07-01T01:00:00.000Z", type: "session_meta", payload: { id: "s1", cwd: "/r" } },
      { timestamp: "2026-07-01T01:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 80, output_tokens: 25, reasoning_output_tokens: 2 }, last_token_usage: { input_tokens: 400 }, model_context_window: 1000 } } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  const state = await scanCodex([fileA, fileB]);
  assert.ok(state);
  assert.equal(state.sessions, 1);
  assert.equal(state.totalInput, 150);
  assert.equal(state.totalOutput, 25);
  assert.equal(state.contextWindowFillRatios.length, 1);
  assert.ok(Math.abs(state.contextWindowFillRatios[0] - 0.4) < 1e-9);
});

test("rate-limit hourly downsampling keeps the latest-by-timestamp sample and peaks survive downsampling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ccu-codex-rl-"));
  const fileLate = join(dir, "a-late.jsonl");
  const fileEarly = join(dir, "b-early.jsonl");
  writeFileSync(
    fileLate,
    JSON.stringify({ timestamp: "2026-07-01T05:30:00.000Z", type: "event_msg", payload: { type: "token_count", info: {}, rate_limits: { primary: { used_percent: 10 }, secondary: { used_percent: 20 } } } }) + "\n",
  );
  writeFileSync(
    fileEarly,
    JSON.stringify({ timestamp: "2026-07-01T05:10:00.000Z", type: "event_msg", payload: { type: "token_count", info: {}, rate_limits: { primary: { used_percent: 90 }, secondary: { used_percent: 95 } } } }) + "\n",
  );
  const state = await scanCodex([fileLate, fileEarly]);
  assert.ok(state);
  assert.equal(state.rateLimitSamples.length, 1);
  assert.equal(state.rateLimitSamples[0].primaryPct, 10);
  assert.equal(state.peakPrimaryPct, 90);
  assert.equal(state.peakSecondaryPct, 95);
});
