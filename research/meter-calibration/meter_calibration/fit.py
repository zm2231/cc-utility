from dataclasses import dataclass

import numpy as np
from scipy.optimize import nnls

from .load import WEEK, Event
from .windows import COLUMNS, Window

API_WEIGHTS = {"fresh": 1.0, "write_5m": 1.25, "write_1h": 2.0, "output": 5.0}


def api_equivalent(e: Event, rho: float = 0.0) -> float:
    """Tokens of one call in fresh-input units at the API price ratios, with cache reads at `rho`."""
    return (e.fresh + API_WEIGHTS["write_5m"] * e.write_5m + API_WEIGHTS["write_1h"] * e.write_1h + rho * e.read
            + API_WEIGHTS["output"] * e.output)
RHO_GRID = np.round(np.linspace(0, 0.5, 101), 4)
I = {c: i for i, c in enumerate(COLUMNS)}


def _write_equiv(t: np.ndarray) -> float:
    return t[I["fresh"]] + API_WEIGHTS["write_5m"] * t[I["write_5m"]] + API_WEIGHTS["write_1h"] * t[I["write_1h"]]


def active_families(windows: list[Window]) -> list[str]:
    return sorted({f for w in windows for f, t in w.tokens.items() if t.sum() > 0})


def design(windows: list[Window], rho: float, families: list[str]) -> np.ndarray:
    """One column per model family in API-ratio units, so each family gets its own meter scale."""
    rows = []
    for w in windows:
        rows.append([
            _write_equiv(w.tokens[f]) + rho * w.tokens[f][I["read"]] + API_WEIGHTS["output"] * w.tokens[f][I["output"]]
            for f in families
        ])
    return np.array(rows) / 1e6


def pcts(windows: list[Window]) -> np.ndarray:
    return np.array([w.pct for w in windows])


def r_squared(y: np.ndarray, pred: np.ndarray) -> float:
    return float(1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum())


@dataclass
class ScaleFit:
    rho: float
    scales: dict[str, float]
    r2: float


def fit_scales(windows: list[Window], rho: float, y: np.ndarray | None = None) -> ScaleFit:
    fams = active_families(windows)
    X = design(windows, rho, fams)
    y = pcts(windows) if y is None else y
    k, _ = nnls(X, y)
    return ScaleFit(rho, dict(zip(fams, k, strict=True)), r_squared(y, X @ k))


def best_rho(windows: list[Window], y: np.ndarray | None = None, grid: np.ndarray = RHO_GRID) -> float:
    r2s = [fit_scales(windows, r, y).r2 for r in grid]
    return float(grid[int(np.argmax(r2s))])


