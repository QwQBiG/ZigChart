import type { BarInfo, Instrument } from '../../chart/types';
import type { InstrumentEntry } from '../../data/catalog';
import { formatPrice, formatVolume } from '../../chart/format';
import { getLocale, type Locale } from '../../ui/i18n';
import { candleChange, readWatchlist, saveWatchlist, setWatched } from './model';
import { createSymbolPicker } from './picker';
import './panel.css';
import './picker.css';

const english = {
  watchlist: 'Watchlist', sample: 'SAMPLE', symbol: 'Symbol', last: 'Last', change: 'Change', percent: 'Change %',
  add: 'Add symbol', remove: 'Remove', empty: 'Your watchlist is empty', emptyHint: 'Add a symbol from the available data source.',
  source: 'Reproducible sample · UTC · 24/7', sourceHint: 'All catalog instruments use synthetic prices, not exchange quotes.',
  currentBar: 'Current candle', changeBasis: 'Change from this candle’s open', quote: 'Quote',
  historical: 'Historical snapshot · select Latest to return', historicalBar: 'Historical candle', historicalClose: 'Historical close',
  replay: 'Historical replay · exit replay to return to current data', replayBar: 'Replay candle',
  open: 'Open', high: 'High', low: 'Low', volume: 'Volume', candles: 'Loaded candles', period: 'Period',
  complete: 'Completed candle', partial: 'Current candle · incomplete', candleTime: 'Candle opening time',
  waiting: 'Waiting for data', chartSymbol: 'Show chart',
  quoteNotLoaded: 'Quote not loaded. Open this symbol’s chart to load its data.',
};
const messages: Record<Locale, Record<keyof typeof english, string>> = {
  en: english,
  'zh-CN': {
    watchlist: '自选表', sample: '样本', symbol: '商品代码', last: '最新价', change: '涨跌', percent: '涨跌幅',
    add: '添加商品', remove: '移除', empty: '自选表为空', emptyHint: '从当前数据源提供的商品中添加。',
    source: '可复现样本 · UTC · 全天连续', sourceHint: '目录内所有品种均使用模拟价格，不是交易所报价。',
    currentBar: '本根蜡烛', changeBasis: '涨跌以本根蜡烛的开盘价为基准', quote: '报价',
    historical: '历史快照 · 点击最新返回', historicalBar: '历史蜡烛', historicalClose: '历史收盘价',
    replay: '历史回放 · 退出回放可返回当前数据', replayBar: '回放蜡烛',
    open: '开盘', high: '最高', low: '最低', volume: '成交量', candles: '已加载 K 线', period: '周期',
    complete: '已完成蜡烛', partial: '当前蜡烛 · 尚未完成', candleTime: '蜡烛起始时间',
    waiting: '正在等待数据', chartSymbol: '查看图表',
    quoteNotLoaded: '报价未加载。打开此商品的图表以加载数据。',
  },
};

