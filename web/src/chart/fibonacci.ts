export const MAX_FIBONACCI_LEVELS = 24;
export interface FibonacciGeometryOptions {
  extendLeft: boolean;
  extendRight: boolean;
  reverse: boolean;
  logarithmic: boolean;
  trend: boolean;
  levels: { ratio: number; enabled: boolean }[];
}

export function validFibonacciGeometry(value: unknown): value is FibonacciGeometryOptions {
  if (!value || typeof value !== 'object') return false;
  const config = value as FibonacciGeometryOptions;
  return [config.extendLeft, config.extendRight, config.reverse, config.logarithmic, config.trend].every(flag => typeof flag === 'boolean') &&
    Array.isArray(config.levels) && config.levels.length >= 1 && config.levels.length <= MAX_FIBONACCI_LEVELS &&
    Array.from(config.levels).every(level => level && Number.isFinite(level.ratio) && Math.abs(level.ratio) <= 10 && typeof level.enabled === 'boolean');
}

export function encodeFibonacci(config: FibonacciGeometryOptions, output: Float64Array): void {
  output.fill(NaN);
  output[0] = Number(config.extendLeft) | Number(config.extendRight) << 1 | Number(config.reverse) << 2 |
    Number(config.logarithmic) << 3 | Number(config.trend) << 4;
  config.levels.forEach((level, index) => { if (level.enabled) output[index + 1] = level.ratio; });
}