def week_blocks(windows: list[Window]) -> list[list[int]]:
    blocks: dict[int, list[int]] = {}
    for i, w in enumerate(windows):
        blocks.setdefault(int(w.end // WEEK), []).append(i)
    return list(blocks.values())


def bootstrap_rho(windows: list[Window], n: int = 200, seed: int = 0) -> np.ndarray:
    """Resamples whole weeks, since windows in the same week share workload and unlogged usage."""
    rng = np.random.default_rng(seed)
    y = pcts(windows)
    blocks = week_blocks(windows)
    out = []
    for _ in range(n):
        idx = [i for b in rng.integers(len(blocks), size=len(blocks)) for i in blocks[b]]
        out.append(best_rho([windows[i] for i in idx], y[idx]))
    return np.percentile(out, [5, 50, 95])


FREE_COLUMNS = ("fresh", "write_5m", "write_1h", "read", "output")


def _free_row(w: Window, families: list[str]) -> list[float]:
    row = []
    for f in families:
        t = w.tokens[f]
        row += [t[I[c]] for c in FREE_COLUMNS]
    return row


def free_fit(windows: list[Window], families: list[str], y: np.ndarray | None = None) -> dict[str, dict[str, float]]:
    """No API ratios assumed: each family gets an independent weight per token type, in %/Mtok."""
    X = np.array([_free_row(w, families) for w in windows]) / 1e6
    k, _ = nnls(X, pcts(windows) if y is None else y)
    n = len(FREE_COLUMNS)
    return {f: dict(zip(FREE_COLUMNS, k[n * j:n * j + n], strict=True)) for j, f in enumerate(families)}


def partial_corr_reads(windows: list[Window], family: str) -> float:
    """Correlation between leftover usage and a family's cache reads once each write type and output is accounted for
    separately per family."""
    fams = active_families(windows)
    keep = [m for m, c in enumerate(FREE_COLUMNS) if c != "read"]
    X = np.array([[row[j * len(FREE_COLUMNS) + m] for j in range(len(fams)) for m in keep]
                  for row in (_free_row(w, fams) for w in windows)]) / 1e6
    y = pcts(windows)
    k, _ = nnls(X, y)
    resid = y - X @ k
    reads = np.array([w.tokens[family][I["read"]] for w in windows]) / 1e6
    reads_resid = reads - X @ np.linalg.lstsq(X, reads, rcond=None)[0]
    return float(np.corrcoef(resid, reads_resid)[0, 1])


def family_share(windows: list[Window], family: str, scales: dict[str, float]) -> np.ndarray:
    fams = list(scales)
    X = design(windows, 0.0, fams) * np.array([scales[f] for f in fams])
    totals = X.sum(1)
    return np.divide(X[:, fams.index(family)], totals, out=np.zeros_like(totals), where=totals > 0)


def dominated_by(windows: list[Window], family: str, threshold: float = 0.8) -> list[Window]:
    scales = fit_scales(windows, 0.0).scales
    if family not in scales:
        return []
    share = family_share(windows, family, scales)
    return [w for w, s in zip(windows, share, strict=True) if s >= threshold]


def read_term(windows: list[Window], scales: dict[str, float]) -> np.ndarray:
    return np.array([sum(scales[f] * w.tokens[f][I["read"]] for f in scales) for w in windows]) / 1e6


def injection_check(windows: list[Window], injected_rho: float) -> float:
    """Adds a known read charge to the real usage % and re-estimates, so every real-world misspecification in the data
    (unlogged usage, account leakage, timing) stays in place; a biased estimator under-recovers the injection."""
    base = fit_scales(windows, best_rho(windows))
    y = pcts(windows) + injected_rho * read_term(windows, base.scales)
    return best_rho(windows, y) - base.rho


def usage_shares(windows: list[Window], n: int = 200, seed: int = 2) -> dict[str, np.ndarray]:
    """Week-block bootstrap of meter usage shares under the API-ratio model, re-estimating rho and the family scales on
    each resample so the read share carries the read weight's uncertainty."""
    fams = active_families(windows)
    y = pcts(windows)
    blocks = week_blocks(windows)
    tot = {f: sum((w.tokens[f] for w in windows), np.zeros(len(COLUMNS))) / 1e6 for f in fams}
    rng = np.random.default_rng(seed)
    rows: dict[str, list[float]] = {k: [] for k in ("write", "read", "output", *fams)}
    for _ in range(n):
        idx = [i for b in rng.integers(len(blocks), size=len(blocks)) for i in blocks[b]]
        sample = [windows[i] for i in idx]
        rho = best_rho(sample, y[idx])
        k = fit_scales(sample, rho, y[idx]).scales
        parts = {f: {"write": k[f] * _write_equiv(tot[f]), "read": k[f] * rho * tot[f][I["read"]],
                     "output": k[f] * API_WEIGHTS["output"] * tot[f][I["output"]]} for f in fams}
        total = sum(v for p in parts.values() for v in p.values()) or 1.0
        for kind in ("write", "read", "output"):
            rows[kind].append(sum(p[kind] for p in parts.values()) / total)
        for f in fams:
            rows[f].append(sum(parts[f].values()) / total)
    return {k: np.percentile(v, [5, 50, 95]) for k, v in rows.items()}
