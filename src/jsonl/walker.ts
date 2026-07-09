import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultProjectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

export function findSessionFiles(root: string, minMtimeMs = 0): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (entry.endsWith(".jsonl")) {
        if (minMtimeMs && st.mtimeMs < minMtimeMs) continue;
        out.push(full);
      }
    }
  }
  return out;
}
