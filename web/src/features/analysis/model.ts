export const INDICATOR_IDS = ['ma', 'ema', 'bb', 'volume', 'rsi', 'macd'] as const;
export type IndicatorId = typeof INDICATOR_IDS[number];
export const EXTRA_AVERAGE_IDS = ['average-1', 'average-2', 'average-3', 'average-4', 'average-5', 'average-6'] as const;
export type ExtraAverageId = typeof EXTRA_AVERAGE_IDS[number];
export type StudyId = IndicatorId | ExtraAverageId;
export interface AverageInstance extends AverageSettings { id: ExtraAverageId; kind: 'ma' | 'ema' }

export interface AverageSettings {
  enabled: boolean;
  period: number;
  color: string;
  width: number;
}

export interface VolumeSettings {
  enabled: boolean;
  upColor: string;
  downColor: string;
  opacity: number;
}

export interface RSISettings extends AverageSettings {
  upper: number;
  lower: number;
  showLevels: boolean;
}

export interface MACDSettings {
  enabled: boolean;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  lineColor: string;
  signalColor: string;
  positiveColor: string;
  negativeColor: string;
  width: number;
}

export interface BollingerSettings {
  enabled: boolean;
  period: number;
  multiplier: number;
  basisColor: string;
  upperColor: string;
  lowerColor: string;
  fillColor: string;
  fillOpacity: number;
  showFill: boolean;
  width: number;
}

export interface IndicatorState {
  version: 4;
  averages: AverageInstance[];
  ma: AverageSettings;
  ema: AverageSettings;
  bb: BollingerSettings;
  volume: VolumeSettings;
  rsi: RSISettings;
  macd: MACDSettings;
}

