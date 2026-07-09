import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.js");

test("end-to-end: real paths/session IDs shown (local tool, nothing transmitted), but never raw message/tool-output content", { skip: !existsSync(CLI) && "run `npm run build` first" }, () => {
  const home = mkdtempSync(join(tmpdir(), "cc-utility-e2e-"));
  const projDir = join(home, ".claude", "projects", "test-proj");
  mkdirSync(projDir, { recursive: true });

  const claudeMdDir = join(home, "client-project");
  mkdirSync(claudeMdDir, { recursive: true });
  writeFileSync(join(claudeMdDir, "CLAUDE.md"), "some project instructions here");

  const lines = [
    "null",
    "[1,2,3]",
    JSON.stringify({ type: "user", sessionId: "REAL_SESSION_ID", cwd: claudeMdDir, message: { content: "PROMPT_TEXT_BODY please help me with TOKEN_LOOKING_VALUE" } }),
    JSON.stringify({
      type: "assistant",
      sessionId: "REAL_SESSION_ID",
      timestamp: "2026-01-01T00:00:00Z",
      message: { id: "m1", model: "claude-sonnet-5", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 200_000 }, content: [{ type: "tool_use", name: "Read", input: { file_path: "/some/path/afile.ts" } }] },
    }),
    JSON.stringify({
      type: "user",
      sessionId: "REAL_SESSION_ID",
      message: { content: [{ type: "tool_result", is_error: true, content: "The tool use was rejected. RAW_TOOL_OUTPUT_BODY" }] },
    }),
    JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: "REAL_SESSION_ID", timestamp: "2026-01-01T00:00:01Z", compactMetadata: { trigger: "manual", preTokens: 1000, postTokens: 100 } }),
  ];
  writeFileSync(join(projDir, "session.jsonl"), lines.join("\n") + "\n");

  const output = execFileSync(process.execPath, [CLI, "--json"], {
    env: { ...process.env, HOME: home },
    encoding: "utf-8",
  });

  assert.ok(output.includes("client-project"), "real CLAUDE.md path should be shown, not anonymized");
  assert.ok(output.includes("REAL_SESSION_ID"), "real session ID should be shown, not anonymized");

  const forbiddenContent = ["PROMPT_TEXT_BODY", "TOKEN_LOOKING_VALUE", "RAW_TOOL_OUTPUT_BODY"];
  for (const marker of forbiddenContent) {
    assert.ok(!output.includes(marker), `output must not contain raw content marker "${marker}"`);
  }

  const parsed = JSON.parse(output);
  assert.equal(parsed.governance.rejectedToolUseCount, 1);
  assert.ok(Object.keys(parsed.claudeMdFiles).length >= 1);

  rmSync(home, { recursive: true, force: true });
});
