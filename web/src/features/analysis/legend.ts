import { getLocale } from '../../ui/i18n';
import { INDICATOR_IDS, EXTRA_AVERAGE_IDS, isExtraAverage, type StudyId, type IndicatorState } from './model';
import type { Frame } from '../../chart/types';
import './legend.css';

interface LegendOptions {
  getState(): IndicatorState;
  onSettings(id: StudyId): void;
  onRemove(id: StudyId): void;
}

/** Legends belong to active studies, so removing a study removes all of its controls. */
export function createIndicatorLegends(options: LegendOptions) {
  const price = document.getElementById('indicator-controls')!;
  const volume = document.getElementById('volume-legend')!;
  const chart = document.getElementById('chart-container')!;
  const paneHosts = new Map<number, HTMLElement>([[1, volume]]);
  const paneIds = { volume: 1, rsi: 2, macd: 3 } as const;
  const paneGeometry = new Map<number, { top: number; bottom: number; width: number }>();
  volume.classList.add('pane-study-legend');
  for (const id of ['rsi', 'macd'] as const) {
    const host = document.createElement('div');
    host.id = `${id}-legend`; host.className = 'pane-study-legend'; host.hidden = true;
    host.dataset.pane = String(paneIds[id]); chart.append(host); paneHosts.set(paneIds[id], host);
  }
  const events = new AbortController();
  const entries = [...INDICATOR_IDS, ...EXTRA_AVERAGE_IDS].map(id => {
    const row = document.createElement('div');
    row.className = 'study-legend'; row.dataset.study = id;
    const name = document.createElement('span'); name.className = 'study-name';
    const settings = document.createElement('button'); settings.type = 'button';
    settings.className = 'study-action'; settings.dataset.studySettings = id;
    settings.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14M7 3v4M13 8v4M8 13v4"/></svg>';
    const remove = document.createElement('button'); remove.type = 'button';
    remove.className = 'study-action'; remove.dataset.studyRemove = id;
    remove.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>';
    settings.addEventListener('click', () => options.onSettings(id), { signal: events.signal });
    remove.addEventListener('click', () => options.onRemove(id), { signal: events.signal });
    row.append(name, settings, remove);
    (id === 'ma' || id === 'ema' || id === 'bb' || isExtraAverage(id) ? price : paneHosts.get(paneIds[id])!).append(row);
    return { id, row, name, settings, remove };
  });
  function positionPanes() {
    const state = options.getState();
    for (const [id, paneId] of Object.entries(paneIds) as Array<[keyof typeof paneIds, number]>) {
      const host = paneHosts.get(paneId)!;
      const pane = paneGeometry.get(paneId);
      host.hidden = !state[id].enabled || !pane || pane.bottom <= pane.top;
      if (!pane || host.hidden) continue;
      const top = `${Math.max(0, pane.top + 4)}px`;
      const height = `${Math.max(0, pane.bottom - pane.top - 4)}px`;
      const width = `${Math.max(0, pane.width - 100)}px`;
      if (host.style.top !== top) host.style.top = top;
      if (host.style.maxHeight !== height) host.style.maxHeight = height;
      if (host.style.maxWidth !== width) host.style.maxWidth = width;
    }
  }
  function refresh() {
    const state = options.getState();
    const chinese = getLocale() === 'zh-CN';
    for (const { id, row, name, settings, remove } of entries) {
      if (isExtraAverage(id)) {
        const study = state.averages.find(item => item.id === id);
        row.hidden = !study;
        if (!study) continue;
        const title = `${study.kind.toUpperCase()} ${study.period} · #${id.slice(8)}`;
        name.textContent = title;
        row.style.setProperty('--study-color', study.color);
        settings.title = `${title} · ${chinese ? '设置' : 'Settings'}`;
        remove.title = `${chinese ? '删除' : 'Remove'} ${title}`;
        settings.setAttribute('aria-label', settings.title); remove.setAttribute('aria-label', remove.title);
        continue;
      }
      const title = id === 'volume' ? (chinese ? '成交量' : 'Volume') : id === 'macd'
        ? `MACD ${state.macd.fastPeriod} ${state.macd.slowPeriod} ${state.macd.signalPeriod}` : id === 'bb'
          ? `BB ${state.bb.period} ${state.bb.multiplier}` : `${id.toUpperCase()} ${state[id].period}`;
      row.hidden = !state[id].enabled;
      name.textContent = title;
      row.style.setProperty('--study-color', id === 'volume' ? state.volume.upColor : id === 'macd' ? state.macd.lineColor
        : id === 'bb' ? state.bb.basisColor : state[id].color);
      settings.title = `${title} · ${chinese ? '设置' : 'Settings'}`;
      remove.title = `${chinese ? '删除' : 'Remove'} ${title}`;
      settings.setAttribute('aria-label', settings.title);
      remove.setAttribute('aria-label', remove.title);
    }
    price.hidden = !state.ma.enabled && !state.ema.enabled && !state.bb.enabled && !state.averages.length;
    positionPanes();
  }
  refresh();
  return {
    refresh,
    resetFrame() { paneGeometry.clear(); positionPanes(); },
    updateFrame(frame: Frame) {
      paneGeometry.clear();
      for (const pane of frame.panes ?? []) {
        if (paneHosts.has(pane.id)) paneGeometry.set(pane.id, { top: pane.top, bottom: pane.bottom, width: frame.meta[11] });
      }
      if (!frame.panes && frame.meta[6] > frame.meta[5]) {
        paneGeometry.set(1, { top: (frame.meta[4] + frame.meta[5]) / 2, bottom: frame.meta[6], width: frame.meta[11] });
      }
      positionPanes();
    },
    dispose() {
      events.abort(); price.replaceChildren(); volume.replaceChildren();
      paneHosts.get(2)?.remove(); paneHosts.get(3)?.remove(); paneGeometry.clear();
    },
  };
}