export function createIndicatorState(): IndicatorState {
  return {
    version: 4, averages: [],
    ma: { enabled: false, period: 20, color: '#e7b35f', width: 2 },
    ema: { enabled: false, period: 20, color: '#a397ed', width: 2 },
    bb: { enabled: false, period: 20, multiplier: 2, basisColor: '#e7b35f', upperColor: '#4f8cff',
      lowerColor: '#4f8cff', fillColor: '#4f8cff', fillOpacity: .12, showFill: true, width: 1 },
    volume: { enabled: false, upColor: '#26a69a', downColor: '#ef5350', opacity: .6 },
    rsi: { enabled: false, period: 14, color: '#b39ddb', width: 2, upper: 70, lower: 30, showLevels: true },
    macd: { enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, lineColor: '#4f8cff',
      signalColor: '#ffb74d', positiveColor: '#26a69a', negativeColor: '#ef5350', width: 2 },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function color(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function average(value: unknown): AverageSettings | null {
  if (!record(value) || typeof value.enabled !== 'boolean' || !color(value.color)
    || typeof value.period !== 'number' || !Number.isInteger(value.period) || value.period < 1 || value.period > 500
    || typeof value.width !== 'number' || !Number.isInteger(value.width) || value.width < 1 || value.width > 4) return null;
  return { enabled: value.enabled, period: value.period, color: value.color.toLowerCase(), width: value.width };
}

function rsiSettings(value: unknown): RSISettings | null {
  const base = average(value);
  if (!base || !record(value) || typeof value.showLevels !== 'boolean' || typeof value.lower !== 'number'
    || typeof value.upper !== 'number' || !Number.isFinite(value.lower) || !Number.isFinite(value.upper)
    || value.lower < 0 || value.upper > 100 || value.lower >= value.upper) return null;
  return { ...base, lower: value.lower, upper: value.upper, showLevels: value.showLevels };
}

function macdSettings(value: unknown): MACDSettings | null {
  if (!record(value) || typeof value.enabled !== 'boolean') return null;
  for (const key of ['fastPeriod', 'slowPeriod', 'signalPeriod'] as const) {
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || value[key] < 1 || value[key] > 500) return null;
  }
  for (const key of ['lineColor', 'signalColor', 'positiveColor', 'negativeColor'] as const) if (!color(value[key])) return null;
  if ((value.fastPeriod as number) >= (value.slowPeriod as number) || typeof value.width !== 'number'
    || !Number.isInteger(value.width) || value.width < 1 || value.width > 4) return null;
  return { enabled: value.enabled, fastPeriod: value.fastPeriod as number, slowPeriod: value.slowPeriod as number,
    signalPeriod: value.signalPeriod as number, width: value.width, lineColor: (value.lineColor as string).toLowerCase(),
    signalColor: (value.signalColor as string).toLowerCase(), positiveColor: (value.positiveColor as string).toLowerCase(),
    negativeColor: (value.negativeColor as string).toLowerCase() };
}

function bollingerSettings(value: unknown): BollingerSettings | null {
  if (!record(value) || typeof value.enabled !== 'boolean' || typeof value.showFill !== 'boolean'
    || typeof value.period !== 'number' || !Number.isInteger(value.period) || value.period < 1 || value.period > 500
    || typeof value.multiplier !== 'number' || !Number.isFinite(value.multiplier) || value.multiplier < .1 || value.multiplier > 10
    || typeof value.fillOpacity !== 'number' || !Number.isFinite(value.fillOpacity) || value.fillOpacity < 0 || value.fillOpacity > 1
    || typeof value.width !== 'number' || !Number.isInteger(value.width) || value.width < 1 || value.width > 4) return null;
  for (const key of ['basisColor', 'upperColor', 'lowerColor', 'fillColor'] as const) if (!color(value[key])) return null;
  return { enabled: value.enabled, period: value.period, multiplier: value.multiplier, width: value.width,
    showFill: value.showFill, fillOpacity: value.fillOpacity, basisColor: (value.basisColor as string).toLowerCase(),
    upperColor: (value.upperColor as string).toLowerCase(), lowerColor: (value.lowerColor as string).toLowerCase(),
    fillColor: (value.fillColor as string).toLowerCase() };
}

/** Validate the whole preference document before applying any indicator settings. */
export function parseIndicatorState(value: unknown): IndicatorState | null {
  if (!record(value) || ![1, 2, 3, 4].includes(value.version as number)) return null;
  const ma = average(value.ma);
  const ema = average(value.ema);
  const volume = value.volume;
  if (!ma || !ema || !record(volume) || typeof volume.enabled !== 'boolean'
    || !color(volume.upColor) || !color(volume.downColor) || typeof volume.opacity !== 'number'
    || !Number.isFinite(volume.opacity) || volume.opacity < .1 || volume.opacity > 1) return null;
  const defaults = createIndicatorState();
  const rsi = value.version === 1 ? defaults.rsi : rsiSettings(value.rsi);
  const macd = value.version === 1 ? defaults.macd : macdSettings(value.macd);
  const bb = value.version === 4 ? bollingerSettings(value.bb) : defaults.bb;
  if (!rsi || !macd || !bb) return null;
  const averages: AverageInstance[] = [];
  if (value.version === 3 || value.version === 4) {
    if (!Array.isArray(value.averages) || value.averages.length > EXTRA_AVERAGE_IDS.length) return null;
    for (const entry of value.averages) {
      const settings = average(entry);
      if (!settings || !settings.enabled || !record(entry) || !EXTRA_AVERAGE_IDS.includes(entry.id as ExtraAverageId)
        || (entry.kind !== 'ma' && entry.kind !== 'ema') || averages.some(item => item.id === entry.id)) return null;
      averages.push({ ...settings, id: entry.id as ExtraAverageId, kind: entry.kind });
    }
  }
  return {
    version: 4, averages, ma, ema, bb, rsi, macd,
    volume: { enabled: volume.enabled, upColor: volume.upColor.toLowerCase(), downColor: volume.downColor.toLowerCase(), opacity: volume.opacity },
  };
}

/** Original studies retain settings on removal; additional instances are deleted. */
export function setIndicatorEnabled(state: IndicatorState, id: StudyId, enabled: boolean): IndicatorState {
  return {
    version: 4,
    averages: state.averages.filter(item => enabled || item.id !== id).map(item => ({ ...item })),
    ma: { ...state.ma, enabled: id === 'ma' ? enabled : state.ma.enabled },
    ema: { ...state.ema, enabled: id === 'ema' ? enabled : state.ema.enabled },
    bb: { ...state.bb, enabled: id === 'bb' ? enabled : state.bb.enabled },
    volume: { ...state.volume, enabled: id === 'volume' ? enabled : state.volume.enabled },
    rsi: { ...state.rsi, enabled: id === 'rsi' ? enabled : state.rsi.enabled },
    macd: { ...state.macd, enabled: id === 'macd' ? enabled : state.macd.enabled },
  };
}

export function isExtraAverage(id: StudyId): id is ExtraAverageId {
  return EXTRA_AVERAGE_IDS.includes(id as ExtraAverageId);
}

export function studyKind(state: IndicatorState, id: StudyId): IndicatorId {
  return isExtraAverage(id) ? state.averages.find(item => item.id === id)!.kind : id;
}

export function studySettings(state: IndicatorState, id: StudyId) {
  return isExtraAverage(id) ? state.averages.find(item => item.id === id)! : state[id];
}

/** Extra identities stay stable through edits and removal of other instances. */
export function addAverage(state: IndicatorState, kind: 'ma' | 'ema'): IndicatorState {
  if (!state[kind].enabled) return setIndicatorEnabled(state, kind, true);
  const id = EXTRA_AVERAGE_IDS.find(candidate => !state.averages.some(item => item.id === candidate));
  if (!id) return state;
  return { ...state, averages: [...state.averages, { ...state[kind], id, kind }] };
}

export function updateStudy(state: IndicatorState, id: StudyId, values: Record<string, unknown>): IndicatorState | null {
  if (isExtraAverage(id)) {
    if (!state.averages.some(item => item.id === id)) return null;
    return parseIndicatorState({ ...state, averages: state.averages.map(item => item.id === id ? { ...item, ...values } : item) });
  }
  return parseIndicatorState({ ...state, [id]: { ...state[id], ...values } });
}
