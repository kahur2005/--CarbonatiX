"""Tests for the forecast service and /forecasts route.

The two committed artifacts (`nickel_lme_SYNTHETIC.pkl`,
`idx_carbon_SYNTHETIC.pkl`) are Prophet models trained on synthetic price
series -- see ml/DATA_PROVENANCE.md. Each carries a `carbonatix_provenance`
attribute recording that. These tests check both the ordinary forecast shape
and that the synthetic label survives all the way to the API response, since
a chart built from an unlabelled forecast would present fabricated prices as
real market data.
"""

import pickle

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.forecasting import service
from app.main import app

client = TestClient(app)


class _FakeModel:
    """A Prophet-shaped stand-in with no `carbonatix_provenance` attribute.

    Used to exercise the "artifact carries no provenance metadata" path
    without touching the committed artifacts.
    """

    def make_future_dataframe(self, periods: int) -> pd.DataFrame:
        return pd.DataFrame({"ds": pd.date_range("2026-01-01", periods=periods)})

    def predict(self, future: pd.DataFrame) -> pd.DataFrame:
        n = len(future)
        return pd.DataFrame(
            {
                "yhat": [1.0] * n,
                "yhat_lower": [0.5] * n,
                "yhat_upper": [1.5] * n,
            }
        )


@pytest.fixture(autouse=True)
def _clear_model_cache():
    """Every test either loads the real artifacts or points _ARTIFACT_DIR
    elsewhere; without this, a model loaded under one test's monkeypatched
    directory would leak into the next test via the module-level cache."""
    service._models.clear()
    yield
    service._models.clear()


@pytest.mark.asyncio
async def test_forecast_returns_both_series_with_bands():
    f = await service.current_forecast(horizon_days=7)
    for key in ("lmeUsdPerTon", "idxCarbonIdrPerTon", "dates"):
        assert key in f
    assert len(f["lmeUsdPerTon"]) == 7
    assert len(f["idxCarbonIdrPerTon"]) == 7
    for lo, mid, hi in zip(
        f["idxCarbonIdrPerTonLower"],
        f["idxCarbonIdrPerTon"],
        f["idxCarbonIdrPerTonUpper"],
    ):
        assert lo <= mid <= hi


@pytest.mark.asyncio
async def test_currency_suffixes_are_never_bare():
    """No response object may carry a USD and an IDR value under an
    unsuffixed name. dates/stale/synthetic/provenance are plainly
    non-monetary, so they're exempt."""
    f = await service.current_forecast(horizon_days=3)
    for key in f:
        if key in ("dates", "stale", "synthetic", "provenance"):
            continue
        assert "Usd" in key or "Idr" in key, f"{key} lacks a currency suffix"


@pytest.mark.asyncio
async def test_missing_artifact_raises_rather_than_inventing(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "_ARTIFACT_DIR", tmp_path)
    with pytest.raises(service.ForecastUnavailable):
        await service.current_forecast()


@pytest.mark.asyncio
async def test_response_flags_synthetic_data_at_top_level():
    """Both committed artifacts are synthetic, so the response must say so
    unambiguously -- a consumer must not have to dig into a nested dict."""
    f = await service.current_forecast(horizon_days=3)
    assert f["synthetic"] is True
    assert f["provenance"]["lmeUsdPerTon"]["synthetic"] is True
    assert f["provenance"]["idxCarbonIdrPerTon"]["synthetic"] is True


@pytest.mark.asyncio
async def test_missing_provenance_is_treated_as_synthetic_not_verified_real(monkeypatch, tmp_path):
    """An artifact with no carbonatix_provenance attribute at all must not
    be silently treated as real: unlabelled is not the same as verified."""
    for name in ("nickel_lme_SYNTHETIC", "idx_carbon_SYNTHETIC"):
        (tmp_path / f"{name}.pkl").write_bytes(pickle.dumps(_FakeModel()))
    monkeypatch.setattr(service, "_ARTIFACT_DIR", tmp_path)

    f = await service.current_forecast(horizon_days=2)
    assert f["synthetic"] is True
    assert f["provenance"]["lmeUsdPerTon"]["synthetic"] is True
    assert f["provenance"]["idxCarbonIdrPerTon"]["synthetic"] is True


def test_forecasts_route_returns_200_with_synthetic_flag():
    r = client.get("/forecasts?horizon_days=5")
    assert r.status_code == 200
    body = r.json()
    assert len(body["lmeUsdPerTon"]) == 5
    assert body["synthetic"] is True


def test_forecasts_route_returns_503_on_forecast_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "_ARTIFACT_DIR", tmp_path)
    r = client.get("/forecasts")
    assert r.status_code == 503
