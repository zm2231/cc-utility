import bisect
from collections import Counter, defaultdict
from dataclasses import dataclass

from .fit import api_equivalent
from .load import Event, Session


@dataclass(frozen=True)
class Turn:
    """Everything the model did between one typed prompt and the next, subagents included."""

    ts: float
    model: str
    calls: int
    subagents: int
    tokens: float
    output: int
    minutes: float


def turns(events: list[Event], sessions: dict[str, Session]) -> list[Turn]:
    by_session: dict[str, list[Event]] = defaultdict(list)
    for e in events:
        if e.session_id in sessions:
            by_session[e.session_id].append(e)
    out = []
    for sid, evs in by_session.items():
        prompts = sessions[sid].prompts
        evs.sort(key=lambda e: e.ts)
        times = [e.ts for e in evs]
        for i, start in enumerate(prompts):
            end = prompts[i + 1] if i + 1 < len(prompts) else float("inf")
            seg = evs[bisect.bisect_left(times, start):bisect.bisect_left(times, end)]
            main = [e for e in seg if not e.is_subagent]
            if not main:
                continue
            out.append(Turn(
                ts=start,
                model=Counter(e.model_id for e in main).most_common(1)[0][0] or "",
                calls=len(seg),
                subagents=len({e.stream for e in seg if e.is_subagent}),
                tokens=sum(api_equivalent(e) for e in seg) / 1e6,
                output=sum(e.output for e in seg),
                minutes=(seg[-1].ts - start) / 60,
            ))
    return sorted(out, key=lambda t: t.ts)
