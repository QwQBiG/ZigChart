import type { Frame } from './types';
import { periodOrdinal } from '../data/periods.ts';
import type { PeriodId } from '../data/periods';

const STRIDE = 17;
const MIN_SPACING = 100;
const EDGE_PADDING = 25;
const BAR_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];

export interface TimeTick {
  time: number;
  x: number;
}

/** Sample labels from actual bars; all numerical X coordinates come from the core. */
export function timeAxisTicks(frame: Frame, intervalMs: number | PeriodId): TimeTick[] {
  const { rows, meta } = frame;
  const span = meta[9];
  const width = meta[11];
  if ((typeof intervalMs === 'number' && (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)) ||
    !Number.isFinite(span) || span <= 0 || !Number.isFinite(width) || width <= EDGE_PADDING * 2 ||
    rows.length % STRIDE !== 0) return [];

  // Full viewport density is independent of panning and unfilled future space.
  const minimumBars = MIN_SPACING * span / width;
  const step = BAR_STEPS.find(value => value >= minimumBars) ??
    1440 * Math.ceil(minimumBars / 1440);
  if (!Number.isSafeInteger(step) || (typeof intervalMs === 'number' && !Number.isSafeInteger(step * intervalMs))) return [];

  const ticks: TimeTick[] = [];
  for (let offset = 0; offset < rows.length; offset += STRIDE) {
    const time = rows[offset + 1];
    const x = rows[offset + 9];
    if (!Number.isSafeInteger(time) || time < 0 || time > 8.64e15 ||
      !Number.isFinite(x) || x < EDGE_PADDING || x > width - EDGE_PADDING) continue;
    // UTC slots anchor the label phase even when history changes array indices.
    // Missing slots remain unlabeled; no timestamps or session bars are invented.
    const ordinal = typeof intervalMs === 'number' ? Math.floor(time / intervalMs) : periodOrdinal(time, intervalMs);
    if (ordinal % step === 0) ticks.push({ time, x });
  }
  return ticks;
}
