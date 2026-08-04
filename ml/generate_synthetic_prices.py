"""Generate SYNTHETIC daily price history for LME nickel and IDX Carbon.

*** THIS SCRIPT PRODUCES FABRICATED DATA. IT IS NOT REAL MARKET DATA. ***

Why synthetic
-------------
At build time (2026-08-04) this project had no reliable way to obtain a
clean, licensable daily series for LME nickel settlement prices or IDX
Carbon (https://www.idxcarbon.co.id) trade prices. Rather than leave the
forecasting pipeline untested, or worse, quietly fabricate a series and
present it as real, we generate a clearly-labelled placeholder here so the
two Prophet models (Task 10) and the serving path (Task 11) can be built
and demoed end to end. See ml/DATA_PROVENANCE.md for the full record of
what must change before this project's results can be presented as real.

Determinism
------------
Every random draw comes from a single ``numpy.random.default_rng(SEED)``
instance, consumed in a fixed order (nickel path, then carbon latent path,
then carbon print mask, then carbon observation noise). Re-running this
script performs the exact same sequence of draws and therefore writes a
byte-identical CSV every time, on the same numpy version. This matters:
anyone reviewing this project should be able to regenerate the artifact
and confirm it was not hand-tweaked.

Modelling choices
------------------
``lme_usd_per_ton`` (nickel):
    LME nickel is a liquid, actively-quoted market, so every weekday gets
    a print. The path is a discrete mean-reverting random walk (a crude
    Ornstein-Uhlenbeck): each step nudges the price a small fraction of
    the way back toward a long-run anchor (``NICKEL_MU``) and adds
    multiplicative Gaussian noise sized to roughly 1.5-2% of the current
    price, which is in the right ballpark for LME base-metal daily moves.
    The anchor and starting point sit in the USD 15,000-17,000/t range
    quoted in the project brief.

``idx_carbon_idr_per_ton`` (IDX Carbon):
    This is the column that matters most to get structurally right. IDX
    Carbon launched in September 2023 and trades thinly -- most days see
    no print at all. Modelling it as a smooth daily series (as the nickel
    column is) would misrepresent the market and would let Prophet fit
    apparent daily/weekly structure that is really just interpolation
    artefact. Instead we simulate a slower-moving *latent* fair-value
    random walk (mean-reverting, low daily volatility, since the "true"
    price of a young, low-volume credit doesn't swing much day to day),
    then reveal it on only a minority of weekdays (~15-25%, tuned via
    CARBON_PRINT_PROB) with a small idiosyncratic observation noise on
    top of the reveal (representing bid/ask spread and thin-book
    variance on the days a trade actually happens). All other days are
    left blank, exactly as they would be for a market with no trade to
    report. The anchor sits in the IDR 30,000-60,000/t range quoted in
    the project brief.

Both processes are floored well above zero and are checked for
positivity/finiteness before being written, so the output never contains
zero, negative, NaN-as-a-value, or inf entries -- gaps are represented as
genuinely empty CSV cells, not as sentinel numbers.

Weekends are omitted entirely: neither the LME nor the IDX Carbon
exchange settles trades on Saturdays or Sundays, so there is nothing to
represent for those calendar dates.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20260804
START = "2024-08-01"
END = "2026-08-01"
GENERATED_ON = "2026-08-04"

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "price_history_SYNTHETIC.csv"

# --- Nickel (LME): liquid market, daily prints on every weekday ---
NICKEL_START = 16000.0
NICKEL_MU = 16000.0
NICKEL_THETA = 0.02  # mean-reversion speed
NICKEL_SIGMA = 0.018  # ~1.8% daily relative volatility
NICKEL_FLOOR = 500.0

# --- IDX Carbon: thin market, sparse prints ---
CARBON_LATENT_START = 45000.0
CARBON_MU = 45000.0
CARBON_THETA = 0.03
CARBON_SIGMA = 0.012  # slow-moving latent fair value
CARBON_OBS_NOISE_SD = 0.05  # idiosyncratic noise on the days a trade prints
CARBON_PRINT_PROB = 0.20  # ~20% of weekdays get a print
CARBON_FLOOR = 1000.0

HEADER_COMMENT = f"""\
# SYNTHETIC DATA -- NOT REAL MARKET DATA.
# Generated on {GENERATED_ON} by ml/generate_synthetic_prices.py (seed={SEED}).
# This file is a fabricated placeholder for LME nickel and IDX Carbon daily
# prices. No real market series was obtainable at build time. It MUST be
# replaced with real data before any published result, demo, or
# presentation. See ml/DATA_PROVENANCE.md for what must change and where.
"""


def simulate_nickel(n: int, rng: np.random.Generator) -> np.ndarray:
    """Mean-reverting random walk for LME nickel, one step per weekday."""
    prices = np.empty(n, dtype=float)
    price = NICKEL_START
    for i in range(n):
        shock = rng.normal(0.0, NICKEL_SIGMA) * price
        reversion = NICKEL_THETA * (NICKEL_MU - price)
        price = max(price + reversion + shock, NICKEL_FLOOR)
        prices[i] = price
    return np.round(prices, 2)


def simulate_carbon(n: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Sparse observations of a slow-moving latent IDX Carbon fair value."""
    latent = np.empty(n, dtype=float)
    value = CARBON_LATENT_START
    for i in range(n):
        shock = rng.normal(0.0, CARBON_SIGMA) * value
        reversion = CARBON_THETA * (CARBON_MU - value)
        value = max(value + reversion + shock, CARBON_FLOOR)
        latent[i] = value

    printed = rng.random(n) < CARBON_PRINT_PROB
    obs_noise = rng.normal(0.0, CARBON_OBS_NOISE_SD, size=n)

    observed = np.full(n, np.nan)
    observed[printed] = np.clip(
        latent[printed] * (1.0 + obs_noise[printed]), CARBON_FLOOR, None
    )
    return np.round(observed, 2), printed


def main() -> None:
    print(
        "WARNING: generating SYNTHETIC price history. This is NOT real "
        "market data and must not be presented as such.",
        file=sys.stderr,
    )

    dates = pd.bdate_range(start=START, end=END)  # weekdays only
    n = len(dates)
    rng = np.random.default_rng(SEED)

    nickel = simulate_nickel(n, rng)
    carbon, printed = simulate_carbon(n, rng)

    assert np.isfinite(nickel).all() and (nickel > 0).all()
    assert np.isfinite(carbon[printed]).all() and (carbon[printed] > 0).all()

    df = pd.DataFrame(
        {
            "observed_on": dates.strftime("%Y-%m-%d"),
            "lme_usd_per_ton": nickel,
            "idx_carbon_idr_per_ton": carbon,
        }
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        f.write(HEADER_COMMENT)
        df.to_csv(f, index=False, float_format="%.2f")

    density = printed.mean()
    print(
        f"Wrote {OUT} : {n} weekdays "
        f"({dates.min().date()} to {dates.max().date()})\n"
        f"  lme_usd_per_ton      : {n} observations\n"
        f"  idx_carbon_idr_per_ton: {int(printed.sum())} observations "
        f"({density:.1%} of weekdays)"
    )


if __name__ == "__main__":
    main()
