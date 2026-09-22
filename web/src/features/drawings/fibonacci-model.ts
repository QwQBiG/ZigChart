import { validFibonacciGeometry, type FibonacciGeometryOptions } from '../../chart/fibonacci.ts';

export interface FibonacciStyle extends FibonacciGeometryOptions {
  levels: { ratio: number; enabled: boolean; color: string }[];
  labels: boolean;
  prices: boolean;
  fillOpacity: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export function createFibonacciStyle(): FibonacciStyle {
  const colors = ['#999999', '#ef5350', '#66bb6a', '#26a69a', '#42a5f5', '#ab47bc', '#999999'];
  return { extendLeft: false, extendRight: false, reverse: false, logarithmic: false, trend: true,
    labels: true, prices: true, fillOpacity: .08, lineStyle: 'solid',
    levels: [0, .236, .382, .5, .618, .786, 1].map((ratio, i) => ({ ratio, enabled: true, color: colors[i] })),
  };
}

export function validFibonacciStyle(value: unknown): value is FibonacciStyle {
  if (!validFibonacciGeometry(value)) return false;
  const config = value as FibonacciStyle;
  return typeof config.labels === 'boolean' && typeof config.prices === 'boolean' &&
    Number.isFinite(config.fillOpacity) && config.fillOpacity >= 0 && config.fillOpacity <= .6 &&
    ['solid', 'dashed', 'dotted'].includes(config.lineStyle) &&
    config.levels.every(level => typeof level.color === 'string' && /^#[0-9a-f]{6}$/i.test(level.color));
}
