from collections import defaultdict
from dataclasses import dataclass

from .fit import API_WEIGHTS
from .load import Event

CAUSES = ("stream start", "idle expiry", "model switch", "after compaction", "other prefix change")
CONTEXT_BUCKETS = (100_000, 200_000, 300_000, float("inf"))


@dataclass(frozen=True)
class Classified:
    event: Event
    cause: str | None
    gap: float


def is_rewrite(e: Event, min_write: int = 10_000) -> bool:
    """A cold-cache call re-sends most of its context as cache writes instead of reading it."""
    return e.write >= min_write and e.read < 0.5 * e.context


def _ttl(last_writer: Event | None) -> float:
    return 3600.0 if last_writer is not None and last_writer.write_1h > 0 else 300.0


def classify(events: list[Event]) -> list[Classified]:
    streams: dict[tuple[str, str], list[Event]] = defaultdict(list)
    for e in events:
        streams[(e.session_id, e.stream)].append(e)
    out = []
    for evs in streams.values():
        evs.sort(key=lambda e: e.ts)
        last_writer = None
        for i, e in enumerate(evs):
            prev = evs[i - 1] if i else None
            gap = e.ts - prev.ts if prev else 0.0
            cause = None
            if is_rewrite(e):
                if prev is None:
                    cause = "stream start"
                elif gap > _ttl(last_writer):
                    cause = "idle expiry"
                elif prev.model != e.model:
                    cause = "model switch"
                elif e.context < 0.6 * prev.context:
                    cause = "after compaction"
                else:
                    cause = "other prefix change"
            out.append(Classified(e, cause, gap))
            if e.write > 0:
                last_writer = e
    return out


def meter_units(e: Event, scales: dict[str, float]) -> dict[str, float]:
    k = scales.get(e.family or "", 0.0) / 1e6
    return {
        "write": k * (API_WEIGHTS["write_5m"] * e.write_5m + API_WEIGHTS["write_1h"] * e.write_1h),
        "other": k * (API_WEIGHTS["fresh"] * e.fresh + API_WEIGHTS["output"] * e.output),
    }


def context_bucket(ctx: int) -> str:
    lo = 0
    for hi in CONTEXT_BUCKETS:
        if ctx < hi:
            return f"{lo // 1000}k+" if hi == float("inf") else f"{lo // 1000}-{int(hi) // 1000}k"
        lo = int(hi)
    raise AssertionError


@dataclass
class RewriteReport:
    total: float
    incremental_write: float
    by_cause: dict[str, float]
    count_by_cause: dict[str, int]
    by_context: dict[str, float]
    by_family: dict[str, float]
    idle_gaps: list[float]


def summarize(classified: list[Classified], scales: dict[str, float]) -> RewriteReport:
    r = RewriteReport(0.0, 0.0, defaultdict(float), defaultdict(int), defaultdict(float), defaultdict(float), [])
    for c in classified:
        m = meter_units(c.event, scales)
        r.total += m["write"] + m["other"]
        if c.cause is None:
            r.incremental_write += m["write"]
            continue
        r.by_cause[c.cause] += m["write"]
        r.count_by_cause[c.cause] += 1
        r.by_context[context_bucket(c.event.context)] += m["write"]
        r.by_family[c.event.family or "?"] += m["write"]
        if c.cause == "idle expiry":
            r.idle_gaps.append(c.gap)
    return r
