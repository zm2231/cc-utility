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


def _ev(ts, model="claude-opus-5-5", fresh=0, w5=0, w1=0, read=0, out=0, sid="s", stream="main", markers=()):
    return Event(ts, sid, stream, model, fresh, w5, w1, read, out, frozenset(markers))


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


def test_cli_rejects_windows_without_metered_transcript_tokens(tmp_path, monkeypatch, capsys):
    rows = [{"ts": f"2026-07-{1 + h // 24:02d}T{h % 24:02d}:00:00Z", "session_id": "p", "five_hour_pct": 10,
             "five_hour_reset": 3600, "seven_day_pct": 1, "seven_day_reset": 86400 * 9 - h * 3600}
            for h in range(0, 40 * 6, 6) for _ in range(6)]
    (tmp_path / "log.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    sess = tmp_path / "projects" / "proj"
    sess.mkdir(parents=True)
    (sess / "p.jsonl").write_text(json.dumps({"timestamp": "2026-07-01T23:30:00Z", "message": {
        "id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 0, "cache_read_input_tokens": 50_000,
                                                          "output_tokens": 0}}}))
    code, err = _run_cli("all", "--since", "2026-07-01", "--until", "2026-07-20", "--sidecar", str(tmp_path / "log.jsonl"),
                         "--projects", str(tmp_path / "projects"), monkeypatch=monkeypatch, capsys=capsys)
    m = re.search(r"only 0 usable 5h windows with Claude Code token data in this period \((\d+) with usage %\)", err)
    assert code == 2 and m and int(m.group(1)) >= 30


def test_markers_attach_to_the_next_call_once(tmp_path: Path):
    d = tmp_path / "proj"
    d.mkdir()
    def call(mid, out):
        return json.dumps({"timestamp": "2026-10-01T00:00:00Z", "message": {
            "id": mid, "model": "claude-opus-5-5", "usage": {"input_tokens": 1, "output_tokens": out}}})
    lines = [
        json.dumps({"type": "attachment", "attachment": {"type": "deferred_tools_delta"}}),
        json.dumps({"type": "system", "subtype": "compact_boundary"}),
        call("m1", 1),
        json.dumps({"type": "attachment", "attachment": {"type": "date_change"}}),
        call("m1", 9),
        call("m2", 1),
    ]
    (d / "s.jsonl").write_text("\n".join(lines))
    m1, m2 = load_events(tmp_path)
    assert m1.output == 9
    assert m1.markers == {"attachment:deferred_tools_delta", "system:compact_boundary"}
    assert m2.markers == {"attachment:date_change"}


def test_marker_causes():
    evs = [
        _ev(0, w1=50_000),
        _ev(10, w1=50_000, read=1_000, markers={"system:compact_boundary"}),
        _ev(20, w1=51_000, read=1_000, markers={"attachment:mcp_instructions_delta"}),
        _ev(30, w1=52_000, read=1_000, markers={"attachment:date_change"}),
        _ev(40, w1=53_000, read=1_000, markers={"attachment:hook_additional_context"}),
        _ev(4000, w1=53_000, read=1_000, markers={"attachment:compact_file_reference"}),
    ]
    got = [c.cause for c in sorted(rewrites.classify(evs), key=lambda c: c.event.ts)]
    assert got == ["stream start", "after compaction", "tool/agent list changed", "date change",
                   "other prefix change", "after compaction"]


def test_markers_do_not_leak_across_transcript_files(tmp_path: Path):
    sess = tmp_path / "proj" / "sess"
    (sess / "subagents").mkdir(parents=True)
    def call(mid, ts):
        return json.dumps({"timestamp": ts, "message": {
            "id": mid, "model": "claude-opus-5-5", "usage": {"input_tokens": 1, "output_tokens": 1}}})
    (tmp_path / "proj" / "sess.jsonl").write_text("\n".join([
        call("main1", "2026-10-01T00:00:00Z"),
        json.dumps({"type": "system", "subtype": "compact_boundary"}),
    ]))
    (sess / "subagents" / "agent-1.jsonl").write_text(call("sub1", "2026-10-01T00:00:01Z"))
    main1, sub1 = load_events(tmp_path)
    assert (main1.stream, main1.markers) == ("main", frozenset())
    assert (sub1.stream, sub1.markers) == ("agent-1", frozenset())


