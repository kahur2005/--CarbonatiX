import json

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PAYLOAD = {
    "wetOreInputTons": 10000.0,
    "moistureContentPct": 0.32,
    "nickelGradePct": 0.018,
    "reductantBiocokePct": 0.0,
    "powerMixCaptiveCoal": 1.0,
    "powerMixHydroGrid": 0.0,
    "secEafKwhPerTAlloy": 2400.0,
    "efCaptivePltu": 1.0,
    "dryerThermalEfficiency": 0.55,
}


def test_emissions_returns_full_breakdown():
    r = client.post("/emissions", json=PAYLOAD)
    assert r.status_code == 200
    body = r.json()
    for key in (
        "totalEmissions",
        "scope1",
        "scope2",
        "dryerEmissions",
        "kilnHeatEmissions",
        "kilnReductantEmissions",
        "eafEmissions",
        "nickelOutputTons",
        "alloyOutputTons",
        "eafMwh",
        "intensityPerTonneNi",
    ):
        assert key in body, f"missing {key}"
    assert body["totalEmissions"] > 0


def test_intensity_is_null_not_zero_when_no_nickel():
    r = client.post("/emissions", json={**PAYLOAD, "nickelGradePct": 0.0})
    assert r.status_code == 200
    assert r.json()["intensityPerTonneNi"] is None


def test_power_mix_must_sum_to_one():
    r = client.post(
        "/emissions", json={**PAYLOAD, "powerMixCaptiveCoal": 0.6, "powerMixHydroGrid": 0.25}
    )
    assert r.status_code == 422
    assert "power mix" in r.text.lower()


def test_out_of_range_fraction_names_the_field():
    r = client.post("/emissions", json={**PAYLOAD, "moistureContentPct": 32.0})
    assert r.status_code == 422
    assert "moistureContentPct" in r.text or "moisture_content_pct" in r.text


def test_nan_is_rejected():
    body = json.dumps({**PAYLOAD, "moistureContentPct": float("nan")})
    assert "NaN" in body  # guard: json.dumps emits the bare NaN literal
    r = client.post("/emissions", content=body, headers={"content-type": "application/json"})
    assert r.status_code == 422