export interface MarketSidebarUpdate {
  symbol?: string;
  latest: BarInfo | null;
  partial: boolean;
  count: number;
  periodLabel: string;
  historical?: boolean;
  replay?: boolean;
}
interface MarketSidebarOptions {
  catalog: readonly InstrumentEntry[];
  getInstrument(): Instrument;
  canSelect?(): boolean;
  onSelect(symbol: string): void;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function text(element: HTMLElement, value: string): void { if (element.textContent !== value) element.textContent = value; }
function button(className: string, label?: string): HTMLButtonElement {
  const result = node('button', className, label);
  result.type = 'button';
  return result;
}

/** A presentation-only sidebar. The host owns subscriptions and the selected chart. */
export function createMarketSidebar(host: HTMLElement, options: MarketSidebarOptions) {
  let instrument = options.getInstrument(), activeSymbol = instrument.symbol;
  const supported = options.catalog.map(entry => entry.instrument.symbol);
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Session use remains available. */ }
  let state = readWatchlist(storage, instrument.symbol, supported);
  let saved = storage !== undefined;
  let snapshot: MarketSidebarUpdate = { latest: null, partial: false, count: 0, periodLabel: '' };
  let locale = getLocale();
  let cachedSnapshot = '';
  let dateFormat: Intl.DateTimeFormat;
  const root = node('div', 'market-content');
  const watch = node('section', 'watchlist-section');
  const heading = node('header', 'market-section-header');
  const title = node('h2', 'market-section-title');
  const add = button('market-icon-button', '+');
  heading.append(title, add);
  const tableBox = node('div', 'watchlist-table-scroll');
  const table = node('table', 'watchlist-table');
  const tableHead = node('thead', '');
  const tableBody = node('tbody', '');
  table.append(tableHead, tableBody);
  tableBox.append(table);
  const empty = node('div', 'watchlist-empty');
  const basis = node('p', 'market-note watchlist-basis');
  const unloaded = node('p', 'market-note watchlist-basis');
  watch.append(heading, tableBox, empty, basis, unloaded);
  const details = node('section', 'market-quote');
  const identity = node('header', 'market-quote-identity');
  const avatar = node('span', 'market-symbol-avatar', 'S');
  const name = node('strong', 'market-symbol-name');
  const symbol = node('span', 'market-symbol-code', instrument.symbol);
  const badge = node('span', 'small-tag');
  identity.append(avatar, name, symbol, badge);
  const price = node('div', 'market-quote-price', '—');
  const change = node('div', 'market-quote-change', '—');
  const status = node('p', 'market-note');
  const quoteHeading = node('h3', 'market-quote-heading');
  const stats = node('dl', 'market-quote-stats');
  const statValues = new Map<string, HTMLElement>();
  const statLabels = new Map<keyof typeof english, HTMLElement>();
  for (const key of ['open', 'high', 'low', 'volume', 'period', 'candles'] as const) {
    const pair = node('div', ''); const label = node('dt', ''); const value = node('dd', '', '—');
    pair.append(label, value); stats.append(pair); statLabels.set(key, label); statValues.set(key, value);
  }
  const timestamp = node('p', 'market-note market-timestamp');
  const source = node('p', 'market-note');
  const sourceHint = node('p', 'market-note');
  details.append(identity, price, change, status, quoteHeading, stats, timestamp, source, sourceHint);
  root.append(watch, details);
  host.append(root);

  const picker = createSymbolPicker({ catalog: options.catalog, getSelected: () => options.getInstrument().symbol,
    getWatched: () => state.symbols, isSaved: () => saved, canSelect: options.canSelect,
    onSelect: options.onSelect, onWatch: updateMembership });
  const quoteRows = new Map<string, { last: HTMLElement; change: HTMLElement; percent: HTMLElement }>();

