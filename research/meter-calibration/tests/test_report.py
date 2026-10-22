import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from meter_calibration import checks
from meter_calibration.load import (
    Compaction,
    Event,
    Render,
    Session,
    load_events,
    load_sessions,
    weekly_phase,
)
from meter_calibration.turns import turns
from meter_calibration.windows import Window, five_hour_windows

WEEK_END = 1_000_000.0


def _ev(ts, model="claude-opus-5-5", fresh=0, w5=0, w1=0, read=0, out=0, sid="s", stream="main", version="", entry=""):
    return Event(ts, sid, stream, model, fresh, w5, w1, read, out, frozenset(), version, entry)


def _iso(ts):
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_events_carry_version_entrypoint_and_model_id(tmp_path: Path):
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "s1.jsonl").write_text("\n".join(json.dumps(d) for d in (
        {"type": "user", "timestamp": "2026-10-01T00:00:00Z", "message": {"content": "hi"}},
        {"timestamp": "2026-10-01T00:00:01Z", "version": "2.1.300", "entrypoint": "sdk-cli", "message": {
            "id": "m1", "model": "claude-opus-5-20260901", "usage": {"input_tokens": 1, "output_tokens": 2}}},
    )))
    (e,) = load_events(tmp_path)
    assert (e.version, e.entrypoint, e.model_id, e.is_subagent) == ("2.1.300", "sdk-cli", "opus-5", False)
    assert not _ev(0, sid="proxy:a@x", stream="file.log").is_subagent


