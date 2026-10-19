import json
import re
from pathlib import Path

import numpy as np

from meter_calibration import fit, rewrites
from meter_calibration.load import (
    Event,
    Render,
    load_events,
    load_renders,
    tag_accounts,
    weekly_phase,
)
from meter_calibration.windows import Window, five_hour_windows


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


def _render(ts, sid, pct, reset_end, week_reset=1_000_000.0):
    return Render(ts, sid, pct, reset_end, 1.0, week_reset)


def test_window_excludes_events_after_the_render_that_supplied_pct():
    end = 20_000.0
    renders = [_render(end - 3000 + i, "p", 10.0 if i < 4 else 30.0, end) for i in range(6)]
    events = [_ev(end - 3500, out=1000, sid="p"), _ev(end - 100, read=9_000_000, sid="p"), _ev(end - 5 * 3600 - 60, out=50, sid="p")]
    (w,) = five_hour_windows(renders, events, weekly_phase(1_000_000.0), {"p": "primary"})
    assert (w.end, w.pct, w.observed_at) == (end, 30.0, end - 2995)
    assert w.total("read") == 0 and w.total("output") == 1000


def test_unrendered_sessions_excluded_unless_requested():
    end = 20_000.0
    renders = [_render(end - 3000 + i, "p", 10.0, end) for i in range(6)]
    events = [_ev(end - 2999, out=500, sid="p"), _ev(end - 2999, out=7000, sid="headless")]
    phase = weekly_phase(1_000_000.0)
    (strict,) = five_hour_windows(renders, events, phase, {"p": "primary"})
    (loose,) = five_hour_windows(renders, events, phase, {"p": "primary"}, include_unknown=True)
    assert (strict.total("output"), loose.total("output")) == (500, 7500)


def test_injection_check_recovers_known_read_charge():
    windows = _synthetic_windows(0.0)
    assert abs(fit.injection_check(windows, 0.05) - 0.05) <= 0.015


def test_free_fit_estimates_ratios_without_assuming_them():
    rng = np.random.default_rng(3)
    windows = []
    for i in range(200):
        w = Window(end=float(i), pct=0.0, renders=10)
        w.tokens["opus"][:] = (0, *rng.uniform(1e5, 1e6, 2), rng.uniform(1e7, 1e8), rng.uniform(1e4, 3e5))
        t = w.tokens["opus"] / 1e6
        w.pct = 1.0 * t[1] + 3.0 * t[2] + 0.02 * t[3] + 10.0 * t[4]
        windows.append(w)
    c = fit.free_fit(windows, ["opus"])["opus"]
    assert np.allclose([c["write_5m"], c["write_1h"], c["read"], c["output"]], [1.0, 3.0, 0.02, 10.0], rtol=1e-3)


def test_bootstrap_resamples_whole_weeks():
    windows = [Window(end=float(d * 86400), pct=1.0, renders=10) for d in range(21)]
    assert sorted(len(b) for b in fit.week_blocks(windows)) == [7, 7, 7]


def test_period_bounds_apply_to_renders_and_events():
    from meter_calibration.cli import select_period
    renders = [_render(t, "p", 5.0, t + 100) for t in (99.0, 100.0, 199.0, 200.0)]
    events = [_ev(t) for t in (100.0 - 5 * 3600 - 1, 100.0 - 5 * 3600, 150.0, 200.0)]
    r, e = select_period(renders, events, 100.0, 200.0)
    assert [x.ts for x in r] == [100.0, 199.0]
    assert [x.ts for x in e] == [100.0 - 5 * 3600, 150.0]


def test_free_fit_gives_fresh_input_its_own_weight():
    rng = np.random.default_rng(4)
    windows = []
    for i in range(200):
        w = Window(end=float(i), pct=0.0, renders=10)
        w.tokens["opus"][:] = rng.uniform(1e5, 1e6, 5)
        t = w.tokens["opus"] / 1e6
        w.pct = float(t @ np.array([7.0, 1.0, 3.0, 0.02, 10.0]))
        windows.append(w)
    c = fit.free_fit(windows, ["opus"])["opus"]
    assert np.allclose(list(c.values()), [7.0, 1.0, 3.0, 0.02, 10.0], rtol=1e-3)


def _run_cli(*argv, monkeypatch, capsys):
    import pytest

    from meter_calibration import cli
    monkeypatch.setattr("sys.argv", ["meter-calibration", *argv])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    return exc.value.code, capsys.readouterr().err


def test_cli_rejects_reversed_period(tmp_path, monkeypatch, capsys):
    code, err = _run_cli("all", "--since", "2026-10-19", "--until", "2026-07-01", "--sidecar", str(tmp_path / "x"),
                         "--projects", str(tmp_path), monkeypatch=monkeypatch, capsys=capsys)
    assert code == 2 and "--since must be before --until" in err


def test_cli_rejects_period_without_data(tmp_path, monkeypatch, capsys):
    (tmp_path / "log.jsonl").write_text("")
    code, err = _run_cli("all", "--since", "2026-07-01", "--until", "2026-07-02", "--sidecar", str(tmp_path / "log.jsonl"),
                         "--projects", str(tmp_path), monkeypatch=monkeypatch, capsys=capsys)
    assert code == 2 and "no status-line renders" in err


def test_cli_rejects_too_few_windows(tmp_path, monkeypatch, capsys):
    rows = [{"ts": "2026-07-01T01:00:00Z", "session_id": "p", "five_hour_pct": 10, "five_hour_reset": 3600,
             "seven_day_pct": 1, "seven_day_reset": 86400}] * 6
    (tmp_path / "log.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    code, err = _run_cli("all", "--since", "2026-07-01", "--until", "2026-07-02", "--sidecar", str(tmp_path / "log.jsonl"),
                         "--projects", str(tmp_path), monkeypatch=monkeypatch, capsys=capsys)
    assert code == 2 and "only 0 usable 5h windows with Claude Code token data in this period (1 with usage %)" in err


def test_cli_rejects_windows_without_transcript_tokens(tmp_path, monkeypatch, capsys):
    rows = [{"ts": f"2026-07-{1 + h // 24:02d}T{h % 24:02d}:00:00Z", "session_id": "p", "five_hour_pct": 10,
             "five_hour_reset": 3600, "seven_day_pct": 1, "seven_day_reset": 86400 * 9 - h * 3600}
            for h in range(0, 40 * 6, 6) for _ in range(6)]
    (tmp_path / "log.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    (tmp_path / "projects").mkdir()
    code, err = _run_cli("all", "--since", "2026-07-01", "--until", "2026-07-20", "--sidecar", str(tmp_path / "log.jsonl"),
                         "--projects", str(tmp_path / "projects"), monkeypatch=monkeypatch, capsys=capsys)
    m = re.search(r"only 0 usable 5h windows with Claude Code token data in this period \((\d+) with usage %\)", err)
    assert code == 2 and m and int(m.group(1)) >= 30
