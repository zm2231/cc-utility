import { test } from "node:test";
import assert from "node:assert/strict";
import { createState } from "../src/analyze/state.js";
import { processGovernance, isInterruptedMessage } from "../src/analyze/governance.js";

function toolResult(text: string, isError = true) {
  return {
    type: "user",
    sessionId: "s1",
    message: {
      content: [{ type: "tool_result", is_error: isError, content: text }],
    },
  };
}

test("counts canonical rejection phrasing (tool use ... rejected)", () => {
  const state = createState();
  processGovernance(state, toolResult("The tool use was rejected. STOP."), "s1");
  assert.equal(state.rejectedToolUseCount, 1);
});

test("counts reversed rejection phrasing (rejected ... tool use)", () => {
  const state = createState();
  processGovernance(state, toolResult("User rejected tool use"), "s1");
  assert.equal(state.rejectedToolUseCount, 1);
});

test("does not count unrelated text mentioning reject/tool separately", () => {
  const state = createState();
  processGovernance(state, toolResult("non rejection tool failure"), "s1");
  assert.equal(state.rejectedToolUseCount, 0);
  assert.equal(state.toolErrorCount, 1);
});

test("does not count distant reject/tool words beyond the gap window", () => {
  const state = createState();
  const text = "grep rejected.diff failed while a totally unrelated tool ran elsewhere in this long sentence";
  processGovernance(state, toolResult(text), "s1");
  assert.equal(state.rejectedToolUseCount, 0);
});

test("only counts rejection inside is_error tool_result blocks", () => {
  const state = createState();
  processGovernance(state, toolResult("tool use was rejected", false), "s1");
  assert.equal(state.toolErrorCount, 0);
  assert.equal(state.rejectedToolUseCount, 0);
});

test("interrupt detection matches exact client string", () => {
  const state = createState();
  processGovernance(state, {
    type: "user",
    sessionId: "s1",
    message: { content: "[Request interrupted by user]" },
  }, "s1");
  assert.equal(state.interruptCount, 1);
});

test("interrupt detection does not crash on non-string text block", () => {
  assert.doesNotThrow(() => {
    isInterruptedMessage([{ type: "text", text: 123 as unknown as string }]);
  });
});

test("interrupt marker and tool_result in same content array both count", () => {
  const state = createState();
  processGovernance(state, {
    type: "user",
    sessionId: "s1",
    message: {
      content: [
        { type: "text", text: "[Request interrupted by user]" },
        { type: "tool_result", is_error: true, content: "tool use was rejected" },
      ],
    },
  }, "s1");
  assert.equal(state.interruptCount, 1);
  assert.equal(state.rejectedToolUseCount, 1);
});

test("malformed content shapes do not crash processGovernance", () => {
  assert.doesNotThrow(() => {
    const state = createState();
    processGovernance(state, { type: "user", message: { content: null as unknown as string } }, "s1");
    processGovernance(state, { type: "user", message: { content: [null as unknown as never] } }, "s1");
    processGovernance(state, { type: "user", message: { content: [{ type: "tool_result", is_error: true, content: 42 as unknown as string }] } }, "s1");
  });
});