  function updateMembership(symbol: string, watched: boolean): void {
    state = setWatched(state, symbol, watched, supported);
    saved = saveWatchlist(storage, state);
    renderMembership();
    cachedSnapshot = '';
    renderSnapshot();
  }
  function renderMembership(): void {
    const m = messages[locale];
    tableBody.replaceChildren();
    quoteRows.clear();
    tableBox.hidden = !state.symbols.length;
    empty.hidden = !!state.symbols.length;
    unloaded.hidden = !state.symbols.some(symbol => symbol !== instrument.symbol); text(unloaded, m.quoteNotLoaded);
    empty.replaceChildren(node('strong', '', m.empty), node('p', 'market-note', m.emptyHint));
    for (const watchedSymbol of state.symbols) {
      const entry = options.catalog.find(item => item.instrument.symbol === watchedSymbol);
      if (!entry) continue;
      const selected = watchedSymbol === instrument.symbol, row = node('tr', selected ? 'selected' : '');
      const cell = node('td', 'watchlist-symbol');
      const select = button('watchlist-symbol-button', watchedSymbol);
      select.title = `${m.chartSymbol}: ${entry.labels[locale]}`; select.setAttribute('aria-label', select.title);
      select.disabled = options.canSelect?.() === false;
      select.setAttribute('aria-pressed', String(selected)); select.addEventListener('click', () => options.onSelect(watchedSymbol));
      cell.append(select); row.append(cell);
      const last = node('td', '', '—'), change = node('td', 'watchlist-change', '—'), percent = node('td', '', '—');
      if (!selected) for (const field of [last, change, percent]) { field.title = m.quoteNotLoaded; field.setAttribute('aria-label', m.quoteNotLoaded); }
      const action = node('td', 'watchlist-action'), remove = button('market-icon-button watchlist-remove', '×');
      remove.title = `${m.remove} ${watchedSymbol}`; remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => { updateMembership(watchedSymbol, false); picker.refresh(); });
      action.append(remove); row.append(last, change, percent, action); tableBody.append(row);
      quoteRows.set(watchedSymbol, { last, change, percent });
    }
  }
  function renderSnapshot(): void {
    const latest = snapshot.latest;
    const key = JSON.stringify([locale, instrument.symbol, instrument.priceScale, instrument.volumeScale, latest?.time, latest?.open, latest?.high, latest?.low, latest?.close,
      latest?.volume, snapshot.partial, snapshot.count, snapshot.periodLabel, snapshot.historical, snapshot.replay]);
    if (key === cachedSnapshot) return;
    cachedSnapshot = key;
    const m = messages[locale];
    const barLabel = snapshot.replay ? m.replayBar : snapshot.historical ? m.historicalBar : m.currentBar;
    text(quoteHeading, `${m.quote} · ${barLabel}`);
    const lastHeader = tableHead.querySelectorAll('th')[1];
    if (lastHeader) text(lastHeader, snapshot.historical || snapshot.replay ? m.historicalClose : m.last);
    text(basis, snapshot.replay ? `${m.replay} · ${m.changeBasis}` : snapshot.historical ? `${m.historical} · ${m.changeBasis}` : m.changeBasis);
    const number = (value: number) => formatPrice(value, instrument.priceScale);
    const delta = latest ? candleChange(latest) : null;
    const direction = delta && delta.units !== 0 ? (delta.units > 0 ? 'up' : 'down') : 'flat';
    const signed = (value: number, formatted: string) => `${value > 0 ? '+' : ''}${formatted}`;
    const priceText = latest ? number(latest.close) : '—';
    const changeText = delta ? signed(delta.units, number(delta.units)) : '—';
    const percentText = delta?.percent != null ? `${signed(delta.percent, delta.percent.toFixed(2))}%` : '—';
    text(price, priceText);
    text(change, delta ? `${changeText} (${percentText}) · ${barLabel}` : '—');
    change.dataset.direction = direction;
    for (const [rowSymbol, row] of quoteRows) {
      const selected = rowSymbol === instrument.symbol;
      text(row.last, selected ? priceText : '—');
      text(row.change, selected ? changeText : '—'); text(row.percent, selected ? percentText : '—');
      row.change.dataset.direction = selected ? direction : 'flat'; row.percent.dataset.direction = selected ? direction : 'flat';
    }
    text(status, snapshot.replay ? `${m.replay} · ${!latest ? m.waiting : snapshot.partial ? m.partial : m.complete}` :
      snapshot.historical ? m.historical : latest ? (snapshot.partial ? m.partial : m.complete) : m.waiting);
    for (const key of ['open', 'high', 'low'] as const) text(statValues.get(key)!, latest ? number(latest[key]) : '—');
    text(statValues.get('volume')!, latest ? formatVolume(latest.volume, instrument.volumeScale, false) : '—');
    text(statValues.get('period')!, snapshot.periodLabel || '—');
    text(statValues.get('candles')!, snapshot.count.toLocaleString(locale));
    text(timestamp, latest ? `${m.candleTime}: ${dateFormat.format(latest.time)} UTC` : '');
  }
  function syncInstrument(): boolean {
    instrument = options.getInstrument();
    if (activeSymbol === instrument.symbol) return false;
    activeSymbol = instrument.symbol;
    snapshot = { latest: null, partial: false, count: 0, periodLabel: '', symbol: activeSymbol };
    cachedSnapshot = '';
    return true;
  }
  function refresh(): void {
    syncInstrument();
    locale = getLocale();
    const m = messages[locale];
    dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
      timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    text(title, m.watchlist); text(badge, m.sample);
    text(name, options.catalog.find(entry => entry.instrument.symbol === instrument.symbol)?.labels[locale] ?? instrument.name);
    text(symbol, instrument.symbol);
    text(basis, m.changeBasis); text(source, m.source); text(sourceHint, m.sourceHint);
    text(quoteHeading, `${m.quote} · ${m.currentBar}`);
    add.title = m.add; add.setAttribute('aria-label', m.add);
    table.setAttribute('aria-label', m.watchlist);
    const head = node('tr', '');
    for (const key of ['symbol', 'last', 'change', 'percent'] as const) {
      const cell = node('th', key === 'change' ? 'watchlist-change' : '', m[key]);
      cell.scope = 'col'; head.append(cell);
    }
    const action = node('th', 'watchlist-action'); action.scope = 'col'; action.setAttribute('aria-label', m.remove);
    head.append(action); tableHead.replaceChildren(head);
    for (const [key, label] of statLabels) text(label, m[key]);
    renderMembership(); cachedSnapshot = ''; renderSnapshot(); picker.refresh();
  }
  add.addEventListener('click', picker.open);
  refresh();
  return {
    update(next: MarketSidebarUpdate): void {
      if (syncInstrument()) refresh();
      if (next.symbol && next.symbol !== instrument.symbol) return;
      snapshot = next; renderSnapshot();
    },
    refresh, openPicker: picker.open,
    dispose(): void { picker.dispose(); root.remove(); },
  };
}
