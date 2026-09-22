import type { Measurement } from '../../chart/bridge';
import type { Frame, Instrument } from '../../chart/types';
import { formatPrice, formatVolume } from '../../chart/format.ts';
import { getLocale } from '../../ui/i18n.ts';

const messages = {
  en: {
    title: 'Price and time range', choose: 'Click or drag between two prices. Esc cancels.',
    measuring: 'Click the endpoint to finish. Esc cancels.', finished: 'Esc or another chart action clears the ruler.',
    price: 'Price change', bars: 'Bar distance', elapsed: 'Elapsed', volume: 'Volume',
    included: 'bars, both endpoints included', unavailable: 'Unavailable',
    days: 'd', hours: 'h', minutes: 'min', seconds: 's', milliseconds: 'ms',
  },
  'zh-CN': {
    title: '价格与时间区间', choose: '点击两处价格或拖动测量。Esc 取消。',
    measuring: '点击终点完成测量。Esc 取消。', finished: 'Esc 或其他图表操作清除测量尺。',
    price: '价格变化', bars: 'K 线间距', elapsed: '经过时间', volume: '成交量',
    included: '根，含两端 K 线', unavailable: '不可用',
    days: '天', hours: '小时', minutes: '分钟', seconds: '秒', milliseconds: '毫秒',
  },
};
const percentFormats = {
  en: new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  'zh-CN': new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
function sign(value: number): string { return value > 0 ? '+' : value < 0 ? '−' : ''; }
function duration(value: number): string {
  const text = messages[getLocale()];
  let remaining = Math.abs(value);
  const parts: string[] = [];
  for (const [unit, label] of [[86_400_000, text.days], [3_600_000, text.hours], [60_000, text.minutes],
    [1_000, text.seconds], [1, text.milliseconds]] as const) {
    const count = Math.floor(remaining / unit); remaining %= unit;
    if (count) parts.push(`${count} ${label}`);
  }
  return `${sign(value)}${parts.join(' ') || `0 ${text.seconds}`}`;
}

/** Display raw price/volume units using instrument metadata; time is elapsed UTC duration. */
export function formatMeasurement(value: Measurement, instrument: Pick<Instrument, 'priceScale' | 'volumeScale'>): string[] {
  const text = messages[getLocale()];
  const price = `${value.priceChange > 0 ? '+' : ''}${formatPrice(value.priceChange, instrument.priceScale)}`;
  const percent = value.percentChange === null ? text.unavailable
    : `${sign(value.percentChange)}${percentFormats[getLocale()].format(Math.abs(value.percentChange))}%`;
  const volume = value.volume === null ? text.unavailable : formatVolume(value.volume, instrument.volumeScale, false);
  return [`${text.price}: ${price} (${percent})`,
    `${text.bars}: ${sign(value.barDistance)}${Math.abs(value.barDistance)} · ${text.elapsed}: ${duration(value.elapsedMs)}`,
    `${text.volume}: ${volume} (${value.barCount} ${text.included})`];
}

/** A pointer-transparent DOM readout keeps temporary measurement text accessible. */
export function createMeasureReadout(container: HTMLElement, getInstrument: () => Pick<Instrument, 'priceScale' | 'volumeScale'>) {
  const node = container.ownerDocument.createElement('div'); node.className = 'measure-readout'; node.hidden = true;
  node.setAttribute('role', 'status'); node.setAttribute('aria-atomic', 'true');
  const title = container.ownerDocument.createElement('strong');
  const lines = Array.from({ length: 3 }, () => container.ownerDocument.createElement('span'));
  const hint = container.ownerDocument.createElement('small'); node.append(title, ...lines, hint); container.append(node);
  function update(value: Measurement | null, state: { active: boolean; measuring: boolean }, frame: Frame | null): void {
    if (!frame) { node.hidden = true; return; }
    const text = messages[getLocale()], { meta } = frame;
    node.hidden = (!value && !state.active) || meta[4] <= meta[3] || meta[11] <= 16 || meta[12] <= 16;
    if (node.hidden) return;
    node.setAttribute('aria-live', state.measuring ? 'off' : 'polite');
    node.dataset.direction = value && value.priceChange < 0 ? 'negative' : 'positive';
    const content = value ? formatMeasurement(value, getInstrument()) : [];
    if (title.textContent !== text.title) title.textContent = text.title;
    lines.forEach((line, index) => { const next = content[index] ?? ''; line.hidden = !next; if (line.textContent !== next) line.textContent = next; });
    const nextHint = state.measuring ? text.measuring : state.active ? text.choose : text.finished;
    if (hint.textContent !== nextHint) hint.textContent = nextHint;
    const width = Math.min(310, meta[11] - 16);
    node.style.width = `${width}px`; node.style.maxHeight = `${meta[12] - 16}px`;
    node.style.left = `${Math.max(8, Math.min((value?.x2 ?? 0) + 12, meta[11] - width - 8))}px`;
    // The summary may cover auxiliary panes; a short price pane must not truncate statistics.
    node.style.top = `${meta[12] - 8}px`;
  }
  return { update, dispose() { node.remove(); } };
}
