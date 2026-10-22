"""Extract per-request Claude usage from CLIProxyAPI request logs as JSON lines.

Stdlib only, so it can run as a standalone script on the proxy host: python3 proxy.py LOG_DIR > usage.jsonl
Emits metadata only (time, account, model, status, token counts); request and response content is never output.
"""

import json
import re
import sys
from pathlib import Path

SECTION = re.compile(r"^=== (API REQUEST|API RESPONSE) (\d+) ===$")
OTHER_SECTION = re.compile(r"^=== [A-Z ]+ ===$")
AUTH = re.compile(r"^Auth: provider=([\w-]+), auth_id=[^,]*, label=([^,]+)")
USAGE_KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def _response_objects(line: str):
    body = line[5:].strip() if line.startswith("data:") else line.strip()
    if not body.startswith("{"):
        return
    try:
        obj = json.loads(body)
    except json.JSONDecodeError:
        return
    if isinstance(obj, dict):
        yield obj
        if isinstance(obj.get("message"), dict):
            yield obj["message"]


def parse_log(path: Path) -> list[dict]:
    attempts: dict[int, dict] = {}
    section, n = None, 0
    with path.open(errors="ignore") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            m = SECTION.match(line)
            if m:
                section, n = m.group(1), int(m.group(2))
                attempts.setdefault(n, {"n": n})
                continue
            if OTHER_SECTION.match(line):
                section = None
                continue
            if section is None:
                continue
            a = attempts[n]
            if section == "API REQUEST":
                if line.startswith("Timestamp:") and "ts" not in a:
                    a["ts"] = line.split(":", 1)[1].strip()
                elif (am := AUTH.match(line)):
                    a["provider"], a["account"] = am.group(1), am.group(2).strip()
                    if a["provider"] != "claude" and not any(x.get("provider") == "claude" for x in attempts.values()):
                        return []
                continue
            if line.startswith("Status:") and "status" not in a:
                a["status"] = int(line.split(":", 1)[1].strip() or 0)
                continue
            if '"usage"' not in line and '"model"' not in line:
                continue
            for obj in _response_objects(line):
                if isinstance(obj.get("model"), str) and "model" not in a:
                    a["model"] = obj["model"]
                u = obj.get("usage")
                if not isinstance(u, dict):
                    continue
                if isinstance(u.get("cache_creation"), dict):
                    a["split"] = u["cache_creation"]
                if u.get("output_tokens", 0) >= a.get("usage", {}).get("output_tokens", -1):
                    a["usage"] = u
    out = []
    for a in attempts.values():
        if a.get("provider") != "claude" or "usage" not in a:
            continue
        u = a["usage"]
        split = a.get("split") or {}
        w5m, w1h = split.get("ephemeral_5m_input_tokens") or 0, split.get("ephemeral_1h_input_tokens") or 0
        if w5m + w1h == 0:
            w5m = u.get("cache_creation_input_tokens") or 0
        out.append({
            "file": path.name, "attempt": a["n"], "ts": a.get("ts"), "account": a.get("account"),
            "model": a.get("model", ""), "status": a.get("status"),
            **{k: u.get(k) or 0 for k in USAGE_KEYS},
            "write_5m": w5m,
            "write_1h": w1h,
        })
    return out


def main() -> None:
    root = Path(sys.argv[1])
    names = sys.argv[2:] or [p.name for p in root.iterdir()]
    for name in names:
        if not name.endswith(".log"):
            continue
        for rec in parse_log(root / name):
            sys.stdout.write(json.dumps(rec) + "\n")


if __name__ == "__main__":
    main()
