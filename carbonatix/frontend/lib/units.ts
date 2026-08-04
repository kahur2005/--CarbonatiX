/**
 * The one and only place percentages become fractions.
 *
 * The API takes fractions in [0, 1]; the UI shows percentages because that is
 * what an operator reads off a report. Converting anywhere else risks sending
 * 32 where 0.32 is meant -- which the backend rejects, but only after the user
 * has filled in a form and pressed a button.
 */

export function toFraction(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new RangeError(`Expected a finite percentage, got ${percent}`);
  }
  if (percent < 0 || percent > 100) {
    throw new RangeError(`Percentage must be between 0 and 100, got ${percent}`);
  }
  return percent / 100;
}

export function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    throw new RangeError(`Expected a finite fraction, got ${fraction}`);
  }
  return fraction * 100;
}
