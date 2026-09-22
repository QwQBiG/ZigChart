import type { Locale } from '../../ui/i18n';
import type { IndicatorId, IndicatorState } from './model';
import { isExtraAverage, studyKind, studySettings, type StudyId, type AverageSettings } from './model.ts';

export type AnalysisCategory = 'indicators' | 'strategies' | 'scripts';
export type IndicatorGroup = 'trend' | 'volatility' | 'volume' | 'oscillators';
export type { IndicatorId } from './model';
export type LocalizedText = Record<Locale, string>;

export interface AnalysisEntry {
  id: IndicatorId;
  category: 'indicators';
  group: IndicatorGroup;
  placement: 'price' | 'pane';
  availability: 'toggle';
  title: LocalizedText;
  description: LocalizedText;
  keywords: string;
}

export const analysisCategories: readonly AnalysisCategory[] = ['indicators', 'strategies', 'scripts'];

export const analysisCatalog: readonly AnalysisEntry[] = [
  {
    id: 'ma', category: 'indicators', group: 'trend', placement: 'price', availability: 'toggle',
    title: { en: 'Moving average · MA', 'zh-CN': '移动平均线 · MA' },
    description: {
      en: 'Mean of closing prices over the selected period. Values begin after a full period.',
      'zh-CN': '所选周期内收盘价的平均值，满一个周期后开始显示。',
    },
    keywords: 'simple moving average sma trend 简单均线 趋势',
  },
  {
    id: 'ema', category: 'indicators', group: 'trend', placement: 'price', availability: 'toggle',
    title: { en: 'Exponential moving average · EMA', 'zh-CN': '指数移动平均线 · EMA' },
    description: {
      en: 'Weights recent closes more heavily, seeded with the first full-period mean.',
      'zh-CN': '对近期收盘价赋予更高权重，以首个完整周期的平均值初始化。',
    },
    keywords: 'exponential moving average trend 指数均线 趋势',
  },
  {
    id: 'bb', category: 'indicators', group: 'volatility', placement: 'price', availability: 'toggle',
    title: { en: 'Bollinger Bands · BB', 'zh-CN': '布林带 · BB' },
    description: {
      en: 'SMA of closing prices over N bars, with bands at SMA ± multiplier × population standard deviation over the same N bars. Values begin after N bars.',
      'zh-CN': '取 N 根 K 线收盘价的简单移动平均值，上下轨为均值 ± 倍数 × 同一 N 根的总体标准差；满 N 根后开始显示。',
    },
    keywords: 'bb boll bollinger volatility bands 波动率 布林 布林带',
  },
  {
    id: 'volume', category: 'indicators', group: 'volume', placement: 'pane', availability: 'toggle',
    title: { en: 'Volume', 'zh-CN': '成交量' },
    description: {
      en: 'A separate volume pane sharing the candle time scale, with its own colors and opacity.',
      'zh-CN': '与蜡烛主图共用时间轴的成交量副图，可独立设置颜色和不透明度。',
    },
    keywords: 'vol turnover 成交量 交易量',
  },
  {
    id: 'rsi', category: 'indicators', group: 'oscillators', placement: 'pane', availability: 'toggle',
    title: { en: 'Relative strength index · RSI', 'zh-CN': '相对强弱指数 · RSI' },
    description: {
      en: 'Wilder-smoothed relative strength on a 0–100 scale. Optional reference levels affect display only.',
      'zh-CN': '采用 Wilder 平滑的相对强弱指标，范围为 0–100；可选参考线仅影响显示。',
    },
    keywords: 'oscillator momentum overbought oversold 振荡 动量 超买 超卖 强弱',
  },
  {
    id: 'macd', category: 'indicators', group: 'oscillators', placement: 'pane', availability: 'toggle',
    title: { en: 'Moving average convergence divergence · MACD', 'zh-CN': '平滑异同移动平均线 · MACD' },
    description: {
      en: 'Fast EMA minus slow EMA, with its EMA signal and a histogram of the difference from that signal.',
      'zh-CN': '快 EMA 减慢 EMA，配有 EMA 信号线，以及主线与信号线之差的柱状图。',
    },
    keywords: 'oscillator momentum signal histogram 振荡 动量 信号 柱状图 异同',
  },
];

export function indicatorTitle(id: StudyId, state: IndicatorState, locale: Locale): string {
  const kind = studyKind(state, id);
  const title = analysisCatalog.find(entry => entry.id === kind)!.title[locale];
  if (kind === 'volume') return title;
  if (kind === 'bb') return `${title} ${state.bb.period} ${state.bb.multiplier}`;
  if (kind === 'macd') return `${title} ${state.macd.fastPeriod} ${state.macd.slowPeriod} ${state.macd.signalPeriod}`;
  return `${title} ${(studySettings(state, id) as AverageSettings).period}${isExtraAverage(id) ? ` · #${id.slice(8)}` : ''}`;
}

export function searchAnalysis(query: string): readonly AnalysisEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return analysisCatalog.filter(entry => {
    const text = `${entry.id} ${entry.title.en} ${entry.title['zh-CN']} ${entry.description.en} ${entry.description['zh-CN']} ${entry.keywords}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
