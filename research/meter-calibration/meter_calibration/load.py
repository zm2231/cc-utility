import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

WEEK = 7 * 86400
FAMILIES = ("opus", "fable", "sonnet", "haiku")


@dataclass(frozen=True)
class Render:
    ts: float
    session_id: str
    five_hour_pct: float
    five_hour_reset: float
    seven_day_pct: float
    seven_day_reset: float


@dataclass(frozen=True)
class Event:
    ts: float
    session_id: str
    stream: str
    model: str
    fresh: int
    write_5m: int
    write_1h: int
    read: int
    output: int

    @property
    def family(self) -> str | None:
        return next((f for f in FAMILIES if f in self.model), None)

    @property
    def context(self) -> int:
        return self.fresh + self.write_5m + self.write_1h + self.read

    @property
    def write(self) -> int:
        return self.write_5m + self.write_1h


def parse_ts(s: str) -> float:
    return datetime.fromisoformat(s).timestamp()


def absolute_reset(ts: float, value: float) -> float:
    return value if value > 1e9 else ts + value


def load_renders(path: Path) -> list[Render]:
    """Drops renders whose reset already passed: those are stale numbers a session shows until its next API call."""
    out = []
    with path.open(errors="ignore") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(d, dict):
                continue
            p5, r5, p7, r7 = (d.get(k) for k in ("five_hour_pct", "five_hour_reset", "seven_day_pct", "seven_day_reset"))
            if p5 is None or r5 is None or p7 is None or r7 is None or "ts" not in d:
                continue
            ts = parse_ts(d["ts"])
            a5 = absolute_reset(ts, float(r5))
            a7 = absolute_reset(ts, float(r7))
            if a5 <= ts + 30 or a7 <= ts + 30:
                continue
            out.append(Render(ts, d.get("session_id", ""), float(p5), a5, float(p7), a7))
    return out


def weekly_phase(seven_day_reset: float) -> int:
    return round((seven_day_reset % WEEK) / 3600) % 168


def tag_accounts(renders: list[Render]) -> tuple[int, dict[str, str]]:
    """Each account has a fixed weekly reset hour; the most common one is the primary account."""
    primary = Counter(weekly_phase(r.seven_day_reset) for r in renders).most_common(1)[0][0]
    per_session: dict[str, Counter] = defaultdict(Counter)
    for r in renders:
        per_session[r.session_id][weekly_phase(r.seven_day_reset)] += 1
    accounts = {s: "primary" if c.most_common(1)[0][0] == primary else "other" for s, c in per_session.items()}
    return primary, accounts


def _stream_of(path: Path) -> tuple[str, str]:
    if path.parent.name == "subagents":
        return path.parent.parent.name, path.stem
    return path.stem, "main"


def load_events(projects_dir: Path) -> list[Event]:
    """Transcripts repeat a message once per content block; the copy with the largest output count is the final one."""
    best: dict[str, Event] = {}
    for path in projects_dir.rglob("*.jsonl"):
        session_id, stream = _stream_of(path)
        with path.open(errors="ignore") as fh:
            for line in fh:
                if '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = d.get("message") if isinstance(d, dict) else None
                if not isinstance(msg, dict) or not msg.get("usage") or not msg.get("id") or "timestamp" not in d:
                    continue
                model = msg.get("model", "")
                if not model.startswith("claude"):
                    continue
                u = msg["usage"]
                split = u.get("cache_creation") or {}
                w1h = split.get("ephemeral_1h_input_tokens") or 0
                w5m = split.get("ephemeral_5m_input_tokens") or 0
                if w1h + w5m == 0:
                    w5m = u.get("cache_creation_input_tokens") or 0
                ev = Event(
                    parse_ts(d["timestamp"]), session_id, stream, model,
                    u.get("input_tokens") or 0, w5m, w1h,
                    u.get("cache_read_input_tokens") or 0, u.get("output_tokens") or 0,
                )
                prev = best.get(msg["id"])
                if prev is None or ev.output > prev.output:
                    best[msg["id"]] = ev
    return sorted(best.values(), key=lambda e: e.ts)