def test_sessions_keep_typed_prompts_and_compactions(tmp_path: Path):
    proj = tmp_path / "proj"
    proj.mkdir()
    rows = [
        {"type": "user", "timestamp": "2026-10-01T00:00:00Z", "message": {"content": "fix the bug"}},
        {"type": "user", "timestamp": "2026-10-01T00:00:01Z", "message": {"content": [{"type": "tool_result", "content": "ok"}]}},
        {"type": "user", "timestamp": "2026-10-01T00:00:02Z", "isMeta": True, "message": {"content": "meta"}},
        {"type": "user", "timestamp": "2026-10-01T00:00:03Z", "message": {"content": "<command-name>/clear</command-name>"}},
        {"type": "user", "timestamp": "2026-10-01T00:00:04Z", "message": {"content": [{"type": "text", "text": "and test it"}]}},
        {"type": "system", "subtype": "compact_boundary", "timestamp": "2026-10-01T01:00:00Z",
         "compactMetadata": {"trigger": "manual", "preTokens": 300_000, "postTokens": 20_000}},
    ]
    (proj / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    s = load_sessions(tmp_path)["s1"]
    assert [_iso(t)[11:19] for t in s.prompts] == ["00:00:00", "00:00:04"]
    assert [(c.pre_tokens, c.post_tokens) for c in s.compactions] == [(300_000, 20_000)]


def test_windows_can_fit_each_model_separately():
    end = 20_000.0
    renders = [Render(end - 3000 + i, "p", 10.0, end, 1.0, WEEK_END) for i in range(6)]
    events = [_ev(end - 3500, model="claude-opus-5", out=10, sid="p"), _ev(end - 3400, model="claude-opus-5-5", out=20, sid="p")]
    (w,) = five_hour_windows(renders, events, weekly_phase(WEEK_END), {"p": "primary"}, group=lambda e: e.model_id)
    assert {k: v[4] for k, v in w.tokens.items()} == {"opus-5": 10, "opus-5-5": 20}


def test_turns_include_subagent_work_until_the_next_prompt():
    sessions = {"s": Session(prompts=[0.0, 1000.0])}
    events = [_ev(10, out=100), _ev(20, out=50, stream="agent-1", model="claude-fable-5-1"), _ev(400, out=10),
              _ev(1010, model="claude-opus-5", out=7)]
    first, second = turns(events, sessions)
    assert (first.model, first.calls, first.subagents, first.output, first.minutes) == ("opus-5-5", 3, 1, 160, 400 / 60)
    assert (second.model, second.calls, second.subagents) == ("opus-5", 1, 0)


def test_off_schedule_reset_detected_only_mid_cycle():
    end = 30 * 86400.0
    rs = [Render(end - 6 * 86400 + i * 600, "p", 1, end, min(90.0, i), end) for i in range(100)]
    rs += [Render(end - 3 * 86400 + i * 600, "p", 1, end, float(i % 5), end) for i in range(30)]
    rs += [Render(end - 86400 + i * 600, "p", 1, end + 7 * 86400, 0.0, end + 7 * 86400) for i in range(30)]
    (reset,) = checks.off_schedule_resets(rs)
    assert (reset["from_pct"], reset["to_pct"], round(reset["days_early"])) == (90.0, 0.0, 3)


def test_cache_ttl_shares_split_main_and_subagents():
    day = datetime(2026, 10, 1, tzinfo=UTC).timestamp()
    (row,) = checks.cache_ttl_by_day([_ev(day, w1=300), _ev(day, w5=100), _ev(day, w5=50, stream="agent-1"),
                                      _ev(day, read=10, sid="proxy:x", stream="f.log")])
    assert (row["main"], row["main_5m_share"], row["subagent"], row["subagent_5m_share"]) == (2, 0.25, 1, 1.0)


def test_stuck_cache_and_cache_expiry_are_told_apart_by_the_gap():
    def stream(gap, name):
        return [_ev(0, w5=20_000, stream=name, version="2.1.301"),
                _ev(gap, w5=200_000, read=18_000, stream=name, version="2.1.301")]
    events = stream(30, "agent-fast") + stream(900, "agent-slow")
    (stuck,) = checks.stuck_subagent_cache(events)
    assert (stuck["version"], stuck["calls"], stuck["written"], stuck["subagent_calls"]) == ("2.1.301", 1, 200_000, 4)
    expiry = checks.subagent_cache_expiry(events)
    assert (expiry["calls"], expiry["written"], expiry["written_within_hour"]) == (1, 200_000, 200_000)


def test_phantom_rises_ignore_stale_readings_and_logged_calls():
    end = 50_000.0
    rs = [Render(end - 4000, "p", 10, end, 1, WEEK_END), Render(end - 3900, "q", 5, end, 1, WEEK_END),
          Render(end - 3800, "p", 14, end, 1, WEEK_END), Render(end - 3000, "p", 20, end, 1, WEEK_END)]
    calls = [_ev(end - 3880, out=10), _ev(end - 3400, out=10, sid="elsewhere")]
    out = checks.phantom_rises(rs, calls, weekly_phase(WEEK_END), {"p": "primary", "q": "primary", "elsewhere": "other"})
    assert (out["rises"], out["points"]) == (2, 10)
    assert [(p["points"], p["minutes"]) for p in out["phantom"]] == [(6, 800 / 60)]


def test_idle_compaction_needs_an_hour_of_quiet_without_a_prompt():
    sessions = {
        "idle": Session(prompts=[0.0], compactions=[Compaction(54 * 60 + 10, 300_000, 20_000)]),
        "typed": Session(prompts=[0.0, 30 * 60], compactions=[Compaction(54 * 60 + 10, 300_000, 20_000)]),
        "busy": Session(prompts=[0.0], compactions=[Compaction(20 * 60, 300_000, 20_000)]),
    }
    events = [_ev(10, out=1, sid=s) for s in sessions] + [_ev(3 * 3600, out=1, sid="idle")]
    (c,) = checks.idle_compactions(sessions, events, since=0)
    assert (round(c["gap_minutes"]), c["pre_tokens"], round(c["resumed_after_hours"], 2)) == (54, 300_000, 2.10)


def test_group_rates_recover_each_pool_alone_and_jointly():
    rng = np.random.default_rng(0)
    windows = []
    for i in range(80):
        w = Window(end=float(i), pct=0.0, renders=10)
        a = rng.uniform(1e6, 2e7)
        b = 0 if i % 2 else a * rng.uniform(0.5, 2)
        w.tokens["opus-5"][:] = (a, 0, 0, 0, 0)
        if b:
            w.tokens["fable-5-1"][:] = (b, 0, 0, 0, 0)
        w.pct = 1.5 * a / 1e6 + 6.0 * b / 1e6
        windows.append(w)
    rates = checks.group_rates(windows)
    assert rates["opus-5"]["alone_median"] == pytest.approx(1.5)
    assert rates["opus-5"]["alone_windows"] == 40
    assert rates["fable-5-1"]["joint"] == pytest.approx(6.0)


def test_weekly_prediction_uses_each_models_scale():
    day = datetime(2026, 10, 1, tzinfo=UTC).timestamp()
    rs = [Render(day + i * 600, "p", 1, day + 9e4, 10.0 + i * 0.5, WEEK_END * 10) for i in range(30)]
    events = [_ev(day + 100, model="claude-opus-5", fresh=2_000_000, sid="p"),
              _ev(day + 200, model="claude-fable-5-1", fresh=1_000_000, sid="p")]
    (row,) = checks.weekly_observed_vs_predicted(rs, events, weekly_phase(WEEK_END * 10), {"p": "primary"},
                                                 {"opus-5": 1.0, "fable-5-1": 4.0}, 0.5, lambda e: e.model_id)
    assert (row["observed"], row["predicted"]) == (10.0, pytest.approx(3.0))


def test_cli_report_writes_json(tmp_path, monkeypatch, capsys):
    from meter_calibration import cli
    t0 = datetime(2026, 1, 1, tzinfo=UTC).timestamp()
    rows, calls = [], []
    for i in range(40):
        start = t0 + i * 6 * 3600
        for j in range(6):
            ts = start + 60 * (j + 1)
            rows.append({"ts": _iso(ts), "session_id": "p", "five_hour_pct": 5 + i % 7 + j,
                         "five_hour_reset": start + 5 * 3600 - ts, "seven_day_pct": (i % 28) + j * 0.5,
                         "seven_day_reset": t0 + (i // 28 + 1) * 7 * 86400 - ts})
        calls.append({"type": "user", "timestamp": _iso(start + 10), "message": {"content": f"task {i}"}})
        calls.append({"timestamp": _iso(start + 30), "message": {"id": f"m{i}", "model": "claude-opus-5-5", "usage": {
            "input_tokens": 100_000 * (1 + i % 7), "output_tokens": 5_000 * (1 + i % 3)}}})
    (tmp_path / "log.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    proj = tmp_path / "projects" / "proj"
    proj.mkdir(parents=True)
    (proj / "p.jsonl").write_text("\n".join(json.dumps(c) for c in calls))
    out = tmp_path / "report.json"
    monkeypatch.setattr("sys.argv", ["meter-calibration", "report", "--since", "2026-01-01", "--until", "2026-02-01",
                                     "--sidecar", str(tmp_path / "log.jsonl"), "--projects", str(tmp_path / "projects"),
                                     "--breaks", "2026-01-05", "--boot", "5", "--out", str(out)])
    cli.main()
    data = json.loads(out.read_text())
    assert data["accounts"] == [{"label": "A", "renders": 240, "measured": True}]
    assert set(data["rates"]["by_model"]) == {"opus-5-5"}
    assert sum(d["prompts"] for d in data["daily"]) == 40
    first = data["five_hour_windows"][0]
    assert data["token_columns"] == ["fresh", "write_5m", "write_1h", "read", "output"]
    assert first["tokens"] == {"opus-5-5": [0.1, 0.0, 0.0, 0.0, 0.005]}


def test_cli_report_requires_out(tmp_path, monkeypatch, capsys):
    from meter_calibration import cli
    monkeypatch.setattr("sys.argv", ["meter-calibration", "report", "--since", "2026-01-01", "--until", "2026-02-01"])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 2 and "report needs --out" in capsys.readouterr().err


def test_report_covers_only_the_measured_account_inside_the_period():
    from meter_calibration import report
    t0 = datetime(2026, 1, 1, tzinfo=UTC).timestamp()
    since = t0 + 86400
    renders, events, sessions = [], [], {}
    for i in range(40):
        start = since + i * 6 * 3600
        for j in range(6):
            ts = start + 60 * (j + 1)
            renders.append(Render(ts, "a", 5.0 + i % 7 + j, start + 5 * 3600, float(i % 28) + j * 0.5,
                                  t0 + (i // 28 + 1) * 7 * 86400 + 86400))
        renders.append(Render(start + 30, "b", 50.0, start + 5 * 3600, 50.0, t0 + 3 * 86400 + 6 * 3600))
        events.append(_ev(start + 30, fresh=100_000 * (1 + i % 7), out=5_000, sid="a"))
    events += [_ev(since - 60, out=7_777, sid="a"), _ev(since + 100, out=8_888, sid="b"),
               _ev(since + 200, out=9_999, sid="headless", entry="sdk-cli")]
    sessions = {"a": Session(prompts=[since - 120, since + 10]), "b": Session(prompts=[since + 90]),
                "headless": Session(prompts=[since + 190])}
    events.sort(key=lambda e: e.ts)
    accounts = {"a": "primary", "b": "other"}
    data = report.build(renders, events, sessions, weekly_phase(renders[0].seven_day_reset), accounts, since,
                        since + 20 * 86400, [], boot=5)
    assert min(d["day"] for d in data["daily"]) == _iso(since)[:10]
    outputs = sum(d["tokens_by_type"]["output"] for d in data["daily"]) * 1e6
    assert round(outputs) == 40 * 5_000
    assert sum(d["prompts"] for d in data["daily"]) == 1
    assert data["rates"]["headless"]["assumes"]


def test_checks_use_the_call_before_the_period_without_counting_it():
    since = 10_000.0
    events = [_ev(since - 2000, w5=20_000, stream="agent-3"), _ev(since - 1000, w5=200_000, read=18_000, stream="agent-3"),
              _ev(since - 30, w5=20_000, stream="agent-1"), _ev(since + 10, w5=200_000, read=18_000, stream="agent-1"),
              _ev(since - 600, w5=20_000, stream="agent-2"), _ev(since + 10, w5=200_000, read=18_000, stream="agent-2"),
              _ev(since - 50 * 60, out=1)]
    (stuck,) = checks.stuck_subagent_cache(events, since)
    assert (stuck["calls"], stuck["subagent_calls"]) == (1, 2)
    assert checks.subagent_cache_expiry(events, since)["calls"] == 1
    sessions = {"s": Session(prompts=[0.0], compactions=[Compaction(since + 4 * 60, 300_000, 20_000)])}
    assert len(checks.idle_compactions(sessions, events, since)) == 1
