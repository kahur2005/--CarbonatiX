/** Calendar production periods for twin monthly logs (`YYYY-MM`). */

export const EARLIEST_PERIOD = "2025-01";

const MONTH_LABELS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

export function currentPeriod(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function parsePeriod(
  yyyyMm: string,
): { year: number; month: number } | null {
  const m = PERIOD_RE.exec(yyyyMm);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function comparePeriods(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Inclusive list from Januari 2025 through the current calendar month. */
export function listPeriods(now: Date = new Date()): string[] {
  const end = currentPeriod(now);
  const periods: string[] = [];
  let y = 2025;
  let m = 1;
  for (;;) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (comparePeriods(p, end) > 0) break;
    periods.push(p);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return periods;
}

export function formatPeriodLabel(yyyyMm: string): string {
  const parsed = parsePeriod(yyyyMm);
  if (!parsed) return yyyyMm;
  return `${MONTH_LABELS_ID[parsed.month - 1]} ${parsed.year}`;
}

export function isPeriodInRange(
  yyyyMm: string,
  now: Date = new Date(),
): boolean {
  if (!parsePeriod(yyyyMm)) return false;
  return (
    comparePeriods(yyyyMm, EARLIEST_PERIOD) >= 0 &&
    comparePeriods(yyyyMm, currentPeriod(now)) <= 0
  );
}
