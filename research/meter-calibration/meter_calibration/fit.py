from dataclasses import dataclass

import numpy as np
from scipy.optimize import nnls

from .load import FAMILIES
from .windows import COLUMNS, Window

API_WEIGHTS = {"fresh": 1.0, "write_5m": 1.25, "write_1h": 2.0, "output": 5.0}
RHO_GRID = np.round(np.linspace(0, 0.5, 101), 4)
I = {c: i for i, c in enumerate(COLUMNS)}


def _write_equiv(t: np.ndarray) -> float:
    return t[I["fresh"]] + API_WEIGHTS["write_5m"] * t[I["write_5m"]] + API_WEIGHTS["write_1h"] * t[I["write_1h"]]


def active_families(windows: list[Window]) -> list[str]:
    return [f for f in FAMILIES if any(w.tokens[f].sum() > 0 for w in windows)]


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


def bootstrap_rho(windows: list[Window], n: int = 200, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y = pcts(windows)
    out = []
    for _ in range(n):
        idx = rng.choice(len(windows), len(windows))
        out.append(best_rho([windows[i] for i in idx], y[idx]))
    return np.percentile(out, [5, 50, 95])


def free_fit(windows: list[Window], families: list[str]) -> dict[str, dict[str, float]]:
    """No API ratios assumed: each family gets independent write, read and output weights in %/Mtok."""
    X = np.array([
        [v for f in families for v in (_write_equiv(w.tokens[f]), w.tokens[f][I["read"]], w.tokens[f][I["output"]])]
        for w in windows
    ]) / 1e6
    k, _ = nnls(X, pcts(windows))
    return {f: dict(zip(("write", "read", "output"), k[3 * j:3 * j + 3], strict=True)) for j, f in enumerate(families)}


def partial_corr_reads(windows: list[Window], family: str) -> float:
    """Correlation between leftover usage and a family's cache reads once every write and output column is accounted for."""
    fams = active_families(windows)
    X = np.array([[c for f in fams for c in (_write_equiv(w.tokens[f]), w.tokens[f][I["output"]])] for w in windows]) / 1e6
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


def power_check(windows: list[Window], true_rho: float, seed: int = 0, trials: int = 50) -> np.ndarray:
    """Synthetic usage from the real token mix with a known read weight and the observed noise level; returns recovered rho percentiles."""
    truth = fit_scales(windows, true_rho)
    fams = list(truth.scales)
    pred = design(windows, true_rho, fams) @ np.array([truth.scales[f] for f in fams])
    observed = fit_scales(windows, best_rho(windows))
    obs_pred = design(windows, observed.rho, fams) @ np.array([observed.scales[f] for f in fams])
    y = pcts(windows)
    sigma = float(np.std(np.log((y + 1) / (obs_pred + 1))))
    rng = np.random.default_rng(seed)
    recovered = [best_rho(windows, pred * np.exp(rng.normal(0, sigma, len(pred)))) for _ in range(trials)]
    return np.percentile(recovered, [5, 50, 95])


def usage_shares(windows: list[Window], n: int = 300, seed: int = 2) -> dict[str, np.ndarray]:
    """Bootstrap shares of meter usage under the free fit, restricted to opus and fable which carry nearly all tokens."""
    fams = [f for f in ("opus", "fable") if f in active_families(windows)]
    rng = np.random.default_rng(seed)
    rows: dict[str, list[float]] = {k: [] for k in ("write", "read", "output", *fams)}
    for _ in range(n):
        sample = [windows[i] for i in rng.choice(len(windows), len(windows))]
        coef = free_fit(sample, fams)
        contrib = {
            (f, kind): coef[f][kind] * sum(
                (_write_equiv(w.tokens[f]) if kind == "write" else w.tokens[f][I[kind]]) for w in windows
            ) / 1e6
            for f in fams for kind in ("write", "read", "output")
        }
        total = sum(contrib.values()) or 1.0
        for kind in ("write", "read", "output"):
            rows[kind].append(sum(contrib[(f, kind)] for f in fams) / total)
        for f in fams:
            rows[f].append(sum(contrib[(f, kind)] for kind in ("write", "read", "output")) / total)
    return {k: np.percentile(v, [5, 50, 95]) for k, v in rows.items()}
