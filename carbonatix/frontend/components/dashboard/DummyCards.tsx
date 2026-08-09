"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MapPin } from "lucide-react";
import PriceLineChart from "@/components/dashboard/PriceLineChart";
import TimeframeToggle from "@/components/dashboard/TimeframeToggle";
import { Card, DummyBadge, Label, Mono } from "@/components/shell/primitives";
import { useTheme } from "@/components/shell/ThemeProvider";
import {
  formatIdrPerTon,
  formatUsdPerTon,
  STALE_FORECAST_BANNER,
  SYNTHETIC_PRICE_LABEL,
} from "@/lib/dashboard";
import {
  ensureLineRenderable,
  sliceByTimeframe,
  type ForecastTimeframe,
} from "@/lib/forecastTimeframe";

const IDX_PRICE = [
  { t: "09:00", price: 98000, vol: 120 },
  { t: "10:00", price: 99500, vol: 180 },
  { t: "11:00", price: 101200, vol: 90 },
  { t: "12:00", price: 100400, vol: 140 },
  { t: "13:00", price: 102800, vol: 210 },
  { t: "14:00", price: 101900, vol: 160 },
];

const ASK = [
  { price: 103500, vol: 40 },
  { price: 103200, vol: 55 },
  { price: 102800, vol: 30 },
];
const BID = [
  { price: 101900, vol: 45 },
  { price: 101500, vol: 70 },
  { price: 101000, vol: 35 },
];

const PEERS = [
  { label: "Peer A", value: 48, colorKey: "green" as const },
  { label: "Peer B", value: 58, colorKey: "amber" as const },
  { label: "Peer C", value: 62, colorKey: "red" as const },
  { label: "You", value: 52, colorKey: "cyan" as const },
];

