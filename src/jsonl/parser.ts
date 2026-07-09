import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionRecord } from "./types.js";

export async function* readRecords(filePath: string): AsyncGenerator<SessionRecord> {
  let stream;
  try {
    stream = createReadStream(filePath, { encoding: "utf-8" });
  } catch {
    return;
  }
  stream.on("error", () => {});

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      yield parsed as SessionRecord;
    }
  } catch {
    return;
  }
}
