import bisect
import itertools
from collections import defaultdict
from datetime import UTC, datetime

import numpy as np

from . import capacity, fit
from .load import Event, Render, Session, weekly_phase
from .windows import Window


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def own_renders(renders: list[Render], primary_phase: int, accounts: dict[str, str]) -> list[Render]:
    return sorted((r for r in renders if weekly_phase(r.seven_day_reset) == primary_phase
                   and accounts.get(r.session_id) == "primary"), key=lambda r: r.ts)


def off_schedule_resets(renders: list[Render], min_drop: float = 20, hold: int = 10) -> list[dict]:
    """Weekly readings that fall well below the cycle's high before its scheduled reset and stay there: a reset granted
    mid-cycle. Each account is identified by its weekly reset hour."""
    cycles: dict[tuple[int, int], list[Render]] = defaultdict(list)
    for r in sorted(renders, key=lambda r: r.ts):
        cycles[(weekly_phase(r.seven_day_reset), round(r.seven_day_reset / 3600))].append(r)
    out = []
    for (phase, end_hour), rs in sorted(cycles.items(), key=lambda kv: kv[0][1]):
        high = 0.0
        for i, r in enumerate(rs):
            high = max(high, r.seven_day_pct)
            after = rs[i:i + 3 * hold]
            if high - r.seven_day_pct >= min_drop and len(after) >= hold and max(x.seven_day_pct for x in after) < high - min_drop / 2:
                out.append({"phase": phase, "at": r.ts, "from_pct": high, "to_pct": r.seven_day_pct,
                            "days_early": (end_hour * 3600 - r.ts) / 86400})
                break
    return out


def cache_ttl_by_day(events: list[Event]) -> list[dict]:
    days: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for e in events:
        if e.write == 0 or e.session_id.startswith("proxy:"):
            continue
        d = days[_day(e.ts)]
        kind = "subagent" if e.is_subagent else "main"
        d[f"{kind}_calls"] += 1
        d[f"{kind}_5m"] += e.write_5m
        d[f"{kind}_writes"] += e.write
    return [{"day": day, **{k: d[f"{k}_calls"] for k in ("main", "subagent")},
             **{f"{k}_5m_share": d[f"{k}_5m"] / d[f"{k}_writes"] if d[f"{k}_writes"] else None for k in ("main", "subagent")}}
            for day, d in sorted(days.items())]


def stuck_subagent_cache(events: list[Event], since: float = 0.0, min_write: int = 50_000, max_gap: float = 300) -> list[dict]:
    """Subagent calls that re-write most of their context although the previous call in the same subagent was moments
    ago, so its cache was still warm: the cache was not reused. Grouped by Claude Code version."""
    streams: dict[tuple[str, str], list[Event]] = defaultdict(list)
    for e in events:
        if e.is_subagent:
            streams[(e.session_id, e.stream)].append(e)
    by_version: dict[str, dict] = defaultdict(lambda: {"calls": 0, "written": 0, "subagents": set(), "first": None, "last": None})
    for evs in streams.values():
        evs.sort(key=lambda e: e.ts)
        for prev, e in itertools.pairwise(evs):
            if e.ts >= since and e.ts - prev.ts <= max_gap and e.write >= min_write and e.read < 0.25 * e.context:
                v = by_version[e.version or "?"]
                v["calls"] += 1
                v["written"] += e.write
                v["subagents"].add((e.session_id, e.stream))
                v["first"] = min(v["first"] or e.ts, e.ts)
                v["last"] = max(v["last"] or e.ts, e.ts)
    calls = defaultdict(int)
    for e in events:
        if e.is_subagent and e.ts >= since:
            calls[e.version or "?"] += 1
    return [{"version": ver, "calls": v["calls"], "subagent_calls": calls[ver], "written": v["written"],
             "subagents": len(v["subagents"]), "first": v["first"], "last": v["last"]}
            for ver, v in sorted(by_version.items())]


def subagent_cache_expiry(events: list[Event], since: float = 0.0, min_write: int = 50_000, ttl: float = 300) -> dict:
    """Subagent calls that re-write most of their context after pausing longer than the 5-minute cache: the cost of
    subagents writing at the 5-minute TTL, and how much of it a 1-hour TTL would have kept."""
    streams: dict[tuple[str, str], list[Event]] = defaultdict(list)
    for e in events:
        if e.is_subagent:
            streams[(e.session_id, e.stream)].append(e)
    gaps, written, under_hour = [], 0, 0
    for evs in streams.values():
        evs.sort(key=lambda e: e.ts)
        for prev, e in itertools.pairwise(evs):
            gap = e.ts - prev.ts
            if e.ts >= since and gap > ttl and e.write_5m >= min_write and e.read < 0.25 * e.context:
                gaps.append(gap / 60)
                written += e.write
                under_hour += e.write if gap <= 3600 else 0
    return {"calls": len(gaps), "written": written, "written_within_hour": under_hour,
            "gap_minutes_p10_50_90": [float(v) for v in np.percentile(gaps, [10, 50, 90])] if gaps else None}


