import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState } from "../src/analyze/state.js";
import { collectClaudeMdSizes } from "../src/analyze/claudemd.js";

test("measures real CLAUDE.md file size for a seen cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-utility-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const projectDir = join(dir, "proj", "sub");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "CLAUDE.md"), "x".repeat(400));

    const state = createState();
    state.cwdsSeen.add(projectDir);
    collectClaudeMdSizes(state);

    assert.equal(state.claudeMdSizes.size, 1, "must not pick up the real machine's global ~/.claude/CLAUDE.md");
    const tokens = [...state.claudeMdSizes.values()][0];
    assert.equal(tokens, 100);
  } finally {
    process.env.HOME = originalHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deduplicates the same CLAUDE.md discovered from multiple cwds", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-utility-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    mkdirSync(join(dir, "proj"), { recursive: true });
    mkdirSync(join(dir, "proj", "a"), { recursive: true });
    mkdirSync(join(dir, "proj", "b"), { recursive: true });
    writeFileSync(join(dir, "proj", "CLAUDE.md"), "shared claude md content");

    const state = createState();
    state.cwdsSeen.add(join(dir, "proj", "a"));
    state.cwdsSeen.add(join(dir, "proj", "b"));
    collectClaudeMdSizes(state);

    assert.equal(state.claudeMdSizes.size, 1, "same resolved CLAUDE.md path must not be counted twice");
  } finally {
    process.env.HOME = originalHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
