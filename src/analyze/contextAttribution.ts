import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AnalysisState } from "./state.js";

export interface AttributionItem {
  component: string;
  detail: string;
  estTokens: number;
  count: number;
}

export interface ContextAttribution {
  items: AttributionItem[];
  claudeMdByProject: Array<{ cwd: string; estTokens: number }>;
  skillListingBudgetTokens: number;
  note: string;
}

function estTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

interface SkillEntry {
  name: string;
  chars: number;
  modelInvocable: boolean;
}

function readSkillEntries(skillsDir: string): SkillEntry[] {
  const out: SkillEntry[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(skillsDir);
  } catch {
    return out;
  }
  for (const name of dirs) {
    let raw: string;
    try {
      raw = readFileSync(join(skillsDir, name, "SKILL.md"), "utf-8");
    } catch {
      continue;
    }
    const fm = raw.startsWith("---\n") ? raw.slice(4, raw.indexOf("\n---", 4)) : "";
    const descMatch = fm.match(/^description:\s*([\s\S]*?)(?=^\w[\w-]*:|$(?![\s\S]))/m);
    const desc = descMatch ? descMatch[1] : "";
    const modelInvocable = !/^disable-model-invocation:\s*true/m.test(fm);
    out.push({ name, chars: name.length + desc.length, modelInvocable });
  }
  return out;
}

function readAgentListingChars(agentsDir: string): { count: number; chars: number } {
  let files: string[];
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return { count: 0, chars: 0 };
  }
  let chars = 0;
  let count = 0;
  for (const f of files) {
    let raw: string;
    try {
      raw = readFileSync(join(agentsDir, f), "utf-8");
    } catch {
      continue;
    }
    if (!raw.startsWith("---\n")) continue;
    const fm = raw.slice(4, raw.indexOf("\n---", 4));
    if (!/^name:/m.test(fm)) continue;
    const descMatch = fm.match(/^description:\s*([\s\S]*?)(?=^\w[\w-]*:|$(?![\s\S]))/m);
    chars += (descMatch ? descMatch[1].length : 0) + f.length;
    count += 1;
  }
  return { count, chars };
}

function countMcpServerNames(claudeJsonPath: string): { count: number; nameChars: number } {
  try {
    const parsed = JSON.parse(readFileSync(claudeJsonPath, "utf-8")) as { mcpServers?: Record<string, unknown> };
    const names = Object.keys(parsed.mcpServers ?? {});
    return { count: names.length, nameChars: names.reduce((a, n) => a + n.length, 0) };
  } catch {
    return { count: 0, nameChars: 0 };
  }
}

export function buildContextAttribution(state: AnalysisState, contextWindow = 200_000): ContextAttribution {
  const home = homedir();
  const items: AttributionItem[] = [];

  const globalClaudeMd = state.claudeMdSizes.get(join(home, ".claude", "CLAUDE.md")) ?? 0;
  items.push({
    component: "Global CLAUDE.md (every session)",
    detail: "~/.claude/CLAUDE.md loads in every project",
    estTokens: globalClaudeMd,
    count: globalClaudeMd ? 1 : 0,
  });

  const perProject: Array<{ cwd: string; estTokens: number }> = [];
  for (const cwd of state.cwdsSeen) {
    let total = 0;
    let dir = cwd;
    let prev = "";
    while (dir !== prev) {
      const size = state.claudeMdSizes.get(join(dir, "CLAUDE.md")) ?? 0;
      if (dir === home) break;
      total += size;
      prev = dir;
      dir = dirname(dir);
    }
    if (total > 0) perProject.push({ cwd, estTokens: total });
  }
  perProject.sort((a, b) => b.estTokens - a.estTokens);
  const perProjectTotals = perProject.map((p) => p.estTokens).sort((a, b) => a - b);
  const medianProject = perProjectTotals.length ? perProjectTotals[Math.floor(perProjectTotals.length / 2)] : 0;
  const maxProject = perProjectTotals.length ? perProjectTotals[perProjectTotals.length - 1] : 0;
  items.push({
    component: "Project CLAUDE.md (typical session)",
    detail: `median across ${perProjectTotals.length} project(s) with a CLAUDE.md; heaviest project loads ~${maxProject.toLocaleString("en-US")} tok`,
    estTokens: medianProject,
    count: perProjectTotals.length,
  });

  const skillDirs = [join(home, ".claude", "skills")];
  for (const cwd of state.cwdsSeen) {
    const p = join(cwd, ".claude", "skills");
    if (existsSync(p)) skillDirs.push(p);
  }
  let skillChars = 0;
  let skillCount = 0;
  let hiddenCount = 0;
  const seen = new Set<string>();
  for (const dir of skillDirs) {
    for (const entry of readSkillEntries(dir)) {
      const key = `${dir}/${entry.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (entry.modelInvocable) {
        skillChars += entry.chars;
        skillCount += 1;
      } else {
        hiddenCount += 1;
      }
    }
  }
  items.push({
    component: "Skill listing (names + descriptions)",
    detail: `${skillCount} model-invocable skill(s)${hiddenCount ? `, ${hiddenCount} hidden via disable-model-invocation` : ""}`,
    estTokens: estTokens(skillChars),
    count: skillCount,
  });

  const agents = readAgentListingChars(join(home, ".claude", "agents"));
  items.push({
    component: "Agent listing (names + descriptions)",
    detail: `${agents.count} user agent definition(s)`,
    estTokens: estTokens(agents.chars),
    count: agents.count,
  });

  const mcp = countMcpServerNames(join(home, ".claude.json"));
  items.push({
    component: "MCP servers (deferred: names only)",
    detail: `${mcp.count} user-scope server(s); tool schemas load on demand and cost ~0 until used`,
    estTokens: estTokens(mcp.nameChars),
    count: mcp.count,
  });

  return {
    items: items.sort((a, b) => b.estTokens - a.estTokens),
    claudeMdByProject: perProject.slice(0, 20),
    skillListingBudgetTokens: Math.round(contextWindow * 0.01),
    note: "Disk-based estimates (chars/4) of what a typical session loads before turn one; compare against measured firstTurnContext.",
  };
}
