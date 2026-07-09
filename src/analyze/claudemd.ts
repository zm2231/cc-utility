import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AnalysisState } from "./state.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function walkUpForClaudeMd(startDir: string): string[] {
  const found: string[] = [];
  let dir = resolve(startDir);
  let prev = "";
  while (dir !== prev) {
    const candidate = join(dir, "CLAUDE.md");
    if (existsSync(candidate)) found.push(candidate);
    prev = dir;
    dir = dirname(dir);
  }
  return found;
}

export function collectClaudeMdSizes(state: AnalysisState): void {
  const allPaths = new Set<string>();

  const globalPath = join(homedir(), ".claude", "CLAUDE.md");
  if (existsSync(globalPath)) allPaths.add(globalPath);

  for (const cwd of state.cwdsSeen) {
    try {
      for (const p of walkUpForClaudeMd(cwd)) allPaths.add(p);
    } catch {
      continue;
    }
  }

  for (const p of allPaths) {
    try {
      const text = readFileSync(p, "utf-8");
      state.claudeMdSizes.set(p, estimateTokens(text));
    } catch {
      continue;
    }
  }
}
