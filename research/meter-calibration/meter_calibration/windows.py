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
    tokens: dict[str, np.ndarray] = field(default_factory=lambda: {f: np.zeros(len(COLUMNS)) for f in FAMILIES})

    def total(self, column: str) -> float:
        i = COLUMNS.index(column)
        return float(sum(t[i] for t in self.tokens.values()))


def five_hour_windows(
    renders: list[Render],
    events: list[Event],
    primary_phase: int,
    accounts: dict[str, str],
    include_unknown: bool = True,
    min_renders: int = 5,
) -> list[Window]:
    """A window's usage is the highest 5h % any primary-account render reported for that reset time."""
    by_reset: dict[int, Window] = {}
    for r in renders:
        if weekly_phase(r.seven_day_reset) != primary_phase or accounts.get(r.session_id) != "primary":
            continue
        key = round(r.five_hour_reset / 600) * 600
        w = by_reset.setdefault(key, Window(end=key, pct=0.0, renders=0))
        w.pct = max(w.pct, r.five_hour_pct)
        w.renders += 1

    times = [e.ts for e in events]
    out = []
    for w in sorted(by_reset.values(), key=lambda w: w.end):
        if w.renders < min_renders or not 2 <= w.pct < 100:
            continue
        lo, hi = bisect.bisect_left(times, w.end - FIVE_HOURS), bisect.bisect_left(times, w.end)
        for e in events[lo:hi]:
            acct = accounts.get(e.session_id)
            if acct == "other" or (acct is None and not include_unknown) or e.family is None:
                continue
            w.tokens[e.family] += (e.fresh, e.write_5m, e.write_1h, e.read, e.output)
        out.append(w)
    return out