def phantom_rises(renders: list[Render], events: list[Event], primary_phase: int, accounts: dict[str, str],
                  min_points: float = 2) -> dict:
    """Rises in a 5h window's highest reading with no logged call since the previous high that could have reached this
    meter: calls from the measured account or from sessions with no known account. Using the running high ignores stale
    readings that other open sessions keep showing."""
    times = [e.ts for e in events if accounts.get(e.session_id) != "other"]
    windows: dict[int, list[Render]] = defaultdict(list)
    for r in own_renders(renders, primary_phase, accounts):
        windows[round(r.five_hour_reset / 60)].append(r)
    rises, points, phantom = 0, 0.0, []
    for rs in windows.values():
        high, high_ts = None, 0.0
        for r in rs:
            if high is not None and r.five_hour_pct > high:
                d = r.five_hour_pct - high
                rises += 1
                points += d
                if d >= min_points and bisect.bisect_left(times, r.ts) == bisect.bisect_left(times, high_ts - 60):
                    phantom.append({"at": r.ts, "points": d, "minutes": (r.ts - high_ts) / 60})
            if high is None or r.five_hour_pct > high:
                high, high_ts = r.five_hour_pct, r.ts
    return {"rises": rises, "points": points, "phantom": phantom}


def idle_compactions(sessions: dict[str, Session], events: list[Event], since: float,
                     lo_minutes: float = 50, hi_minutes: float = 60) -> list[dict]:
    """Compactions that fire after the main conversation sat quiet for about an hour with no prompt in between: Claude
    Code's idle compaction, which runs shortly before the 1h cache would expire."""
    last_calls: dict[str, list[float]] = defaultdict(list)
    for e in events:
        if not e.is_subagent and e.session_id in sessions:
            last_calls[e.session_id].append(e.ts)
    out = []
    for sid, s in sessions.items():
        calls = sorted(last_calls.get(sid, []))
        for c in s.compactions:
            if c.ts < since:
                continue
            i = bisect.bisect_left(calls, c.ts)
            if i == 0:
                continue
            gap = (c.ts - calls[i - 1]) / 60
            prompted = bisect.bisect_left(s.prompts, c.ts) != bisect.bisect_right(s.prompts, calls[i - 1])
            if lo_minutes <= gap <= hi_minutes and not prompted:
                resumed = calls[i] if i < len(calls) else None
                out.append({"at": c.ts, "gap_minutes": gap, "pre_tokens": c.pre_tokens, "post_tokens": c.post_tokens,
                            "resumed_after_hours": (resumed - c.ts) / 3600 if resumed else None})
    return sorted(out, key=lambda x: x["at"])


def group_rates(windows: list[Window], threshold: float = 0.85, min_tokens: float = 1.0) -> dict[str, dict]:
    """Meter % per million fresh-input-equivalent tokens for each token pool, two ways: one joint fit across all pools,
    and the median over windows where a single pool supplied at least `threshold` of the tokens, which needs no fit."""
    joint = fit.fit_scales(windows, 0.0).scales
    out = {}
    for g in joint:
        alone = []
        for w in windows:
            eq = {k: fit.design([w], 0.0, [k])[0, 0] for k in w.tokens}
            if eq.get(g, 0) >= min_tokens and eq[g] >= threshold * sum(eq.values()):
                alone.append(w.pct / eq[g])
        out[g] = {"joint": joint[g], "tokens": float(sum(fit.design([w], 0.0, [g])[0, 0] for w in windows)),
                  "alone_median": float(np.median(alone)) if alone else None,
                  "alone_iqr": [float(v) for v in np.percentile(alone, [25, 75])] if alone else None,
                  "alone_windows": len(alone)}
    return out


def weekly_ratio(renders: list[Render], windows: list[Window], primary_phase: int, accounts: dict[str, str],
                 min_pairs: int = 10) -> dict | None:
    try:
        r = capacity.weekly_per_five_hour(renders, windows, primary_phase, accounts, min_pairs=min_pairs)
    except ValueError:
        return None
    return {"ratio": r.ratio, "low": r.low, "high": r.high, "windows": r.windows}


def weekly_observed_vs_predicted(renders: list[Render], events: list[Event], primary_phase: int, accounts: dict[str, str],
                                 scales: dict[str, float], ratio: float, group, min_renders: int = 20) -> list[dict]:
    """For each UTC day, the weekly % actually gained against the % the 5h scales and the weekly/5h ratio predict from
    that day's tokens. Days that hit 100% or cross a reset are skipped."""
    own = own_renders(renders, primary_phase, accounts)
    times = [e.ts for e in events]
    by_day: dict[str, list[Render]] = defaultdict(list)
    for r in own:
        by_day[_day(r.ts)].append(r)
    out = []
    for day, rs in sorted(by_day.items()):
        if len(rs) < min_renders:
            continue
        cycle = round(rs[0].seven_day_reset / 3600)
        rs = [r for r in rs if round(r.seven_day_reset / 3600) == cycle]
        start, end = max(r.seven_day_pct for r in rs[:10]), max(r.seven_day_pct for r in rs[-10:])
        if end >= 99 or end - start < 3:
            continue
        predicted = 0.0
        for e in events[bisect.bisect_left(times, rs[0].ts):bisect.bisect_left(times, rs[-1].ts)]:
            k = scales.get(group(e) or "", 0.0)
            if accounts.get(e.session_id) == "primary":
                predicted += k * fit.api_equivalent(e) / 1e6 * ratio
        out.append({"day": day, "observed": end - start, "predicted": predicted})
    return out
