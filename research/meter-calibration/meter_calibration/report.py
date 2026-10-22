import itertools
from collections import Counter, defaultdict
from datetime import UTC, datetime

import numpy as np

from . import checks, fit
from .fit import api_equivalent
from .load import WEEK, Event, Render, Session, weekly_phase
from .turns import Turn, turns
from .windows import COLUMNS, Window, five_hour_windows


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def by_model(e: Event) -> str | None:
    return e.model_id


def by_model_and_entrypoint(e: Event) -> str | None:
    if e.model_id is None:
        return None
    return f"{e.model_id}:headless" if e.entrypoint.startswith("sdk") else e.model_id


def account_labels(renders: list[Render], primary_phase: int) -> dict[int, str]:
    """Accounts are named A, B, ... by how many status-line readings they have; A is the account being measured."""
    counts = Counter(weekly_phase(r.seven_day_reset) for r in renders)
    order = [primary_phase] + [p for p, _ in counts.most_common() if p != primary_phase]
    return {p: chr(ord("A") + i) for i, p in enumerate(order)}


def segments(since: float, until: float, breaks: list[float]) -> list[tuple[float, float]]:
    edges = [since, *sorted(b for b in breaks if since < b < until), until]
    return list(itertools.pairwise(edges))


def _turn_summary(ts: list[Turn]) -> dict:
    tokens = np.array([t.tokens for t in ts])
    minutes = np.array([t.minutes for t in ts])
    return {"prompts": len(ts), "tokens_median": float(np.median(tokens)), "tokens_mean": float(tokens.mean()),
            "with_subagents": float(np.mean([t.subagents > 0 for t in ts])),
            "subagents_mean": float(np.mean([t.subagents for t in ts])),
            "over_hour": float(np.mean(minutes > 60)), "minutes_p90": float(np.percentile(minutes, 90))}


def build(renders: list[Render], events: list[Event], sessions: dict[str, Session], primary: int,
          accounts: dict[str, str], since: float, until: float, breaks: list[float], boot: int = 200) -> dict:
    labels = account_labels(renders, primary)
    history = [e for e in events if e.ts < until and accounts.get(e.session_id) == "primary" and e.family is not None]
    measured = [e for e in history if e.ts >= since]
    family_windows = five_hour_windows(renders, events, primary, accounts)
    model_windows = five_hour_windows(renders, events, primary, accounts, group=by_model)
    best = fit.best_rho(family_windows)
    overall_ratio = checks.weekly_ratio(renders, model_windows, primary, accounts, min_pairs=30)
    model_scales = fit.fit_scales(model_windows, 0.0).scales

    def window_slice(ws: list[Window], a: float, b: float) -> list[Window]:
        return [w for w in ws if a <= w.end < b]

    weeks = [(a, a + WEEK) for a in np.arange(since, until, WEEK)]
    segs = segments(since, until, breaks)
    all_turns = [t for t in turns(measured, sessions) if t.ts < until]
    top_models = [m for m, _ in Counter(t.model for t in all_turns if since <= t.ts < until).most_common(5)]

    return {
        "period": {"since": since, "until": until, "breaks": breaks},
        "accounts": [{"label": labels[p], "renders": n, "measured": p == primary}
                     for p, n in Counter(weekly_phase(r.seven_day_reset) for r in renders).most_common()],
        "daily": _daily(renders, measured, all_turns, labels),
        "resets": [{"account": labels.get(r["phase"], "?"), **{k: v for k, v in r.items() if k != "phase"}}
                   for r in checks.off_schedule_resets(renders)],
        "five_hour_windows": [{"end": w.end, "pct": w.pct} for w in family_windows],
        "cache_read_weight": {
            "r2_by_rho": {str(r): fit.fit_scales(family_windows, r).r2 for r in (0, 0.01, 0.025, 0.05, 0.1, 0.2)},
            "best": best,
            "bootstrap_5_50_95": [float(v) for v in fit.bootstrap_rho(family_windows, boot)],
            "injection": {str(r): fit.injection_check(family_windows, r) for r in (0.025, 0.05, 0.1)},
            "by_segment": [{"since": a, "until": b, "best": fit.best_rho(ws), "windows": len(ws)}
                           for a, b in segs if len(ws := window_slice(model_windows, a, b)) >= 30],
        },
        "rates": {
            "by_model": checks.group_rates(model_windows),
            "by_segment": [{"since": a, "until": b, "windows": len(ws), "rates": checks.group_rates(ws)}
                           for a, b in segs if len(ws := window_slice(model_windows, a, b)) >= 10],
            "by_week": [{"since": float(a), "windows": len(ws), "rates": checks.group_rates(ws)}
                        for a, b in weeks if len(ws := window_slice(model_windows, a, b)) >= 4],
            "headless": {
                "assumes": "sessions without status-line readings ran on the measured account",
                "rates": checks.group_rates(five_hour_windows(renders, events, primary, accounts, include_unknown=True,
                                                              group=by_model_and_entrypoint)),
            },
        },
        "weekly": {
            "ratio": overall_ratio,
            "ratio_by_segment": [{"since": a, "until": b, **(r or {})}
                                 for a, b in segs if (r := checks.weekly_ratio(renders, window_slice(model_windows, a, b),
                                                                               primary, accounts))],
            "cycles": _cycles(renders, measured, primary, accounts, model_scales, overall_ratio),
            "observed_vs_predicted": checks.weekly_observed_vs_predicted(
                renders, events, primary, accounts, model_scales, overall_ratio["ratio"], by_model)
            if overall_ratio else [],
        },
        "turns": {
            "by_model": {m: _turn_summary(ts) for m in top_models
                         if len(ts := [t for t in all_turns if t.model == m and since <= t.ts < until]) >= 30},
            "by_week": [{"since": float(a), "models": {m: _turn_summary(ts) for m in top_models
                                                       if len(ts := [t for t in all_turns if t.model == m and a <= t.ts < b]) >= 30}}
                        for a, b in weeks],
        },
        "cache_ttl_by_day": checks.cache_ttl_by_day(measured),
        "stuck_subagent_cache": checks.stuck_subagent_cache(history, since),
        "subagent_cache_expiry": checks.subagent_cache_expiry(history, since),
        "phantom": checks.phantom_rises(renders, events, primary, accounts),
        "idle_compactions": [c for c in checks.idle_compactions(sessions, history, since) if c["at"] < until],
    }


