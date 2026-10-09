import type { Instrument } from '../../chart/types';
import type { IndicatorState } from '../analysis/model';
import type { InspectionSelection } from './types';
import { formatPrice, formatVolume } from '../../chart/format.ts';
import { averageValuesAt, bollingerValuesAt, donchianValuesAt, formatOscillator, oscillatorValuesAt } from '../analysis/values.ts';
import { averageLabel } from '../analysis/sources.ts';
import { getLocale, t } from '../../ui/i18n.ts';

const messages = {
  en: {
    button: 'Inspect', enter: 'Inspect loaded candles', exit: 'Exit candle inspection',
    label: 'Keyboard candle inspection', ready: 'Focus the chart and press I to inspect loaded candles.',
    waiting: 'Inspection is available after chart data loads.', off: 'Inspection ended. Focus the chart and press I to start again.',
    help: '←/→: candle · ↑/↓: pane · PgUp/PgDn: −10/+10 · Home/End: first/last loaded · Enter/Space: reread · Esc/I: exit · +/−: exit & zoom.',
    empty: 'No loaded candle selected.', pane: ['Price pane', 'Volume pane', 'RSI pane', 'MACD pane'],
    open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume',
    basis: 'Basis', middle: 'Middle', upper: 'Upper', lower: 'Lower', signal: 'Signal', histogram: 'Histogram',
    warming: 'Warming up', partial: 'Partial candle', complete: 'Complete candle',
  },
  'zh-CN': {
    button: '逐根查看', enter: '逐根查看已加载 K 线', exit: '退出逐根查看',
    label: '键盘逐根查看', ready: '图表获得焦点后，按 I 逐根查看已加载 K 线。',
    waiting: '图表数据加载后可逐根查看。', off: '已退出逐根查看。图表获得焦点后按 I 再次进入。',
    help: '←/→ 逐根 · ↑/↓ 图窗 · PgUp/PgDn −10/+10 · Home/End 首/末已加载 · Enter/空格 重读 · Esc/I 退出 · +/− 退出并缩放。',
    empty: '尚未选中已加载 K 线。', pane: ['价格主图', '成交量副图', 'RSI 副图', 'MACD 副图'],
    open: '开盘', high: '最高', low: '最低', close: '收盘', volume: '成交量',
    basis: '中轨', middle: '中轨', upper: '上轨', lower: '下轨', signal: '信号', histogram: '直方图',
    warming: '预热中', partial: '未完成 K 线', complete: '已完成 K 线',
  },
};
const timeFormats = {
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }),
  'zh-CN': new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }),
};

/** Describe the selected bar without calculating studies or borrowing Wasm memory. */
export function formatInspectionSummary(selection: InspectionSelection, instrument: Instrument, periodLabel: string,
  indicators: IndicatorState, partial: boolean): string {
  const { bar, frame, paneId } = selection, locale = getLocale(), text = messages[locale];
  const price = (value: number | undefined) => value !== undefined && Number.isFinite(value)
    ? formatPrice(value, instrument.priceScale) : text.warming;
  const fields = [instrument.symbol, periodLabel, text.pane[paneId], `${timeFormats[locale].format(bar.time)} UTC`,
    ...(['open', 'high', 'low', 'close'] as const).map(key => `${text[key]} ${price(bar[key])}`),
    `${text.volume} ${formatVolume(bar.volume, instrument.volumeScale, false)}`, partial ? text.partial : text.complete];
  if (paneId === 0) {
    const row = frame.rows.length ? bar.index - frame.rows[0] : -1, offset = row * 17;
    const aligned = Number.isInteger(row) && row >= 0 && frame.rows[offset] === bar.index && frame.rows[offset + 1] === bar.time;
    for (const [id, column] of [['ma', 7], ['ema', 8]] as const) {
      if (indicators[id].enabled) fields.push(`${averageLabel(id, indicators[id], locale)} ${price(aligned ? frame.rows[offset + column] : NaN)}`);
    }
    const averages = averageValuesAt(frame, bar.index);
    for (const study of indicators.averages) fields.push(`${averageLabel(study.kind, study, locale, study.id)} ${price(averages[Number(study.id.slice(8)) - 1])}`);
    if (indicators.bb.enabled) {
      const bands = bollingerValuesAt(frame, bar.index);
      for (const key of ['basis', 'upper', 'lower'] as const) fields.push(`BB ${text[key]} ${price(bands?.[key])}`);
    }
    if (indicators.dc.enabled) {
      const bands = donchianValuesAt(frame, bar.index);
      for (const key of ['middle', 'upper', 'lower'] as const) fields.push(`DC ${text[key]} ${price(bands?.[key])}`);
    }
  } else if (paneId === 2 || paneId === 3) {
    const values = oscillatorValuesAt(frame, bar.index);
    const value = (number: number | undefined) => number !== undefined && Number.isFinite(number)
      ? formatOscillator(number, paneId, instrument.priceScale) : text.warming;
    if (paneId === 2 && indicators.rsi.enabled) fields.push(`RSI ${indicators.rsi.period} ${value(values?.rsi)}`);
    if (paneId === 3 && indicators.macd.enabled) fields.push(`MACD ${value(values?.macd)}`,
      `${text.signal} ${value(values?.signal)}`, `${text.histogram} ${value(values?.histogram)}`);
  }
  return fields.join('; ');
}

