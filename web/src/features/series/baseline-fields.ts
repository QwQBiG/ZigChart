import { t, type MessageKey } from '../../ui/i18n';
import type { SeriesStyle } from './model';

/** Edit only the baseline draft; the appearance dialog owns apply/cancel and focus. */
export function createBaselineFields(container: HTMLElement, getPriceScale: () => number,
  onChange: (update: Partial<SeriesStyle>) => void) {
  const localized: Array<[HTMLElement, MessageKey]> = [];
  function row(caption: MessageKey, input: HTMLInputElement | HTMLSelectElement): void {
    const label = document.createElement('label'), name = document.createElement('span');
    label.className = 'appearance-row'; localized.push([name, caption]);
    label.append(name, input); container.append(label);
  }
  const source = document.createElement('select');
  for (const [value, label] of [['first-visible', 'seriesBaselineFirst'], ['price', 'seriesBaselineFixed']] as const) {
    const option = document.createElement('option'); option.value = value;
    localized.push([option, label]); source.append(option);
  }
  row('seriesBaselineSource', source);
  const price = document.createElement('input'); price.type = 'number';
  price.required = true; row('seriesBaselinePrice', price);
  const colors: Array<[HTMLInputElement, 'baselineAboveColor' | 'baselineBelowColor']> = [];
  for (const [key, label] of [['baselineAboveColor', 'seriesBaselineAbove'], ['baselineBelowColor', 'seriesBaselineBelow']] as const) {
    const input = document.createElement('input'); input.type = 'color'; input.className = 'appearance-color';
    row(label, input); colors.push([input, key]);
    input.addEventListener('input', () => onChange({ [key]: input.value }));
  }
  source.addEventListener('change', () => {
    if (source.value !== 'price' && source.value !== 'first-visible') return;
    price.disabled = source.value !== 'price'; onChange({ baselineSource: source.value });
  });
  price.addEventListener('input', () => {
    price.setCustomValidity('');
    if (!price.validity.valid) return;
    const raw = Math.round(Number(price.value) * getPriceScale());
    if (Number.isSafeInteger(raw) && Math.abs(raw) <= 1e12) onChange({ baselinePrice: raw });
  });
  return {
    refresh(style: SeriesStyle) {
      const priceScale = getPriceScale();
      price.step = String(1 / priceScale); price.min = String(-1e12 / priceScale); price.max = String(1e12 / priceScale);
      container.hidden = style.type !== 'baseline';
      for (const [node, label] of localized) node.textContent = t(label);
      source.value = style.baselineSource; price.value = String(style.baselinePrice / priceScale);
      price.setCustomValidity('');
      price.disabled = style.baselineSource !== 'price';
      for (const [input, key] of colors) input.value = style[key];
    },
    validate() {
      if (container.hidden || price.disabled) return true;
      price.setCustomValidity('');
      if (!price.validity.valid) price.setCustomValidity(t('seriesBaselineInvalid'));
      return price.reportValidity();
    },
  };
}
