import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "../src/jsonl/parser.js";

async function collect(path: string) {
  const out = [];
  for await (const rec of readRecords(path)) out.push(rec);
  return out;
}

test("skips null/array/scalar/invalid top-level JSONL lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-utility-test-"));
  const file = join(dir, "malformed.jsonl");
  writeFileSync(
    file,
    ["null", "[1,2,3]", "42", '"just a string"', "not json at all", '{"type":"user","sessionId":"s1"}'].join("\n"),
  );
  const recs = await collect(file);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].sessionId, "s1");
  rmSync(dir, { recursive: true, force: true });
});

test("unreadable file does not throw, yields nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-utility-test-"));
  const file = join(dir, "noperm.jsonl");
  writeFileSync(file, '{"type":"user"}\n');
  chmodSync(file, 0o000);
  await assert.doesNotReject(async () => {
    const recs = await collect(file);
    assert.equal(recs.length, 0);
  });
  chmodSync(file, 0o644);
  rmSync(dir, { recursive: true, force: true });
});

test("missing file does not throw", async () => {
  await assert.doesNotReject(async () => {
    const recs = await collect("/nonexistent/path/does-not-exist.jsonl");
    assert.equal(recs.length, 0);
  });
});
