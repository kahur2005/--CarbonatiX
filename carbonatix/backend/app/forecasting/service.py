"""Price forecasting from pre-trained artifacts.

Models are fitted offline (see ml/train_*.py) and loaded once at first use.
Nothing trains at request time, so the demo is reproducible.

Task 10 could not obtain real market data; the human ruled that the training
series be generated synthetically and labelled inescapably. Both committed
artifacts (nickel_lme_SYNTHETIC.pkl, idx_carbon_SYNTHETIC.pkl) carry a
`carbonatix_provenance` attribute recording that. This module reads it and
threads it through to `current_forecast`'s return value -- both as the raw
per-series metadata (`provenance`) and as an unambiguous top-level
`synthetic` flag -- so a consumer (Task 9's advisor, Task 14's chart) can
never present a fabricated price as if it were real market data without
actively ignoring the flag.
"""

import pickle
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

__all__ = ["ForecastUnavailable", "current_forecast"]

_ARTIFACT_DIR = Path(__file__).parent / "artifacts"
_models: dict[str, Any] = {}

# Real on-disk artifact names (Task 10's brief called these "nickel_lme" and
# "idx_carbon"; the human ruled the series be generated synthetically and the
# files renamed accordingly -- do not rename them back).
_LME_ARTIFACT = "nickel_lme_SYNTHETIC"
_CARBON_ARTIFACT = "idx_carbon_SYNTHETIC"

# Used when an artifact has no carbonatix_provenance attribute at all.
# Unlabelled is not the same as verified-real, so an unlabelled artifact is
# reported as synthetic/unknown rather than silently passed through as
# trustworthy.
_UNKNOWN_PROVENANCE: dict[str, Any] = {
    "synthetic": True,
    "warning": (
        "Artifact carries no carbonatix_provenance metadata. Provenance is "
        "unknown, not verified real -- treated as synthetic out of caution."
    ),
}


class ForecastUnavailable(RuntimeError):
    """Raised when an artifact is missing or unreadable.

    Deliberately fatal rather than falling back to a made-up number: the
    advisor is told forecasts are unavailable instead of being left to
    invent a price.
    """


def _load(name: str) -> Any:
    if name not in _models:
        path = _ARTIFACT_DIR / f"{name}.pkl"
        try:
            _models[name] = pickle.loads(path.read_bytes())
        except (OSError, pickle.UnpicklingError) as exc:
            raise ForecastUnavailable(f"Cannot load forecast artifact {name}") from exc
    return _models[name]


def _provenance(model: Any) -> dict[str, Any]:
    """The synthetic-data provenance label carried by a loaded model.

    Returns a fresh dict, never the model's own attribute object, so a
    caller mutating the result can't corrupt the cached model.
    """
    prov = getattr(model, "carbonatix_provenance", None)
    if prov is None:
        return dict(_UNKNOWN_PROVENANCE)
    return dict(prov)


def _predict(model: Any, horizon_days: int) -> tuple[list[float], list[float], list[float]]:
    future = model.make_future_dataframe(periods=horizon_days)
    fc = model.predict(future).tail(horizon_days)
    return (
        fc["yhat"].tolist(),
        fc["yhat_lower"].tolist(),
        fc["yhat_upper"].tolist(),
    )


async def current_forecast(horizon_days: int = 30) -> dict:
    """Both price series for the horizon, with 80% intervals.

    Currency units are encoded in every monetary key. USD and IDR never
    share a key. Every value in this response may originate from a
    synthetic (fabricated) training series -- see module docstring.
    `synthetic` is the flag a consumer must check before rendering any
    value as if it were real; `provenance` carries the raw metadata behind
    it for each series.
    """
    if not 1 <= horizon_days <= 30:
        raise ValueError(f"horizon_days must be 1..30, got {horizon_days}")

    lme_model = _load(_LME_ARTIFACT)
    carbon_model = _load(_CARBON_ARTIFACT)

    lme, lme_lo, lme_hi = _predict(lme_model, horizon_days)
    carbon, carbon_lo, carbon_hi = _predict(carbon_model, horizon_days)

    lme_provenance = _provenance(lme_model)
    carbon_provenance = _provenance(carbon_model)
    synthetic = bool(lme_provenance.get("synthetic")) or bool(carbon_provenance.get("synthetic"))

    start = datetime.now(UTC).date()
    return {
        "dates": [(start + timedelta(days=i)).isoformat() for i in range(horizon_days)],
        "lmeUsdPerTon": lme,
        "lmeUsdPerTonLower": lme_lo,
        "lmeUsdPerTonUpper": lme_hi,
        "idxCarbonIdrPerTon": carbon,
        "idxCarbonIdrPerTonLower": carbon_lo,
        "idxCarbonIdrPerTonUpper": carbon_hi,
        "stale": False,
        "synthetic": synthetic,
        "provenance": {
            "lmeUsdPerTon": lme_provenance,
            "idxCarbonIdrPerTon": carbon_provenance,
        },
    }
