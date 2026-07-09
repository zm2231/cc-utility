# cc-utility

Local-first analytics and harness doctor for coding-agent session logs. Reads
Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) and Codex rollouts
(`~/.codex/sessions/**/*.jsonl`), and turns them into ranked, actionable
findings about your harness: what's slow, what's failing, what's bloating
context, and where your tokens actually go.

No telemetry. No account. No invented dollar figures: quota is reported as
real percentage utilization.

## Install

```bash
git clone <this-repo>
cd cc-utility
npm install && npm run build
```

## Usage

```bash
node dist/cli.js                 # terminal report (Claude Code + Codex)
node dist/cli.js --since=30d     # limit the scan window (30d, 4w, 2m, or ISO date)
node dist/cli.js --no-codex      # skip the ~/.codex/sessions scan
node dist/cli.js --json          # full structured report
node dist/cli.js --html          # writes cc-utility-report.html (single dashboard)
node dist/cli.js --serve         # serve the dashboard locally
node dist/cli.js --csv           # daily history CSV
node dist/cli.js --quota         # also fetch live subscription quota %
```

Every run backfills `~/.cc-utility/history.jsonl` by re-bucketing the whole
corpus per calendar day, so day one already has full history.

`--quota` reads your existing Claude Code OAuth credential and calls
Anthropic's official usage endpoint. That is the only network call the tool
can make, and only when you pass the flag.

## What it reports

**Fix first**: a ranked findings list of failing tools, slow or timing-out
hooks, the skill listing blowing past its context budget, repeated permission
denials, stale uncompacted context, binary reads, rate-limit crossings,
Codex sessions running near the context ceiling.

**Claude Code**

- **Context overhead, measured and attributed**: total input on each fresh
  session's first assistant turn (continuation/compact resumes excluded),
  plus a disk-based attribution of what loads before turn one: CLAUDE.md
  files, the skill listing vs its ~1% budget, agent definitions, MCP server
  names (deferred schemas cost ~0).
- **Hook latency**: median/p95/max blocking time and timeout counts per hook,
  from transcript hook records. Counts are floors, since successful runs with
  empty output are never persisted.
- **Permission denials**: CLI-stamped `toolDenialKind` (user-rejected vs
  permission-rule vs auto-mode), resolved back to the denied tool or Bash
  command head.
- **Cache health**: hit rate counting cache writes as misses
  (`reads / (reads + writes + uncached input)`).
- **Sidechain split**: subagent share of tokens and tool calls, separated
  from your main-line usage.
- **Per-project breakdown**: tokens, tool calls, and sessions by cwd.
- **Model mix, tool distribution, file types read, compaction efficiency,
  interrupts, tool friction, turn durations, away-work, skills (model-invoked
  vs typed), CLAUDE.md sizes, edit blast radius**, with prompt
  time-of-day now in local time.

**Codex**

- Token totals (with cached share and reasoning tokens) from each rollout's
  final `token_count`.
- **Rate-limit history for free**: Codex logs 5-hour and weekly window
  utilization into its own rollouts; cc-utility charts it over time, with
  peaks.
- Model mix, tool mix, exec command heads, approval/sandbox policy mix, and
  end-of-session context-window fill (median/p90).

## Dashboard

`--html`/`--serve` produce a single self-contained page designed against
data-overwhelm: the ranked findings and six headline stats are visible;
everything else lives in collapsed sections whose summary lines carry the
takeaway. Light and dark, one accent color, no dependencies.

## Tests

```bash
npm test
```
