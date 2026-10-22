import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from . import capacity, fit, report, rewrites
from .load import (
    Event,
    Render,
    load_events,
    load_proxy_events,
    load_renders,
    load_sessions,
    tag_accounts,
)
from .windows import COLUMNS, FIVE_HOURS, five_hour_windows

MIN_WINDOWS = 30


def _utc_date(s: str) -> float:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC).timestamp()


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def _pct(a: np.ndarray) -> str:
    return f"{a[1]:.0%} (90% range {a[0]:.0%}-{a[2]:.0%})"


def calibrate(windows: list, loose_windows: list, args: argparse.Namespace) -> None:
    print(f"\n5h windows used: {len(windows)} ({_day(windows[0].end)} to {_day(windows[-1].end)})")
    print("\nCache-read weight (x fresh input), per-family meter scales, API ratios for writes/output:")
    for rho in (0, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0):
        print(f"  rho={rho:<5} R2={fit.fit_scales(windows, rho).r2:.3f}")
    best = fit.best_rho(windows)
    print(f"  best rho {best}  week-block bootstrap 5/50/95%: {np.round(fit.bootstrap_rho(windows, args.boot), 4)}")
    print(f"  sensitivity, counting unrendered sessions as primary: best rho {fit.best_rho(loose_windows)}")

    half = len(windows) // 2
    for label, part in (("first half", windows[:half]), ("second half", windows[half:])):
        print(f"  {label} ({_day(part[0].end)}..{_day(part[-1].end)}): best rho {fit.best_rho(part)}")

    print("\nFable control:")
    scales = fit.fit_scales(windows, best).scales
    print("  per-family scale (%/M API-equivalent tokens): " + ", ".join(f"{f}={s:.3f}" for f, s in scales.items()))
    for fam in ("opus", "fable"):
        dom = fit.dominated_by(windows, fam)
        if len(dom) >= MIN_WINDOWS:
            print(f"  {fam}-dominated windows (>=80% of usage): n={len(dom)}  best rho {fit.best_rho(dom)}"
                  f"  partial corr(resid, reads)={fit.partial_corr_reads(dom, fam):+.3f}")
        else:
            print(f"  {fam}-dominated windows: n={len(dom)}, too few to fit alone")
    for fam in ("opus", "fable"):
        print(f"  partial corr(resid usage, {fam} reads | all writes+output) = {fit.partial_corr_reads(windows, fam):+.3f}")

    print("\nInjection check (known read charge added to the real usage %, then re-estimated):")
    for rho in (0.025, 0.05, 0.1):
        print(f"  injected {rho}: recovered {fit.injection_check(windows, rho):.4f}")

    print("\nFree fit, no API ratios (%/Mtok; API: 1h/5m 1.6, read/5m 0.08, output/5m 4.0). Write, read and output move\n"
          "together, so wildly off ratios here mean the data cannot separate them, not that the meter uses them:")
    for fam, c in fit.free_fit(windows, [f for f in ("opus", "fable") if f in scales]).items():
        base = c["write_5m"] or float("nan")
        print(f"  {fam:6s} " + "  ".join(f"{k}={v:.4f}" for k, v in c.items())
              + f"  | 1h/5m={c['write_1h'] / base:.2f} read/5m={c['read'] / base:.3f} output/5m={c['output'] / base:.2f}")

    print("\nShare of 5h meter usage (API-ratio model, rho and scales re-fit per week-block resample):")
    for k, v in fit.usage_shares(windows, args.boot).items():
        print(f"  {k:7s} {_pct(v)}")


def capacity_report(renders: list, windows: list, primary: int, accounts: dict) -> None:
    rho = fit.best_rho(windows)
    caps = capacity.five_hour_capacity(fit.fit_scales(windows, rho).scales)
    wk = capacity.weekly_per_five_hour(renders, windows, primary, accounts)
    per_week, per_week_lo, per_week_hi = wk.windows_per_week
    print(f"\nCapacity of the primary account (rho={rho}; millions of tokens of one type alone):")
    print(f"  {'family':7s} {'fresh':>8s} {'write 5m':>9s} {'write 1h':>9s} {'output':>8s}   per 5h window")
    for fam, c in caps.items():
        print(f"  {fam:7s} {c['fresh']:8.1f} {c['write_5m']:9.1f} {c['write_1h']:9.1f} {c['output']:8.2f}")
    print(f"  weekly % per 5h %: {wk.ratio:.3f} (90% {wk.low:.3f}-{wk.high:.3f}, {wk.windows} windows)"
          f" -> one week = {per_week:.1f} full 5h windows (90% {per_week_lo:.1f}-{per_week_hi:.1f})")
    for fam, c in caps.items():
        print(f"  {fam:7s} per week: {c['fresh'] * per_week:7.0f}M fresh-input-equivalent, {c['output'] * per_week:6.1f}M output alone")


