import bisect
from dataclasses import dataclass

import numpy as np

from .fit import API_WEIGHTS, week_blocks
from .load import Render, weekly_phase
from .windows import FIVE_HOURS, Window


def five_hour_capacity(scales: dict[str, float]) -> dict[str, dict[str, float]]:
    """Millions of tokens of one type alone that fill a 5h window, per model family, from %/M API-equivalent scales."""
    out = {}
    for fam, k in scales.items():
        if k <= 0:
            continue
        full = 100 / k
        out[fam] = {"fresh": full, "write_5m": full / API_WEIGHTS["write_5m"], "write_1h": full / API_WEIGHTS["write_1h"],
                    "output": full / API_WEIGHTS["output"]}
    return out


@dataclass
class WeeklyRatio:
    ratio: float
    low: float
    high: float
    windows: int

    @property
    def windows_per_week(self) -> tuple[float, float, float]:
        return 1 / self.ratio, 1 / self.high, 1 / self.low


def weekly_per_five_hour(
    renders: list[Render], windows: list[Window], primary_phase: int, accounts: dict[str, str], n: int = 500, seed: int = 0,
    min_pairs: int = 30,
) -> WeeklyRatio:
    """Weekly % gained per 5h % across each window: the weekly reading just before the window starts against the
    highest weekly reading up to the render that supplied the window's 5h %, within the same weekly cycle."""
    own = sorted((r for r in renders if weekly_phase(r.seven_day_reset) == primary_phase
                  and accounts.get(r.session_id) == "primary"), key=lambda r: r.ts)
    times = [r.ts for r in own]
    used, x, y = [], [], []
    for w in windows:
        i = bisect.bisect_left(times, w.end - FIVE_HOURS) - 1
        if i < 0:
            continue
        cycle = round(own[i].seven_day_reset / 3600)
        inside = [r.seven_day_pct for r in own[i + 1:bisect.bisect_right(times, w.observed_at)]
                  if round(r.seven_day_reset / 3600) == cycle]
        if not inside:
            continue
        used.append(w)
        x.append(w.pct)
        y.append(max(inside) - own[i].seven_day_pct)
    if len(used) < min_pairs:
        raise ValueError(f"only {len(used)} 5h windows pair with a weekly reading from the same weekly cycle; "
                         f"need at least {min_pairs}")
    xs, ys = np.array(x), np.array(y)
    ratio = float((xs * ys).sum() / (xs * xs).sum())
    blocks = week_blocks(used)
    rng = np.random.default_rng(seed)
    boot = []
    for _ in range(n):
        idx = [j for b in rng.integers(len(blocks), size=len(blocks)) for j in blocks[b]]
        boot.append((xs[idx] * ys[idx]).sum() / (xs[idx] * xs[idx]).sum())
    lo, hi = np.percentile(boot, [5, 95])
    return WeeklyRatio(ratio, float(lo), float(hi), len(used))
