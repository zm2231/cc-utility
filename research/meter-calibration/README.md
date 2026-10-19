# meter-calibration

Estimates how the Claude subscription 5-hour usage meter weights each token
type (fresh input, 5m and 1h cache writes, cache reads, output) per model
family, by matching the usage % your status line saw against the tokens your
Claude Code transcripts record for the same window.

Anthropic publishes no formula. Its help center only says cached content
"counts less against your limits". This measures it for one account.

## Inputs

- `~/.cc-utility/sidecar-log.jsonl`, written by
  `integrations/pacekit-sidecar/statusline.sh` when `CC_UTILITY_SIDECAR_LOG` is
  set: one line per status-line render with 5h/7d usage % and reset times.
- `~/.claude/projects/**/*.jsonl`, including `subagents/`.

## Run

```bash
uv run meter-calibration all          # calibrate + rewrite breakdown
uv run meter-calibration calibrate --strict   # drop sessions with no status-line renders
uv run pytest
```

## Method

1. **Windows.** A 5h window is keyed by its absolute reset time. Its usage is
   the highest % any render reported for it. Windows at 100% are censored and
   dropped.
2. **Accounts.** The sidecar has no account field. Each account has a fixed
   weekly reset hour, so sessions are tagged by the reset hour they rendered
   and only the most common one (primary) is used. Renders whose reset had
   already passed are stale and dropped.
3. **Fit.** `pct ~ sum over families of k_f * (fresh + 1.25*w5m + 2*w1h + rho*read + 5*out)`,
   nonnegative least squares, scanning `rho`. Each family has its own scale
   `k_f`, so Fable's higher per-token cost does not leak into the read weight.
   A free fit with independent write/read/output weights per family checks
   the API ratios.
4. **Disproof checks.** Partial correlation of leftover usage with reads after
   all write and output columns; separate fits on Opus-dominated and
   Fable-dominated windows; a power check that synthesizes usage from the real
   token mix with a known `rho` and the observed noise, then tries to recover
   it.
5. **Rewrites.** A call is a cold-cache rewrite when it writes at least 10k
   tokens and reads less than half its context. Cause, in order: first call of
   a transcript stream (session or subagent start), gap beyond the cache TTL
   (1h if the last writing call used 1h writes, else 5m), model switch,
   context dropped below 60% of the previous call (compaction or clear),
   otherwise an unexplained prefix change.

## Limits

- Fits one account at a time, and only accounts whose status line rendered
  often enough to give 30 or more usable 5h windows.
- Usage the meter sees but no input captures (other machines, chat, apps
  using the login) is unexplained variance and inflates the per-token scales.
- 5h and weekly percentages are integers, which adds quantization noise.
- The weekly meter is usually too coarse to estimate `rho` directly; weekly
  capacity comes from the measured weekly/5h ratio instead.
- Capacity and rewrite shares assume the API write and output ratios (1.25x,
  2x, 5x) scaled per family. Families with little data get unreliable scales.
- Proxy logs carry no session context, so proxy cache misses cannot be
  attributed to a cause.