def _daily(renders: list[Render], measured: list[Event], all_turns: list[Turn], labels: dict[int, str]) -> list[dict]:
    days: dict[str, dict] = defaultdict(lambda: {"models": defaultdict(float), "types": np.zeros(len(COLUMNS)),
                                                 "subagent": 0.0, "proxy": 0.0, "weekly": {}, "prompts": 0})
    for e in measured:
        d = days[_day(e.ts)]
        eq = api_equivalent(e) / 1e6
        d["models"][e.model_id] += eq
        d["types"] += (e.fresh, e.write_5m, e.write_1h, e.read, e.output)
        d["subagent"] += eq if e.is_subagent else 0.0
        d["proxy"] += eq if e.session_id.startswith("proxy:") else 0.0
    for r in renders:
        weekly = days[_day(r.ts)]["weekly"]
        label = labels.get(weekly_phase(r.seven_day_reset), "?")
        weekly[label] = max(weekly.get(label, 0.0), r.seven_day_pct)
    for t in all_turns:
        days[_day(t.ts)]["prompts"] += 1
    return [{"day": day, "tokens_by_model": dict(d["models"]),
             "tokens_by_type": dict(zip(COLUMNS, (float(v) / 1e6 for v in d["types"]), strict=True)),
             "subagent": d["subagent"], "proxy": d["proxy"], "weekly_high": d["weekly"], "prompts": d["prompts"]}
            for day, d in sorted(days.items())]


def _cycles(renders: list[Render], measured: list[Event], primary: int, accounts: dict[str, str],
            scales: dict[str, float], ratio: dict | None) -> list[dict]:
    own = checks.own_renders(renders, primary, accounts)
    by_cycle: dict[int, list[Render]] = defaultdict(list)
    for r in own:
        by_cycle[round(r.seven_day_reset / 3600)].append(r)
    out = []
    for hour, rs in sorted(by_cycle.items()):
        end = hour * 3600.0
        evs = [e for e in measured if end - WEEK <= e.ts < end]
        eq = sum(scales.get(e.model_id or "", 0.0) * api_equivalent(e) for e in evs) / 1e6
        out.append({"end": end, "observed_high": max(r.seven_day_pct for r in rs),
                    "complete": min(r.ts for r in rs) < end - WEEK + 86400,
                    "predicted": eq * ratio["ratio"] if ratio else None,
                    "tokens_by_type": {c: float(sum(getattr(e, c) for e in evs)) / 1e6
                                       for c in ("fresh", "write_5m", "write_1h", "read", "output")}})
    return out