export function GisMapCard() {
  const { colors: C } = useTheme();
  return (
    <Card className="flex flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <Label>GIS / Site Twin Preview</Label>
        <DummyBadge />
      </div>
      <div className="relative h-[160px] overflow-hidden rounded-md" style={{ background: C.mapBg }}>
        <Image
          src="/images/twin_preview.jpg"
          alt="Preview digital twin situs"
          fill
          className="object-cover opacity-80"
          sizes="450px"
        />
        <div className="absolute inset-0 flex items-end p-3">
          <Link
            href="/twin"
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-bold tracking-wider transition-opacity hover:opacity-90"
            style={{
              background: `${C.cyan}dd`,
              color: "#fff",
              fontFamily: "var(--font-mono), monospace",
            }}
          >
            <MapPin size={11} />
            Inspect 3D Site Twin
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function PeerMetersCard() {
  const { colors: C } = useTheme();
  const colorMap = { green: C.green, amber: C.amber, red: C.red, cyan: C.cyan };
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <Label>Peer intensity (tCO₂/tNi)</Label>
        <DummyBadge />
      </div>
      <div className="flex flex-col gap-2">
        {PEERS.map((p) => (
          <div key={p.label}>
            <div className="mb-0.5 flex justify-between text-[10px]" style={{ color: C.dimText }}>
              <span>{p.label}</span>
              <Mono>{p.value}</Mono>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.border }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${(p.value / 80) * 100}%`, background: colorMap[p.colorKey] }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export type IdxMarketStream = {
  dates: string[];
  values: number[];
  lower?: number[];
  upper?: number[];
  synthetic: boolean;
  provenanceWarning?: string;
  stale?: boolean;
};

export type LmeMarketStream = {
  dates: string[];
  values: number[];
  synthetic: boolean;
  provenanceWarning?: string;
  stale?: boolean;
};

/** Prefer the run snapshot series when present; otherwise fall back to the
 * hardcoded intraday mock so the empty dashboard still looks populated. */
function idxChartPoints(stream?: IdxMarketStream) {
  if (stream && stream.dates.length > 0 && stream.values.length > 0) {
    return stream.dates.map((date, i) => ({
      t: date.slice(0, 10),
      price: stream.values[i] ?? 0,
    }));
  }
  return IDX_PRICE.map(({ t, price }) => ({ t, price }));
}

function SyntheticBadge({ show }: { show: boolean }) {
  const { colors: C } = useTheme();
  if (!show) return null;
  return (
    <span
      data-testid="synthetic-badge"
      className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest"
      style={{
        background: `${C.amber}22`,
        color: C.amber,
        border: `1px solid ${C.amber}55`,
        fontFamily: "var(--font-mono), monospace",
      }}
    >
      {SYNTHETIC_PRICE_LABEL}
    </span>
  );
}

export function IdxMarketCard({ stream }: { stream?: IdxMarketStream }) {
  const { colors: C } = useTheme();
  const [tab, setTab] = useState("Lelang");
  const [timeframe, setTimeframe] = useState<ForecastTimeframe>("1m");
  const tabs = ["Lelang", "Reguler", "Negosiasi"];
  const usingSnapshot = Boolean(stream && stream.dates.length > 0 && stream.values.length > 0);
  const synthetic = stream?.synthetic ?? true;

  const data = useMemo(() => {
    const points = idxChartPoints(stream);
    return ensureLineRenderable(sliceByTimeframe(points, timeframe));
  }, [stream, timeframe]);

  return (
    <Card className="flex flex-col gap-3 p-3" glowColor={`${C.cyan}55`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Image src="/images/IDX_Carbon.png" alt="IDX Carbon" width={28} height={28} />
          <div>
            <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-display), sans-serif" }}>
              IDX Carbon Market
            </div>
            <Mono className="text-[10px]" style={{ color: C.dimText }}>
              {usingSnapshot
                ? "IDR/ton · snapshot run (bukan ticker live)"
                : "SPE-GRK · mock stream"}
            </Mono>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <SyntheticBadge show={synthetic} />
          <DummyBadge />
        </div>
      </div>

      {stream?.stale ? (
        <p className="text-[10px]" style={{ color: C.amber }}>
          {STALE_FORECAST_BANNER}
        </p>
      ) : null}
      {stream?.provenanceWarning ? (
        <p className="text-[10px]" style={{ color: C.muted }}>
          {stream.provenanceWarning}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{
                background: tab === t ? `${C.cyan}22` : "transparent",
                border: `1px solid ${tab === t ? C.cyan : C.border}`,
                color: tab === t ? C.cyan : C.muted,
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      </div>

      <PriceLineChart data={data} formatValue={formatIdrPerTon} accent={C.cyan} />

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <Label>Ask</Label>
            <DummyBadge />
          </div>
          {ASK.map((o) => (
            <div key={o.price} className="flex justify-between" style={{ color: C.red }}>
              <Mono>{o.price.toLocaleString("id-ID")}</Mono>
              <Mono>{o.vol}</Mono>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <Label>Bid</Label>
            <DummyBadge />
          </div>
          {BID.map((o) => (
            <div key={o.price} className="flex justify-between" style={{ color: C.green }}>
              <Mono>{o.price.toLocaleString("id-ID")}</Mono>
              <Mono>{o.vol}</Mono>
            </div>
          ))}
        </div>
      </div>

    </Card>
  );
}

/** LME nickel snapshot — same card chrome / line chart as IDX Carbon. */
export function LmeMarketCard({ stream }: { stream: LmeMarketStream }) {
  const { colors: C } = useTheme();
  const [timeframe, setTimeframe] = useState<ForecastTimeframe>("1m");

  const data = useMemo(() => {
    const points = stream.dates.map((date, i) => ({
      t: date.slice(0, 10),
      price: stream.values[i] ?? 0,
    }));
    return ensureLineRenderable(sliceByTimeframe(points, timeframe));
  }, [stream.dates, stream.values, timeframe]);

  return (
    <Card className="flex flex-col gap-3 p-3" glowColor={`${C.amber}55`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded"
            style={{
              background: `linear-gradient(135deg, ${C.amber}, ${C.cyan})`,
              fontFamily: "var(--font-display), sans-serif",
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
            }}
            aria-hidden
          >
            Ni
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-display), sans-serif" }}>
              LME Nikel
            </div>
            <Mono className="text-[10px]" style={{ color: C.dimText }}>
              USD/ton · snapshot run (bukan ticker live)
            </Mono>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <SyntheticBadge show={stream.synthetic} />
        </div>
      </div>

      {stream.stale ? (
        <p className="text-[10px]" style={{ color: C.amber }}>
          {STALE_FORECAST_BANNER}
        </p>
      ) : null}
      {stream.provenanceWarning ? (
        <p className="text-[10px]" style={{ color: C.muted }}>
          {stream.provenanceWarning}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Mono className="text-[10px]" style={{ color: C.dimText }}>
          Proyeksi harga (snapshot perhitungan)
        </Mono>
        <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      </div>

      <PriceLineChart data={data} formatValue={formatUsdPerTon} accent={C.amber} />
    </Card>
  );
}

export function WhatIfCard() {
  const { colors: C } = useTheme();
  const [bio, setBio] = useState(12);
  const [eff, setEff] = useState(55);
  const [toggle, setToggle] = useState(false);

  return (
    <Card className="flex flex-col gap-3 p-3" glowColor={`${C.violet}55`}>
      <div className="flex items-center justify-between">
        <Label>AI What-If Simulator</Label>
        <DummyBadge />
      </div>
      <p className="text-[11px]" style={{ color: C.dimText }}>
        Slider tidak menghitung ulang emisi — tampilan demo saja. Gunakan Digital Twin untuk
        pratinjau nyata.
      </p>

      <label className="flex flex-col gap-1 text-[11px]" style={{ color: C.text }}>
        Biocoke blend ({bio}%)
        <input
          type="range"
          min={0}
          max={40}
          value={bio}
          onChange={(e) => setBio(Number(e.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px]" style={{ color: C.text }}>
        Dryer efficiency ({eff}%)
        <input
          type="range"
          min={40}
          max={80}
          value={eff}
          onChange={(e) => setEff(Number(e.target.value))}
        />
      </label>
      <label className="flex items-center gap-2 text-[11px]" style={{ color: C.text }}>
        <input type="checkbox" checked={toggle} onChange={(e) => setToggle(e.target.checked)} />
        Paksa bio-coke 100% (dummy)
      </label>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Δ Emisi", value: "−4.2%" },
          { label: "Δ Biaya", value: "+Rp 180jt" },
          { label: "Δ Intensitas", value: "−2.1" },
          { label: "Cap headroom", value: "+3.1kt" },
        ].map((cell) => (
          <div
            key={cell.label}
            className="rounded-md p-2"
            style={{ background: C.panel, border: `1px solid ${C.border}` }}
          >
            <Label>{cell.label}</Label>
            <Mono className="mt-0.5 block text-sm" style={{ color: C.cyan }}>
              {cell.value}
            </Mono>
          </div>
        ))}
      </div>

      <div
        className="rounded-md p-2 text-[11px] leading-relaxed"
        style={{ background: `${C.violet}12`, border: `1px solid ${C.violet}33`, color: C.dimText }}
      >
        Insight (dummy): menaikkan biocoke ke {bio}% dan efisiensi dryer {eff}% digambarkan
        mengurangi emisi ~4%, tanpa perhitungan engine.
      </div>

      <button
        type="button"
        disabled
        className="rounded-md py-2 text-[10px] font-bold tracking-wider opacity-60"
        style={{
          background: `linear-gradient(135deg, ${C.violet}, ${C.cyan})`,
          color: "#fff",
          fontFamily: "var(--font-mono), monospace",
        }}
      >
        EXECUTE STRATEGY (DUMMY)
      </button>
    </Card>
  );
}

export function ProductionSummaryCard({
  nickelTons,
  totalEmissions,
}: {
  nickelTons?: number;
  totalEmissions?: number;
}) {
  const { colors: C } = useTheme();
  return (
    <Card className="p-3">
      <Label>Production / Interval</Label>
      <div
        className="mt-1 text-2xl font-bold"
        style={{ fontFamily: "var(--font-display), sans-serif", color: C.text }}
      >
        <Mono>
          {nickelTons != null
            ? `${nickelTons.toLocaleString("id-ID", { maximumFractionDigits: 1 })} t Ni`
            : "--"}
        </Mono>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: C.dimText }}>
        Total emisi interval:{" "}
        <Mono style={{ color: C.cyan }}>
          {totalEmissions != null
            ? `${totalEmissions.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO₂e`
            : "--"}
        </Mono>
      </p>
    </Card>
  );
}

export function ScopeAreaCard({
  scope1,
  scope2,
}: {
  scope1?: number;
  scope2?: number;
}) {
  const { colors: C } = useTheme();
  const data =
    scope1 != null && scope2 != null
      ? [{ month: "Interval", scope1, scope2 }]
      : [
          { month: "Jan", scope1: 40, scope2: 28 },
          { month: "Feb", scope1: 42, scope2: 30 },
          { month: "Mar", scope1: 38, scope2: 32 },
        ];
  const dummy = scope1 == null;

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <Label>Scope 1 / Scope 2</Label>
        {dummy ? <DummyBadge /> : null}
      </div>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 9 }} />
            <YAxis tick={{ fill: C.muted, fontSize: 9 }} width={40} />
            <Tooltip
              contentStyle={{
                background: C.card,
                border: `1px solid ${C.border}`,
                fontSize: 11,
              }}
            />
            <Area type="monotone" dataKey="scope1" stackId="1" stroke={C.amber} fill={`${C.amber}55`} />
            <Area type="monotone" dataKey="scope2" stackId="1" stroke={C.cyan} fill={`${C.cyan}44`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
