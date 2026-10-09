import type { BarInfo, Instrument } from '../chart/types';
import type { IndicatorState } from '../features/analysis/model';
import { averageLabel } from '../features/analysis/sources';
import { formatOscillator, type BollingerValues, type DonchianValues, type OscillatorValues } from '../features/analysis/values';
import { formatTime } from '../chart/render';
import { formatPrice, formatVolume } from '../chart/format';
import { getLocale, t } from './i18n';

export function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/** Keep chart readouts stable during viewport-only updates. */
export function createChartReadout(ohlc: HTMLElement, time: HTMLElement, tooltip: HTMLElement, getInstrument: () => Instrument) {
  let selectionKey = '', tooltipKey = '', tooltipLayoutKey = '';
  let tooltipHeight = 112;
  return {
    reset() { selectionKey = tooltipKey = tooltipLayoutKey = ''; },
    update(selected: BarInfo | null, indicators: IndicatorState, partial: boolean,
      point: { x: number; y: number } | null, width: number, height: number,
      oscillators: OscillatorValues | null = null, averages: number[] = [], bollinger: BollingerValues | null = null,
      donchian: DonchianValues | null = null) {
      const instrument = getInstrument();
      const key = `${getLocale()}:${instrument.symbol}:${instrument.priceScale}:${instrument.volumeScale}:${selected ? [selected.time, selected.open, selected.high, selected.low, selected.close].join(':') : 'none'}`;
      if (selectionKey !== key) {
        selectionKey = key;
        ohlc.innerHTML = (['open', 'high', 'low', 'close'] as const)
          .map(field => `<span>${t(`${field}Short`)} <b>${selected ? formatPrice(selected[field], instrument.priceScale) : '—'}</b></span>`).join('');
        ohlc.dataset.direction = selected && selected.close < selected.open ? 'down' : 'up';
        setText(time, selected ? formatTime(selected.time) : t('noCandle'));
      }
      tooltip.hidden = !selected || !point;
      if (!selected || !point) return;
      const extraKey = indicators.averages.map(item => `${item.id}:${item.kind}:${item.period}:${item.source}:${averages[Number(item.id.slice(8)) - 1]}`).join(':')
        + `:${indicators.bb.enabled}:${indicators.bb.period}:${indicators.bb.multiplier}:${bollinger ? Object.values(bollinger).join(':') : ''}`
        + `:${indicators.dc.enabled}:${indicators.dc.period}:${donchian ? Object.values(donchian).join(':') : ''}`;
      const averageLabels = [averageLabel('ma', indicators.ma, getLocale()), averageLabel('ema', indicators.ema, getLocale()),
        ...indicators.averages.map(item => averageLabel(item.kind, item, getLocale(), item.id))];
      const detail = `${key}:${averageLabels.join(':')}:${selected.volume}:${selected.ma}:${selected.ema}:${partial}:${indicators.ma.enabled}:${indicators.ma.period}:${indicators.ema.enabled}:${indicators.ema.period}:${indicators.volume.enabled}:${indicators.rsi.enabled}:${indicators.rsi.period}:${indicators.macd.enabled}:${indicators.macd.fastPeriod}:${indicators.macd.slowPeriod}:${indicators.macd.signalPeriod}:${oscillators ? Object.values(oscillators).join(':') : ''}:${extraKey}`;
      if (tooltipKey !== detail) {
        tooltipKey = detail;
        const value = (number: number) => Number.isFinite(number) ? formatPrice(number, instrument.priceScale) : t('warmingUp');
        const oscillator = (number: number | undefined, pane: number) => number !== undefined && Number.isFinite(number)
          ? formatOscillator(number, pane, instrument.priceScale) : t('warmingUp');
        const rsi = indicators.rsi.enabled ? `<br>RSI ${indicators.rsi.period} &nbsp; ${oscillator(oscillators?.rsi, 2)}` : '';
        const macd = indicators.macd.enabled ? `<br>MACD &nbsp; ${oscillator(oscillators?.macd, 3)}<br>${getLocale() === 'zh-CN' ? '信号' : 'Signal'} &nbsp; ${oscillator(oscillators?.signal, 3)}<br>${getLocale() === 'zh-CN' ? '直方图' : 'Histogram'} &nbsp; ${oscillator(oscillators?.histogram, 3)}` : '';
        const extra = indicators.averages.map((item, index) => `<br>${averageLabels[index + 2]} &nbsp; ${value(averages[Number(item.id.slice(8)) - 1])}`).join('');
        const bandLabels = getLocale() === 'zh-CN' ? ['中轨', '上轨', '下轨'] : ['Basis', 'Upper', 'Lower'];
        const bands = indicators.bb.enabled ? (['basis', 'upper', 'lower'] as const)
          .map((field, index) => `<br>BB ${bandLabels[index]} &nbsp; ${value(bollinger?.[field] ?? NaN)}`).join('') : '';
        const dcLabels = getLocale() === 'zh-CN' ? ['中轨', '上轨', '下轨'] : ['Middle', 'Upper', 'Lower'];
        const channel = indicators.dc.enabled ? (['middle', 'upper', 'lower'] as const)
          .map((field, index) => `<br>DC ${dcLabels[index]} &nbsp; ${value(donchian?.[field] ?? NaN)}`).join('') : '';
        tooltip.innerHTML = `<strong>${formatTime(selected.time)}</strong>${indicators.volume.enabled ? `<br>${t('volume')} &nbsp; ${formatVolume(selected.volume, instrument.volumeScale)}` : ''}${indicators.ma.enabled ? `<br>${averageLabels[0]} &nbsp; ${value(selected.ma)}` : ''}${indicators.ema.enabled ? `<br>${averageLabels[1]} &nbsp; ${value(selected.ema)}` : ''}${extra}${bands}${channel}${rsi}${macd}<br>${t(partial ? 'partialCandle' : 'completeCandle')}`;
        const layoutKey = `${getLocale()}:${averageLabels.join(':')}:${indicators.volume.enabled}:${indicators.ma.enabled}:${indicators.ema.enabled}:${indicators.rsi.enabled}:${indicators.macd.enabled}:${indicators.averages.length}:${indicators.bb.enabled}:${indicators.dc.enabled}`;
        if (layoutKey !== tooltipLayoutKey) {
          tooltipLayoutKey = layoutKey;
          tooltipHeight = tooltip.offsetHeight;
        }
      }
      tooltip.style.left = `${Math.max(8, Math.min(width - 236, point.x + 17))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(height - tooltipHeight - 8, point.y + 17))}px`;
    },
  };
}