def rewrite_report(events: list, accounts: dict, windows: list) -> None:
    start = windows[0].end - FIVE_HOURS
    evs = [e for e in events if e.ts >= start and accounts.get(e.session_id) == "primary"]
    scales = fit.fit_scales(windows, 0.0).scales
    rep = rewrites.summarize(rewrites.classify(evs), scales)
    rewrite_total = sum(rep.by_cause.values())
    writes = rewrite_total + rep.incremental_write
    print(f"\nCache writes = {writes / rep.total:.0%} of modeled 5h usage ({_day(start)} onward, rho=0 fit)")
    print(f"  incremental (new turn content): {rep.incremental_write / rep.total:.1%} of usage")
    print(f"  full rewrites (cold cache):     {rewrite_total / rep.total:.1%} of usage")
    print("\nRewrites by cause (share of total usage, call count):")
    for cause in rewrites.CAUSES:
        print(f"  {cause:20s} {rep.by_cause.get(cause, 0) / rep.total:6.1%}  n={rep.count_by_cause.get(cause, 0)}")
    print("\nRewrites by context size at the miss:")
    for b in ("0-100k", "100-200k", "200-300k", "300k+"):
        print(f"  {b:9s} {rep.by_context.get(b, 0) / rep.total:6.1%}")
    print("\nRewrites by model family:")
    for f, v in sorted(rep.by_family.items(), key=lambda kv: -kv[1]):
        print(f"  {f:7s} {v / rep.total:6.1%}")
    if rep.other_markers:
        print("\nMarkers logged before the remaining 'other prefix change' rewrites (share of usage, overlapping):")
        for m, v in sorted(rep.other_markers.items(), key=lambda kv: -kv[1])[:8]:
            print(f"  {m:40s} {v / rep.total:6.1%}")
    if rep.idle_gaps:
        g = np.array(rep.idle_gaps) / 60
        print(f"\nIdle-expiry gaps (minutes): median {np.median(g):.0f}, "
              f"{np.mean(g < 120):.0%} under 2h, {np.mean(g < 24 * 60):.0%} under a day")


def select_period(renders: list[Render], events: list[Event], since: float, until: float) -> tuple[list[Render], list[Event]]:
    """Events reach back one window before `since`, because the first windows in the period started then."""
    return ([r for r in renders if since <= r.ts < until],
            [e for e in events if since - FIVE_HOURS <= e.ts < until])


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=("calibrate", "capacity", "rewrites", "all", "report"))
    p.add_argument("--sidecar", type=Path, default=Path.home() / ".cc-utility" / "sidecar-log.jsonl")
    p.add_argument("--projects", type=Path, action="append",
                   help="Claude Code projects dir; repeat for each config dir (default ~/.claude/projects)")
    p.add_argument("--proxy-usage", type=Path, action="append",
                   help="JSONL from `python3 proxy.py LOG_DIR`; repeat per proxy host")
    p.add_argument("--primary-email", help="email of the account the status-line readings belong to")
    p.add_argument("--since", type=_utc_date, required=True, help="UTC date, inclusive (YYYY-MM-DD)")
    p.add_argument("--until", type=_utc_date, required=True, help="UTC date, exclusive (YYYY-MM-DD)")
    p.add_argument("--boot", type=int, default=200)
    p.add_argument("--breaks", type=_utc_date, action="append", default=[],
                   help="UTC date at which `report` splits the period for before/after comparisons; repeatable")
    p.add_argument("--out", type=Path, help="where `report` writes its JSON")
    args = p.parse_args()
    if args.since >= args.until:
        p.error("--since must be before --until")
    if args.command == "report" and not args.out:
        p.error("report needs --out")

    projects = args.projects or [Path.home() / ".claude" / "projects"]
    if args.proxy_usage and not args.primary_email:
        p.error("--proxy-usage needs --primary-email to know which account's requests the meter reflects")
    proxy_events, proxy_accounts = load_proxy_events(args.proxy_usage or [], args.primary_email)
    all_events = sorted(load_events(*projects) + proxy_events, key=lambda e: e.ts)
    renders, events = select_period(load_renders(args.sidecar), all_events, args.since, args.until)
    if not renders:
        p.error(f"no status-line renders in {args.sidecar} for this period")
    primary, accounts = tag_accounts(renders)
    accounts |= proxy_accounts
    print(f"period {_day(args.since)} to {_day(args.until)} (exclusive)")
    print(f"renders {len(renders)}, sessions primary/other "
          f"{sum(v == 'primary' for v in accounts.values())}/{sum(v == 'other' for v in accounts.values())}, "
          f"claude API calls {len(events)}")
    windows = five_hour_windows(renders, events, primary, accounts)
    metered = [COLUMNS.index(c) for c in COLUMNS if c != "read"]
    with_tokens = sum(any(t[metered].sum() > 0 for t in w.tokens.values()) for w in windows)
    if with_tokens < MIN_WINDOWS:
        p.error(f"only {with_tokens} usable 5h windows with Claude Code token data in this period "
                f"({len(windows)} with usage %); need at least {MIN_WINDOWS}")
    if len({w.pct for w in windows}) < 2:
        p.error("the 5h usage % is the same in every window, so there is no variation to fit")
    if args.command in ("calibrate", "all"):
        calibrate(windows, five_hour_windows(renders, events, primary, accounts, include_unknown=True), args)
    if args.command in ("capacity", "all"):
        try:
            capacity_report(renders, windows, primary, accounts)
        except ValueError as e:
            p.error(str(e))
    if args.command in ("rewrites", "all"):
        rewrite_report(events, accounts, windows)
    if args.command == "report":
        data = report.build(renders, events, load_sessions(*projects), primary, accounts, args.since, args.until,
                            args.breaks, args.boot)
        args.out.write_text(json.dumps(data, default=float))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