def test_proxy_log_extracts_final_usage_per_claude_attempt(tmp_path: Path):
    from meter_calibration.proxy import parse_log
    start = {"type": "message_start", "message": {"model": "claude-opus-5-5", "usage": {
        "input_tokens": 2, "cache_creation_input_tokens": 1739, "cache_read_input_tokens": 359316, "output_tokens": 36,
        "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1739}}}}
    delta = {"type": "message_delta", "usage": {
        "input_tokens": 2, "cache_creation_input_tokens": 1739, "cache_read_input_tokens": 359316, "output_tokens": 780}}
    body = {"model": "claude-fable-5-1", "messages": [{"role": "user", "content": '"usage":{"output_tokens":99999}'}]}
    log = "\n".join([
        "=== REQUEST INFO ===", "Timestamp: 2026-10-22T14:26:22Z", "=== REQUEST BODY ===", json.dumps(body),
        "=== API REQUEST 1 ===", "Timestamp: 2026-10-22T14:26:22.4Z",
        "Auth: provider=claude, auth_id=claude-1-a@x.com.json, label=a@x.com, type=oauth",
        "=== API RESPONSE 1 ===", "Status: 429", "",
        "=== API REQUEST 2 ===", "Timestamp: 2026-10-22T14:26:23Z",
        "Auth: provider=claude, auth_id=claude-2-b@x.com.json, label=b@x.com, type=oauth",
        "=== API RESPONSE 2 ===", "Status: 200", "data: " + json.dumps(start), "data: " + json.dumps(delta),
        "=== RESPONSE ===", "Status: 200", "data: " + json.dumps(start),
    ])
    f = tmp_path / "v1-messages-x.log"
    f.write_text(log)
    (rec,) = parse_log(f)
    assert (rec["attempt"], rec["account"], rec["model"], rec["status"]) == (2, "b@x.com", "claude-opus-5-5", 200)
    assert (rec["output_tokens"], rec["cache_read_input_tokens"], rec["write_1h"]) == (780, 359316, 1739)


def test_proxy_log_skips_non_claude_files(tmp_path: Path):
    from meter_calibration.proxy import parse_log
    f = tmp_path / "v1-responses-x.log"
    f.write_text("=== API REQUEST 1 ===\nAuth: provider=codex, auth_id=codex-a.json, label=a@x.com, type=oauth\n"
                 "=== API RESPONSE 1 ===\nStatus: 200\ndata: {\"usage\": {\"output_tokens\": 5}}\n")
    assert parse_log(f) == []


def test_events_merge_across_config_dirs_without_double_counting(tmp_path: Path):
    def call(mid, out):
        return json.dumps({"timestamp": "2026-10-01T00:00:00Z", "message": {
            "id": mid, "model": "claude-opus-5-5", "usage": {"input_tokens": 1, "output_tokens": out}}})
    for name, lines in (("a", [call("m1", 3), call("m2", 1)]), ("b", [call("m1", 7), call("m3", 1)])):
        d = tmp_path / name / "proj"
        d.mkdir(parents=True)
        (d / f"s-{name}.jsonl").write_text("\n".join(lines))
    evs = load_events(tmp_path / "a", tmp_path / "b")
    assert sorted(e.output for e in evs) == [1, 1, 7]


def test_proxy_events_tag_accounts_by_email(tmp_path: Path):
    from meter_calibration.load import load_proxy_events
    rows = [
        {"file": "a.log", "attempt": 1, "ts": "2026-10-22T14:26:22.289067734Z", "account": "me@x.com",
         "model": "claude-opus-5-5", "status": 200, "input_tokens": 2, "cache_creation_input_tokens": 9,
         "cache_read_input_tokens": 100, "output_tokens": 7, "write_5m": 0, "write_1h": 9},
        {"file": "b.log", "attempt": 1, "ts": "2026-10-22T11:33:25-04:00", "account": "other@x.com",
         "model": "claude-opus-5-5", "status": 200, "input_tokens": 1, "cache_creation_input_tokens": 0,
         "cache_read_input_tokens": 0, "output_tokens": 1, "write_5m": 0, "write_1h": 0},
        {"file": "c.log", "attempt": 1, "ts": "2026-10-22T15:00:00Z", "account": "me@x.com",
         "model": "claude-opus-5-5", "status": 529, "input_tokens": 1, "cache_creation_input_tokens": 0,
         "cache_read_input_tokens": 0, "output_tokens": 50, "write_5m": 0, "write_1h": 0},
    ]
    f = tmp_path / "u.jsonl"
    f.write_text("\n".join(json.dumps(r) for r in rows))
    events, accounts = load_proxy_events([f], "me@x.com")
    assert accounts == {"proxy:me@x.com": "primary", "proxy:other@x.com": "other"}
    assert [(e.session_id, e.write_1h, e.output) for e in events] == [("proxy:me@x.com", 9, 7), ("proxy:other@x.com", 0, 1)]


def test_cli_requires_primary_email_with_proxy_usage(tmp_path, monkeypatch, capsys):
    code, err = _run_cli("all", "--since", "2026-07-01", "--until", "2026-07-02", "--proxy-usage", str(tmp_path / "u"),
                         "--sidecar", str(tmp_path / "x"), monkeypatch=monkeypatch, capsys=capsys)
    assert code == 2 and "--primary-email" in err


def test_proxy_misses_are_not_stream_starts():
    evs = [_ev(0, w5=50_000, sid="proxy:me@x.com", stream="a.log"), _ev(5, w5=50_000, sid="s")]
    causes = {c.event.session_id: c.cause for c in rewrites.classify(evs)}
    assert causes == {"proxy:me@x.com": "proxy request (no session context)", "s": "stream start"}


def test_five_hour_capacity_per_token_type():
    from meter_calibration.capacity import five_hour_capacity
    caps = five_hour_capacity({"opus": 2.0, "fable": 0.0})
    assert caps == {"opus": {"fresh": 50.0, "write_5m": 40.0, "write_1h": 25.0, "output": 10.0}}


def test_weekly_ratio_recovers_known_relationship():
    from meter_calibration.capacity import weekly_per_five_hour
    week_end = 30 * 86400.0
    renders, windows = [], []
    weekly = 0.0
    for i in range(24):
        start = i * 6 * 3600.0 + 3600
        end = start + 5 * 3600
        pct = float(10 + (i % 5) * 10)
        renders.append(Render(start - 60, "p", 0.0, start, weekly, week_end))
        weekly += 0.2 * pct
        renders.append(Render(end - 600, "p", pct, end, weekly, week_end))
        w = Window(end=end, pct=pct, renders=10, observed_at=end - 600)
        windows.append(w)
    wk = weekly_per_five_hour(renders, windows, weekly_phase(week_end), {"p": "primary"}, n=50, min_pairs=10)
    assert abs(wk.ratio - 0.2) < 1e-9 and wk.windows == 24
    assert abs(wk.windows_per_week[0] - 5.0) < 1e-6


def test_proxy_log_keeps_claude_retry_after_non_claude_attempt(tmp_path: Path):
    from meter_calibration.proxy import parse_log
    usage = {"input_tokens": 3, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 10, "output_tokens": 40}
    f = tmp_path / "v1-messages-x.log"
    f.write_text("\n".join([
        "=== API REQUEST 1 ===", "Timestamp: 2026-10-22T10:00:00Z",
        "Auth: provider=codex, auth_id=codex-a.json, label=a@x.com, type=oauth",
        "=== API RESPONSE 1 ===", "Status: 200", "data: " + json.dumps({"usage": {"output_tokens": 999}}),
        "=== API REQUEST 2 ===", "Timestamp: 2026-10-22T10:00:01Z",
        "Auth: provider=claude, auth_id=claude-b.json, label=b@x.com, type=oauth",
        "=== API RESPONSE 2 ===", "Status: 200",
        "data: " + json.dumps({"type": "message_delta", "usage": usage}),
    ]))
    (rec,) = parse_log(f)
    assert (rec["attempt"], rec["account"], rec["output_tokens"]) == (2, "b@x.com", 40)


def test_proxy_log_reads_non_streaming_json_response(tmp_path: Path):
    from meter_calibration.proxy import parse_log
    body = {"id": "msg_1", "model": "claude-opus-5-5", "content": [{"type": "text", "text": "hi"}], "usage": {
        "input_tokens": 5, "cache_creation_input_tokens": 70, "cache_read_input_tokens": 900, "output_tokens": 12,
        "cache_creation": {"ephemeral_5m_input_tokens": 70, "ephemeral_1h_input_tokens": 0}}}
    f = tmp_path / "v1-messages-y.log"
    f.write_text("\n".join([
        "=== API REQUEST 1 ===", "Timestamp: 2026-10-22T10:00:00Z",
        "Auth: provider=claude, auth_id=claude-b.json, label=b@x.com, type=oauth",
        "=== API RESPONSE 1 ===", "Status: 200", json.dumps(body),
    ]))
    (rec,) = parse_log(f)
    assert (rec["model"], rec["input_tokens"], rec["write_5m"], rec["cache_read_input_tokens"], rec["output_tokens"]) == (
        "claude-opus-5-5", 5, 70, 900, 12)


def test_proxy_main_accepts_absolute_paths_from_prefilter(tmp_path: Path, monkeypatch, capsys):
    from meter_calibration import proxy
    f = tmp_path / "v1-messages-z.log"
    f.write_text("=== API REQUEST 1 ===\nAuth: provider=claude, auth_id=c.json, label=b@x.com, type=oauth\n"
                 "=== API RESPONSE 1 ===\nStatus: 200\n" + json.dumps({"model": "claude-opus-5-5", "usage": {
                     "input_tokens": 1, "output_tokens": 2}}) + "\n")
    monkeypatch.setattr("sys.argv", ["proxy.py", str(tmp_path), str(f)])
    proxy.main()
    assert json.loads(capsys.readouterr().out)["output_tokens"] == 2


def test_weekly_ratio_rejects_unpaired_windows():
    import pytest

    from meter_calibration.capacity import weekly_per_five_hour
    with pytest.raises(ValueError, match="only 0 5h windows pair"):
        weekly_per_five_hour([], [], 0, {})


def test_cli_capacity_rejects_windows_without_weekly_pairing(tmp_path, monkeypatch, capsys):
    from datetime import UTC, datetime
    week = 7 * 86400
    t0 = datetime(2026, 1, 1, tzinfo=UTC).timestamp()
    rows, calls = [], []
    for i in range(32):
        start = t0 + i * week + 3600
        for j in range(6):
            ts = start + 60 * (j + 1)
            rows.append({"ts": datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "session_id": "p",
                         "five_hour_pct": 10 + i % 5, "five_hour_reset": start + 5 * 3600 - ts, "seven_day_pct": 3,
                         "seven_day_reset": t0 + (i + 1) * week - ts})
        calls.append(json.dumps({"timestamp": datetime.fromtimestamp(start + 30, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                 "message": {"id": f"m{i}", "model": "claude-opus-5-5",
                                             "usage": {"input_tokens": 100, "output_tokens": 50}}}))
    (tmp_path / "log.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    proj = tmp_path / "projects" / "proj"
    proj.mkdir(parents=True)
    (proj / "p.jsonl").write_text("\n".join(calls))
    code, err = _run_cli("capacity", "--since", "2026-01-01", "--until", "2026-12-31", "--sidecar",
                         str(tmp_path / "log.jsonl"), "--projects", str(tmp_path / "projects"),
                         monkeypatch=monkeypatch, capsys=capsys)
    assert code == 2 and "only 0 5h windows pair with a weekly reading" in err and "nan" not in err.lower()


def test_cli_rejects_constant_usage(tmp_path, monkeypatch, capsys):
    from datetime import UTC, datetime
    t0 = datetime(2026, 1, 1, tzinfo=UTC).timestamp()
    rows, calls = [], []
    for i in range(32):
        start = t0 + i * 6 * 3600
        for j in range(6):
            ts = start + 60 * (j + 1)
            rows.append({"ts": datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "session_id": "p",
                         "five_hour_pct": 10, "five_hour_reset": start + 5 * 3600 - ts, "seven_day_pct": 3,
                         "seven_day_reset": t0 + 30 * 86400 - ts})
        calls.append(json.dumps({"timestamp": datetime.fromtimestamp(start + 30, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                 "message": {"id": f"m{i}", "model": "claude-opus-5-5",
                                             "usage": {"input_tokens": 100, "output_tokens": 50}}}))
    (tmp_path / "log.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    proj = tmp_path / "projects" / "proj"
    proj.mkdir(parents=True)
    (proj / "p.jsonl").write_text("\n".join(calls))
    code, err = _run_cli("all", "--since", "2026-01-01", "--until", "2026-12-31", "--sidecar",
                         str(tmp_path / "log.jsonl"), "--projects", str(tmp_path / "projects"),
                         monkeypatch=monkeypatch, capsys=capsys)
    assert code == 2 and "no variation to fit" in err


def test_weekly_ratio_rejects_a_weekly_meter_that_never_moves():
    import pytest

    from meter_calibration.capacity import weekly_per_five_hour
    week_end = 30 * 86400.0
    renders, windows = [], []
    for i in range(30):
        start = i * 6 * 3600.0 + 3600
        end = start + 5 * 3600
        pct = float(10 + (i % 5) * 10)
        renders.append(Render(start - 60, "p", 0.0, start, 4.0, week_end))
        renders.append(Render(end - 600, "p", pct, end, 4.0, week_end))
        windows.append(Window(end=end, pct=pct, renders=10, observed_at=end - 600))
    with pytest.raises(ValueError, match="weekly meter barely moved across 30 paired"):
        weekly_per_five_hour(renders, windows, weekly_phase(week_end), {"p": "primary"}, n=50)
