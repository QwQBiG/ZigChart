import { getLocale, t, type MessageKey } from '../../ui/i18n.ts';
import { SERIES_TYPES, isSeriesType, type SeriesStyle, type SeriesType } from './model.ts';

const labels: Record<SeriesType, MessageKey> = {
  candles: 'seriesCandles', hollow: 'seriesHollow', bars: 'seriesBars', line: 'seriesLine', area: 'seriesArea', baseline: 'seriesBaseline',
};
interface SeriesControlOptions {
  getState(): SeriesStyle;
  onChange(next: SeriesStyle): void;
}

/** Present the one main-series type selector without owning persistence or rendering. */
export function createSeriesControls(select: HTMLSelectElement, options: SeriesControlOptions) {
  const events = new AbortController();
  let locale: string | null = null;
  function refresh(): void {
    if (locale !== getLocale()) {
      locale = getLocale();
      select.replaceChildren(...SERIES_TYPES.map(type => {
        const option = document.createElement('option');
        option.value = type; option.textContent = t(labels[type]);
        return option;
      }));
      select.setAttribute('aria-label', t('seriesType'));
      select.title = t('seriesType');
    }
    select.value = options.getState().type;
  }
  select.addEventListener('change', () => {
    const type = select.value;
    const current = options.getState();
    if (isSeriesType(type) && current.type !== type) options.onChange({ ...current, type });
    refresh();
  }, { signal: events.signal });
  refresh();
  return { refresh, dispose() { events.abort(); } };
}
