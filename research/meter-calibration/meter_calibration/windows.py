import bisect
from dataclasses import dataclass, field

import numpy as np

from .load import FAMILIES, Event, Render, weekly_phase

FIVE_HOURS = 5 * 3600
COLUMNS = ("fresh", "write_5m", "write_1h", "read", "output")


@dataclass
class Window:
    end: float
    pct: float
    renders: int
    observed_at: float = 0.0
    tokens: dict[str, np.ndarray] = field(default_factory=lambda: {f: np.zeros(len(COLUMNS)) for f in FAMILIES})

    def total(self, column: str) -> float:
        i = COLUMNS.index(column)
        return float(sum(t[i] for t in self.tokens.values()))


def five_hour_windows(
    renders: list[Render],
    events: list[Event],
    primary_phase: int,
    accounts: dict[str, str],
    include_unknown: bool = False,
    min_renders: int = 5,
) -> list[Window]:
    """A window's usage is the highest 5h % a primary-account render reported for that reset, and only events up to the
    last render showing that % can be reflected in it."""
    by_reset: dict[int, Window] = {}
    for r in renders:
        if weekly_phase(r.seven_day_reset) != primary_phase or accounts.get(r.session_id) != "primary":
            continue
        key = round(r.five_hour_reset / 600) * 600
        w = by_reset.setdefault(key, Window(end=r.five_hour_reset, pct=0.0, renders=0))
        if r.five_hour_pct > w.pct or (r.five_hour_pct == w.pct and r.ts > w.observed_at):
            w.pct, w.observed_at = r.five_hour_pct, r.ts
        w.renders += 1

    times = [e.ts for e in events]
    out = []
    for w in sorted(by_reset.values(), key=lambda w: w.end):
        if w.renders < min_renders or not 2 <= w.pct < 100:
            continue
        lo, hi = bisect.bisect_left(times, w.end - FIVE_HOURS), bisect.bisect_right(times, w.observed_at)
        for e in events[lo:hi]:
            acct = accounts.get(e.session_id)
            if acct == "other" or (acct is None and not include_unknown) or e.family is None:
                continue
            w.tokens[e.family] += (e.fresh, e.write_5m, e.write_1h, e.read, e.output)
        out.append(w)
    return out
