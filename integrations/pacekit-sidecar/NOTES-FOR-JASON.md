# Sidecar log addition

What this is: one guarded block added to your `statusline.sh`, right after `SESSION_ID` is
resolved. If `$CC_UTILITY_SIDECAR_LOG` is unset (the default), it's a single `[ -n ... ]` check
and nothing else happens, output is byte-identical to upstream. If set to a file path, each
render appends one JSON line: `{ts, session_id, five_hour_pct, five_hour_reset, seven_day_pct,
seven_day_reset, cost_usd}`.

Why: your `used_percentage`/`resets_at` are a snapshot Claude Code hands the statusline process
on every render, but nothing persists them. A local JSONL log turns that into a real time series,
enough to build actual pace/burn-rate trends over days instead of reading the moment. Since the
statusline process is the only place Claude Code exposes `rate_limits` at all (confirmed against
the Claude Code source: Stop/PostToolUse/etc. hooks get `session_id`, `transcript_path`, and
`last_assistant_message`, never `rate_limits`, `cost`, or `context_window`; that object is built
only in `StatusLine.tsx`'s `buildStatusLineCommandInput`), your script is the only integration
point this data can come from.

Diff is additive and small: 21 lines, one `if` block, no changes to existing variables or
rendering logic. Take it, change it, or ignore it, figured you'd rather see the actual diff than
a description of one.
