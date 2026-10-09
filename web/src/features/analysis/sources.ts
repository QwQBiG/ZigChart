import type { IndicatorSource } from '../../chart/indicator-source';
import type { Locale } from '../../ui/i18n';

const labels: Record<Locale, Record<IndicatorSource, string>> = {
  en: { close: 'Close', open: 'Open', high: 'High', low: 'Low', hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4', hlcc4: 'HLCC4' },
  'zh-CN': { close: '收盘', open: '开盘', high: '最高', low: '最低', hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4', hlcc4: 'HLCC4' },
};
const formulas: Record<Locale, Partial<Record<IndicatorSource, string>>> = {
  en: { hl2: '(High + Low) / 2', hlc3: '(High + Low + Close) / 3',
    ohlc4: '(Open + High + Low + Close) / 4', hlcc4: '(High + Low + 2 × Close) / 4' },
  'zh-CN': { hl2: '(最高 + 最低) / 2', hlc3: '(最高 + 最低 + 收盘) / 3',
    ohlc4: '(开盘 + 最高 + 最低 + 收盘) / 4', hlcc4: '(最高 + 最低 + 2 × 收盘) / 4' },
};

export function sourceLabel(source: IndicatorSource, locale: Locale): string { return labels[locale][source]; }
export function sourceOptionLabel(source: IndicatorSource, locale: Locale): string {
  const formula = formulas[locale][source];
  return `${sourceLabel(source, locale)}${formula ? ` · ${formula}` : ''}`;
}
export function averageParameters(settings: { period: number; source: IndicatorSource }, locale: Locale, id?: string): string {
  return `${settings.period} · ${sourceLabel(settings.source, locale)}${id?.startsWith('average-') ? ` · #${id.slice(8)}` : ''}`;
}
export function averageLabel(kind: 'ma' | 'ema', settings: { period: number; source: IndicatorSource }, locale: Locale, id?: string): string {
  return `${kind.toUpperCase()} ${averageParameters(settings, locale, id)}`;
}
