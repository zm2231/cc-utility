import argparse
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from . import fit, rewrites
from .load import load_events, load_renders, tag_accounts
from .windows import five_hour_windows


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def _pct(a: np.ndarray) -> str:
    return f"{a[1]:.0%} (90% range {a[0]:.0%}-{a[2]:.0%})"


def calibrate(windows: list, args: argparse.Namespace) -> None:
    print(f"\n5h windows used: {len(windows)} ({_day(windows[0].end)} to {_day(windows[-1].end)})")
    print("\nCache-read weight (x fresh input), per-family meter scales, API ratios for writes/output:")
    for rho in (0, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0):
        print(f"  rho={rho:<5} R2={fit.fit_scales(windows, rho).r2:.3f}")
    best = fit.best_rho(windows)
    print(f"  best rho {best}  bootstrap 5/50/95%: {np.round(fit.bootstrap_rho(windows, args.boot), 4)}")

    half = len(windows) // 2
    for label, part in (("first half", windows[:half]), ("second half", windows[half:])):
        print(f"  {label} ({_day(part[0].end)}..{_day(part[-1].end)}): best rho {fit.best_rho(part)}")

    print("\nFable control:")
    scales = fit.fit_scales(windows, best).scales
    print("  per-family scale (%/M API-equivalent tokens): " + ", ".join(f"{f}={s:.3f}" for f, s in scales.items()))
    for fam in ("opus", "fable"):
        dom = fit.dominated_by(windows, fam)
        if len(dom) >= 30:
            print(f"  {fam}-dominated windows (>=80% of usage): n={len(dom)}  best rho {fit.best_rho(dom)}"
                  f"  partial corr(resid, reads)={fit.partial_corr_reads(dom, fam):+.3f}")
        else:
            print(f"  {fam}-dominated windows: n={len(dom)}, too few to fit alone")
    for fam in ("opus", "fable"):
        print(f"  partial corr(resid usage, {fam} reads | all writes+output) = {fit.partial_corr_reads(windows, fam):+.3f}")

    print("\nPower check (synthetic usage from your real token mix, observed noise level):")
    for true_rho in (0.025, 0.05, 0.1):
        print(f"  true rho {true_rho}: recovered 5/50/95% {np.round(fit.power_check(windows, true_rho), 4)}")

    print("\nShare of 5h meter usage (free per-family weights, bootstrap):")
    for k, v in fit.usage_shares(windows, args.boot).items():
        print(f"  {k:7s} {_pct(v)}")


def rewrite_report(events: list, accounts: dict, windows: list) -> None:
    start = windows[0].end - 5 * 3600
    evs = [e for e in events if e.ts >= start and accounts.get(e.session_id) != "other"]
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
    if rep.idle_gaps:
        g = np.array(rep.idle_gaps) / 60
        print(f"\nIdle-expiry gaps (minutes): median {np.median(g):.0f}, "
              f"{np.mean(g < 120):.0%} under 2h, {np.mean(g < 24 * 60):.0%} under a day")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=("calibrate", "rewrites", "all"))
    p.add_argument("--sidecar", type=Path, default=Path.home() / ".cc-utility" / "sidecar-log.jsonl")
    p.add_argument("--projects", type=Path, default=Path.home() / ".claude" / "projects")
    p.add_argument("--strict", action="store_true", help="drop sessions with no status-line renders instead of assuming the primary account")
    p.add_argument("--boot", type=int, default=200)
    args = p.parse_args()

    renders = load_renders(args.sidecar)
    primary, accounts = tag_accounts(renders)
    events = load_events(args.projects)
    print(f"renders {len(renders)}, sessions primary/other "
          f"{sum(v == 'primary' for v in accounts.values())}/{sum(v == 'other' for v in accounts.values())}, "
          f"claude API calls {len(events)}")
    windows = five_hour_windows(renders, events, primary, accounts, include_unknown=not args.strict)
    if args.command in ("calibrate", "all"):
        calibrate(windows, args)
    if args.command in ("rewrites", "all"):
        rewrite_report(events, accounts, windows)


if __name__ == "__main__":
    main()
