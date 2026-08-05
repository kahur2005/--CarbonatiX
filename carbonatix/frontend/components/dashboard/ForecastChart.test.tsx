import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ForecastChart from "./ForecastChart";
import { formatIdrPerTon, formatUsdPerTon, SYNTHETIC_PRICE_LABEL } from "@/lib/dashboard";

const DATES = ["2026-08-05", "2026-08-06", "2026-08-07"];
const LME_VALUES = [15000, 15100, 15200];
const LME_LOWER = [14500, 14600, 14700];
const LME_UPPER = [15500, 15600, 15700];
const CARBON_VALUES = [120000, 121000, 122000];
const CARBON_LOWER = [110000, 111000, 112000];
const CARBON_UPPER = [130000, 131000, 132000];

describe("ForecastChart", () => {
  it("shows the always-visible synthetic label when the series is synthetic", () => {
    render(
      <ForecastChart
        title="LME Nikel"
        unitLabel="USD/ton"
        dates={DATES}
        values={LME_VALUES}
        lower={LME_LOWER}
        upper={LME_UPPER}
        colorVar="--chart-series-1"
        formatValue={formatUsdPerTon}
        synthetic
      />,
    );
    expect(screen.getByTestId("synthetic-badge")).toBeInTheDocument();
    expect(screen.getByText(SYNTHETIC_PRICE_LABEL)).toBeInTheDocument();
  });

  it("omits the synthetic badge when the series is verified real", () => {
    render(
      <ForecastChart
        title="LME Nikel"
        unitLabel="USD/ton"
        dates={DATES}
        values={LME_VALUES}
        lower={LME_LOWER}
        upper={LME_UPPER}
        colorVar="--chart-series-1"
        formatValue={formatUsdPerTon}
        synthetic={false}
      />,
    );
    expect(screen.queryByTestId("synthetic-badge")).not.toBeInTheDocument();
  });

  it("keeps LME (USD/ton) and IDX Carbon (IDR/ton) on two separate charts, never one shared axis", () => {
    render(
      <>
        <ForecastChart
          title="LME Nikel"
          unitLabel="USD/ton"
          dates={DATES}
          values={LME_VALUES}
          lower={LME_LOWER}
          upper={LME_UPPER}
          colorVar="--chart-series-1"
          formatValue={formatUsdPerTon}
          synthetic
        />
        <ForecastChart
          title="IDX Carbon"
          unitLabel="IDR/ton"
          dates={DATES}
          values={CARBON_VALUES}
          lower={CARBON_LOWER}
          upper={CARBON_UPPER}
          colorVar="--chart-series-2"
          formatValue={formatIdrPerTon}
          synthetic
        />
      </>,
    );

    // Two independent <svg> plots -- not one chart carrying both currencies.
    const plots = screen.getAllByRole("img");
    expect(plots).toHaveLength(2);

    expect(screen.getByText(/USD\/ton/)).toBeInTheDocument();
    expect(screen.getByText(/IDR\/ton/)).toBeInTheDocument();
    // Never mix currencies inside one chart's own label.
    expect(screen.getByText("LME Nikel").closest("div")?.textContent).not.toMatch(/IDR/);
    expect(screen.getByText("IDX Carbon").closest("div")?.textContent).not.toMatch(/USD/);
  });

  it("shows a stale banner when the snapshot is marked stale", () => {
    render(
      <ForecastChart
        title="LME Nikel"
        unitLabel="USD/ton"
        dates={DATES}
        values={LME_VALUES}
        lower={LME_LOWER}
        upper={LME_UPPER}
        colorVar="--chart-series-1"
        formatValue={formatUsdPerTon}
        synthetic={false}
        stale
      />,
    );
    expect(screen.getByText(/Proyeksi harga tidak tersedia/)).toBeInTheDocument();
  });
});
