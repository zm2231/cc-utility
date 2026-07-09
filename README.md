# cc-utility

Local-first analytics for Claude Code session logs (`~/.claude/projects/*.jsonl`).

No telemetry. No account required. No paywall. Reports subscription quota as real percentage utilization, not an invented dollar figure.

## Install

```bash
git clone <this-repo>
cd cc-utility
npm install
npm run build
```

## Usage

```bash
node dist/cli.js               # local-only report, terminal output
node dist/cli.js --json        # same data as structured JSON
node dist/cli.js --quota       # also fetches your real 5h/7-day subscription quota %
node dist/cli.js --html        # writes cc-utility-report.html (static, self-contained)
node dist/cli.js --csv         # writes cc-utility-history.csv (one row per day)
```

Every run backfills and rewrites `~/.cc-utility/history.jsonl`: it re-buckets your entire
session corpus by calendar day, so day one already has real history going back to your
oldest session, not just data collected from today forward.

`--quota` reads your existing Claude Code OAuth credential (macOS Keychain, or
`~/.claude/.credentials.json` on other platforms) and calls Anthropic's official
`api.anthropic.com/api/oauth/usage` endpoint. It never writes or copies your credential
anywhere, and this is the only network call the tool ever makes, only when you pass the
flag.

## What it reports

- **Cache health**: real hit rate from your own usage data.
- **Context overhead**: tokens loaded before any real work starts in a session (system
  prompt, CLAUDE.md, MCP/skill defs, auto-memory), measured directly rather than estimated.
- **Model mix**: turn counts per model.
- **Tool call distribution** and **file types read**, with flags for large Bash output
  and binary/media files landing in context.
- **Usage patterns**: prompt count, length, question ratio, time-of-day/weekday shape.
  Filters out automated/synthetic messages (hook payloads, scheduled jobs, subagent
  sidechains) on a best-effort basis.
- **Subscription quota** (`--quota` only): real 5-hour and 7-day window utilization,
  straight from Anthropic.
- **Context compaction**: manual vs. auto compaction counts, tokens reclaimed, and which
  sessions are carrying uncompacted context above a threshold. A long session with
  frequent, efficient compactions is not flagged; only genuinely stale context is.
- **Interrupts & tool errors**: how often you interrupted a running turn, and how often
  a tool call was rejected outright.
- **Skill usage**: which skills actually get invoked, and how often, split by whether
  you typed the slash command yourself or the model invoked it on its own.
- **CLAUDE.md sizes**: measures the real file size, and shows the real file path, of
  every CLAUDE.md discovered from your session logs.
- **Autonomous/away-work**: how often you run sessions unattended (away summaries,
  scheduled wakeups).
- **Delegation**: how often you fan out to subagents, and across how many sessions.
- **Edit blast radius**: which files get touched most across every session, from
  Claude Code's own file-history snapshots.
- **Turn duration**: how long you actually wait per turn (median/p90/p95/max), not
  just token counts.
- **Optimization findings**: a ranked list of real problems (unreliable tools, low
  cache hit rate, poor compaction retention, Bash-heavy context bloat, and more),
  each scored against your last 30 days of activity so a since-fixed issue doesn't
  get flagged as current, with exact evidence (counts, dates, session IDs) behind
  each one.
- **Rate-limit history** (optional): if you point your statusline at the vendored,
  MIT-licensed fork of Jason Siegel's
  [pacekit-statusline](https://github.com/jasonesiegel/claude-code-extensions) in
  `integrations/pacekit-sidecar/` with `CC_UTILITY_SIDECAR_LOG` set, cc-utility can
  chart your 5-hour/7-day rate-limit burn rate over time. This is the only data
  cc-utility itself cannot backfill retroactively, Claude Code never persists
  `rate_limits` anywhere except the live statusline process.

## Privacy

Everything above is computed by reading structured fields from your own local JSONL
files. No network calls, no model calls, nothing sent anywhere, unless you pass
`--quota`. The report shows real file paths and session IDs (this is a local tool; that
data never leaves your machine on its own), but never prints verbatim prompt text or
tool output, since arbitrary session content can contain live secrets in a way a file
path or session ID doesn't.

`--json` is meant as a hand-off point: pipe the small, pre-aggregated stats object to an
LLM session for narrative interpretation, rather than asking a model to re-read and
recount your raw logs itself. If you're piping that output somewhere outside your own
machine, remember it does contain your real project paths and session IDs.

## Status

Early. Has a test suite (`npm test`) and has been through several rounds of static code
review, but has only been run against one person's logs so far. Not yet published or
tested by other users. A `serve` command for a local dashboard is planned.

## Known limitations

- Average words-per-prompt is inflated by long pasted content (logs, diffs, code) that
  the automated-message filter correctly does not exclude.
- The human-vs-automated prompt filter is heuristic. Claude Code doesn't publish an
  explicit field for this distinction, so it's inferred from message shape.
- CLAUDE.md discovery walks up from every working directory seen in your logs to the
  filesystem root; on an unusual directory layout it may pick up an unrelated file.
