import json
from pathlib import Path

import numpy as np

from meter_calibration import fit, rewrites
from meter_calibration.load import Event, load_events, load_renders, tag_accounts
from meter_calibration.windows import Window


def _ev(ts, model="claude-opus-5-5", fresh=0, w5=0, w1=0, read=0, out=0, sid="s", stream="main"):
    return Event(ts, sid, stream, model, fresh, w5, w1, read, out)


def test_stale_renders_are_dropped(tmp_path: Path):
    log = tmp_path / "log.jsonl"
    log.write_text("\n".join(json.dumps(d) for d in (
        {"ts": "2026-10-01T00:00:00Z", "session_id": "a", "five_hour_pct": 10, "five_hour_reset": 3600,
         "seven_day_pct": 20, "seven_day_reset": 86400},
        {"ts": "2026-10-01T00:00:00Z", "session_id": "b", "five_hour_pct": 90, "five_hour_reset": 0,
         "seven_day_pct": 20, "seven_day_reset": 86400},
        "not json",
    )))
    renders = load_renders(log)
    assert [r.session_id for r in renders] == ["a"]


def test_accounts_tagged_by_weekly_reset_hour(tmp_path: Path):
    log = tmp_path / "log.jsonl"
    rows = [{"ts": "2026-10-01T00:00:00Z", "session_id": f"p{i}", "five_hour_pct": 1, "five_hour_reset": 3600,
             "seven_day_pct": 1, "seven_day_reset": 86400} for i in range(3)]
    rows.append({"ts": "2026-10-01T00:00:00Z", "session_id": "x", "five_hour_pct": 1, "five_hour_reset": 3600,
                 "seven_day_pct": 1, "seven_day_reset": 86400 + 6 * 3600})
    log.write_text("\n".join(json.dumps(r) for r in rows))
    _, accounts = tag_accounts(load_renders(log))
    assert accounts == {"p0": "primary", "p1": "primary", "p2": "primary", "x": "other"}


def test_transcript_duplicates_keep_final_output(tmp_path: Path):
    sub = tmp_path / "proj" / "sess1" / "subagents"
    sub.mkdir(parents=True)
    def line(out):
        return json.dumps({"timestamp": "2026-10-01T00:00:00Z", "message": {
            "id": "m1", "model": "claude-fable-5-1",
            "usage": {"input_tokens": 1, "cache_read_input_tokens": 5, "output_tokens": out,
                      "cache_creation": {"ephemeral_1h_input_tokens": 7, "ephemeral_5m_input_tokens": 0}}}})
    (sub / "agent-1.jsonl").write_text(line(3) + "\n" + line(40) + "\n")
    (ev,) = load_events(tmp_path)
    assert (ev.session_id, ev.stream, ev.output, ev.write_1h, ev.family) == ("sess1", "agent-1", 40, 7, "fable")


def _synthetic_windows(rho_true, n=300, seed=0):
    rng = np.random.default_rng(seed)
    windows, ys = [], []
    for i in range(n):
        w = Window(end=float(i), pct=0.0, renders=10)
        scale = rng.lognormal(0, 1)
        read = scale * rng.uniform(5e6, 1e8)
        w.tokens["opus"][:] = (1e4 * scale, 0, scale * rng.uniform(1e5, 2e6), read, scale * rng.uniform(2e4, 4e5))
        windows.append(w)
    X = fit.design(windows, rho_true, ["opus"])[:, 0] * 2.0
    for w, x in zip(windows, X, strict=True):
        w.pct = float(x * rng.lognormal(0, 0.1))
        ys.append(w.pct)
    return windows


def test_fit_recovers_nonzero_read_weight():
    assert abs(fit.best_rho(_synthetic_windows(0.1)) - 0.1) <= 0.03


def test_fit_recovers_zero_read_weight():
    assert fit.best_rho(_synthetic_windows(0.0)) <= 0.01


def test_rewrite_causes():
    evs = [
        _ev(0, w1=50_000, fresh=10),
        _ev(10, w1=2_000, read=50_000),
        _ev(4000, w1=52_000),
        _ev(4010, model="claude-fable-5-1", w1=52_000),
        _ev(4020, model="claude-fable-5-1", w1=20_000, read=1_000),
        _ev(4030, model="claude-fable-5-1", w1=30_000, read=1_000, stream="agent-x"),
    ]
    got = [(c.event.ts, c.cause) for c in sorted(rewrites.classify(evs), key=lambda c: c.event.ts)]
    assert got == [(0, "stream start"), (10, None), (4000, "idle expiry"), (4010, "model switch"),
                   (4020, "after compaction"), (4030, "stream start")]


def test_five_minute_ttl_applies_without_1h_writes():
    evs = [_ev(0, w5=50_000), _ev(400, w5=51_000)]
    assert [c.cause for c in rewrites.classify(evs)] == ["stream start", "idle expiry"]


def test_context_buckets():
    assert [rewrites.context_bucket(c) for c in (5, 150_000, 250_000, 900_000)] == ["0-100k", "100-200k", "200-300k", "300k+"]