interface InspectionPresentationOptions {
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  getInstrument(): Instrument;
  getPeriodLabel(): string;
  getIndicators(): IndicatorState;
  isReady(): boolean;
  isActive(): boolean;
  onToggle(): void;
}

/** One persistent live region coalesces changes while keyboard focus stays on the chart. */
export function createInspectionPresentation(options: InspectionPresentationOptions) {
  const { canvas, parent } = options, doc = parent.ownerDocument, view = doc.defaultView!;
  const events = new AbortController(), listener = { signal: events.signal };
  const group = doc.createElement('div'); group.className = 'inspection-controls';
  const button = doc.createElement('button'); button.id = 'chart-inspect'; button.type = 'button';
  const help = doc.createElement('span'); help.id = 'chart-inspection-help'; help.className = 'inspection-help';
  const live = doc.createElement('span'); live.className = 'inspection-announcement';
  live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  button.setAttribute('aria-describedby', help.id);
  group.append(button, help, live); parent.append(group);
  let selection: InspectionSelection | null = null, partial = false, disposed = false, wasActive = false;
  let ended = false, timer = 0, rereadFrame = 0, pending = '', ownsCanvas = false;
  const saved = new Map<string, string | null>();
  function text(node: HTMLElement, value: string): void { if (node.textContent !== value) node.textContent = value; }
  function attribute(node: HTMLElement, key: string, value: string | null): void {
    if (node.getAttribute(key) === value) return;
    if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
  }
  function focused(): boolean { return !disposed && options.isActive() && doc.activeElement === canvas; }
  function stop(): void {
    if (timer) view.clearTimeout(timer);
    if (rereadFrame) view.cancelAnimationFrame(rereadFrame);
    timer = rereadFrame = 0; pending = '';
  }
  function summary(): string {
    return selection ? formatInspectionSummary(selection, options.getInstrument(), options.getPeriodLabel(), options.getIndicators(), partial)
      : messages[getLocale()].empty;
  }
  function queue(): void {
    if (!focused()) {
      stop(); attribute(live, 'aria-live', 'off'); text(live, ''); return;
    }
    attribute(live, 'aria-live', 'polite');
    pending = summary();
    if (timer || rereadFrame || pending === live.textContent) return;
    timer = view.setTimeout(() => {
      timer = 0;
      if (focused()) text(live, pending);
      pending = '';
    }, 180);
  }
  function restoreCanvas(): void {
    if (!ownsCanvas) return;
    const labelKey = canvas.dataset.i18nAriaLabel;
    for (const [key, value] of saved) attribute(canvas, key,
      key === 'aria-label' && (labelKey === 'chartAria' || labelKey === 'auxiliaryChartAria') ? t(labelKey) : value);
    saved.clear(); ownsCanvas = false;
  }
  function refresh(): void {
    if (disposed) return;
    const active = options.isActive(), ready = options.isReady(), message = messages[getLocale()];
    if (wasActive && !active) { ended = true; selection = null; }
    if (active) ended = false;
    wasActive = active;
    const disabled = !ready && !active;
    if (button.disabled !== disabled) button.disabled = disabled;
    text(button, message.button);
    attribute(group, 'data-active', String(active));
    attribute(button, 'aria-pressed', String(active));
    attribute(button, 'aria-label', active ? message.exit : message.enter);
    attribute(button, 'title', active ? message.exit : message.enter);
    text(help, active ? message.help : !ready ? message.waiting : ended ? message.off : message.ready);
    if (focused()) {
      if (!ownsCanvas) {
        for (const key of ['role', 'aria-label', 'aria-describedby']) saved.set(key, canvas.getAttribute(key));
        ownsCanvas = true;
      }
      attribute(canvas, 'role', 'application');
      attribute(canvas, 'aria-label', `${message.label}: ${options.getInstrument().symbol} · ${options.getPeriodLabel()}`);
      attribute(canvas, 'aria-describedby', [saved.get('aria-describedby'), help.id].filter(Boolean).join(' '));
    } else restoreCanvas();
    queue();
  }
  button.addEventListener('click', () => { options.onToggle(); refresh(); canvas.focus({ preventScroll: true }); }, listener);
  canvas.addEventListener('focus', refresh, listener);
  canvas.addEventListener('blur', refresh, listener);
  refresh();
  return {
    refresh,
    update(next: InspectionSelection | null, isPartial: boolean): void { selection = next; partial = isPartial; refresh(); },
    announce(): void {
      if (!focused()) return;
      stop(); attribute(live, 'aria-live', 'polite'); text(live, '');
      rereadFrame = view.requestAnimationFrame(() => {
        rereadFrame = 0;
        if (focused()) text(live, summary());
      });
    },
    dispose(): void {
      disposed = true; stop(); events.abort(); restoreCanvas(); selection = null; group.remove();
    },
  };
}
