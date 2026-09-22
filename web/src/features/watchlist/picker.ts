import type { InstrumentEntry } from '../../data/catalog';
import { getLocale } from '../../ui/i18n.ts';

interface Options {
  catalog: readonly InstrumentEntry[];
  getSelected(): string;
  getWatched(): readonly string[];
  isSaved(): boolean;
  canSelect?(): boolean;
  onSelect(symbol: string): void;
  onWatch(symbol: string, watched: boolean): void;
}
const messages = {
  en: { title: 'Symbols', close: 'Close symbol picker', search: 'Search symbols or names',
    source: 'Reproducible samples · UTC · 24/7. All prices are synthetic, not exchange quotes.',
    show: 'Show chart', selected: 'Current chart', add: 'Add to watchlist', remove: 'Remove from watchlist',
    empty: 'No matching symbols', sample: 'SAMPLE', saved: 'Watchlist saved on this device.',
    unsaved: 'Storage unavailable. Changes last for this visit.' },
  'zh-CN': { title: '商品选择', close: '关闭商品选择', search: '搜索代码或名称',
    source: '可复现样本 · UTC · 全天连续。所有价格均为模拟样本，不是交易所报价。',
    show: '查看图表', selected: '当前图表', add: '添加到自选表', remove: '从自选表移除',
    empty: '没有匹配的商品', sample: '样本', saved: '自选表已保存在本设备。',
    unsaved: '存储暂不可用，更改仅在本次访问生效。' },
};

/** Search both languages independently of the current display language. */
export function filterInstrumentEntries(catalog: readonly InstrumentEntry[], query: string): InstrumentEntry[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en');
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  return catalog.filter(entry => {
    const value = normalize(`${entry.instrument.symbol} ${entry.labels.en} ${entry.labels['zh-CN']}`);
    return terms.every(term => value.includes(term));
  });
}

export function createSymbolPicker(options: Options) {
  const dialog = document.createElement('dialog'); dialog.className = 'watchlist-picker';
  dialog.setAttribute('aria-labelledby', 'watchlist-picker-title');
  const header = document.createElement('header'); header.className = 'market-section-header';
  const title = document.createElement('h2'); title.id = 'watchlist-picker-title'; title.className = 'market-section-title';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'market-icon-button'; close.textContent = '×';
  header.append(title, close);
  const search = document.createElement('input'); search.type = 'search'; search.className = 'symbol-picker-search';
  search.autocomplete = 'off'; search.spellcheck = false;
  const source = document.createElement('p'); source.className = 'market-note';
  const list = document.createElement('div'); list.className = 'symbol-picker-list';
  const status = document.createElement('p'); status.className = 'market-note'; status.setAttribute('role', 'status');
  dialog.append(header, search, source, list, status); document.body.append(dialog);
  const events = new AbortController(), listener = { signal: events.signal };
  let returnFocus: HTMLElement | null = null;
  function choose(symbol: string) { options.onSelect(symbol); if (dialog.open) dialog.close(); }
  function refresh(): void {
    const locale = getLocale(), text = messages[locale];
    title.textContent = text.title; source.textContent = text.source;
    close.title = text.close; close.setAttribute('aria-label', text.close);
    search.placeholder = text.search; search.setAttribute('aria-label', text.search);
    status.textContent = options.isSaved() ? text.saved : text.unsaved;
    const focused = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusSymbol = focused?.dataset.symbol, focusAction = focused?.dataset.action;
    list.replaceChildren();
    const found = filterInstrumentEntries(options.catalog, search.value);
    for (const entry of found) {
      const symbol = entry.instrument.symbol, selected = symbol === options.getSelected(), watched = options.getWatched().includes(symbol);
      const row = document.createElement('div'); row.className = `symbol-picker-row${selected ? ' selected' : ''}`;
      const identity = document.createElement('div'); identity.className = 'symbol-picker-identity';
      const name = document.createElement('strong'); name.textContent = symbol;
      const label = document.createElement('span'); label.textContent = entry.labels[locale];
      const badge = document.createElement('small'); badge.textContent = `${text.sample}${selected ? ` · ${text.selected}` : ''}`;
      identity.append(name, label, badge);
      const show = document.createElement('button'); show.type = 'button'; show.className = 'quiet-button'; show.textContent = text.show;
      show.disabled = options.canSelect?.() === false;
      show.dataset.symbol = symbol; show.dataset.action = 'show'; show.setAttribute('aria-label', `${text.show}: ${symbol}`);
      show.setAttribute('aria-pressed', String(selected)); show.addEventListener('click', () => choose(symbol));
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'quiet-button';
      toggle.textContent = watched ? '★' : '☆'; toggle.title = `${watched ? text.remove : text.add}: ${symbol}`;
      toggle.setAttribute('aria-label', toggle.title); toggle.setAttribute('aria-pressed', String(watched));
      toggle.dataset.symbol = symbol; toggle.dataset.action = 'watch';
      toggle.addEventListener('click', () => { options.onWatch(symbol, !watched); refresh(); });
      row.append(identity, show, toggle); list.append(row);
    }
    if (!found.length) { const empty = document.createElement('p'); empty.className = 'market-note symbol-picker-empty'; empty.textContent = text.empty; empty.setAttribute('role', 'status'); list.append(empty); }
    if (focusSymbol) Array.from(list.querySelectorAll<HTMLButtonElement>('button')).find(button =>
      button.dataset.symbol === focusSymbol && button.dataset.action === focusAction)?.focus({ preventScroll: true });
  }
  search.addEventListener('input', refresh, listener);
  search.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const first = list.querySelector<HTMLButtonElement>('button[data-action="show"]');
    if (event.key === 'ArrowDown' && first) { event.preventDefault(); first.focus(); }
    if (event.key === 'Enter' && first) { event.preventDefault(); first.click(); }
  }, listener);
  list.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const current = event.target as HTMLButtonElement;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.dataset.action === current.dataset.action);
    const index = buttons.indexOf(current); if (index < 0) return;
    event.preventDefault(); const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) search.focus(); else buttons[Math.min(next, buttons.length - 1)]?.focus();
  }, listener);
  close.addEventListener('click', () => dialog.close(), listener);
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, listener);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }, listener);
  return { refresh, open() { returnFocus = document.activeElement as HTMLElement | null; search.value = ''; refresh(); if (!dialog.open) dialog.showModal(); search.focus(); },
    dispose() { events.abort(); if (dialog.open) dialog.close(); dialog.remove(); } };
}
