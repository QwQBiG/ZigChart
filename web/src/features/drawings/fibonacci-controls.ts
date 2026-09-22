import type { Drawing } from './document';
import { createFibonacciStyle, validFibonacciStyle, type FibonacciStyle } from './fibonacci-model';
import { MAX_FIBONACCI_LEVELS } from '../../chart/fibonacci';
import { getLocale, t, type MessageKey } from '../../ui/i18n';
import './fibonacci-controls.css';

interface Options { container: HTMLElement; getSelection(): Drawing | null; onChange(value: FibonacciStyle): void }
const flags = { extendLeft: 'fibExtendLeft', extendRight: 'fibExtendRight', reverse: 'fibReverse',
  logarithmic: 'fibLogarithmic', trend: 'fibTrend', labels: 'fibLabels', prices: 'fibPrices' } as const;

/** Selected-object styles commit independently from chart appearance and market data. */
export function createFibonacciControls(options: Options) {
  const section = document.createElement('section'); section.className = 'fibonacci-controls'; section.hidden = true;
  options.container.append(section);
  const events = new AbortController();
  let signature = '';
  let committing = false;
  function refresh() {
    if (committing) return;
    const selected = options.getSelection();
    const config = selected?.kind === 'fibonacci' ? selected.fibonacci : undefined;
    section.hidden = !config;
    const key = `${getLocale()}:${selected?.id}:${JSON.stringify(config)}`;
    if (!config || signature === key) return;
    signature = key;
    const active = document.activeElement as HTMLInputElement | null;
    const activeKey = active?.dataset.fibKey, activeValue = active?.value;
    section.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = t('fibonacciSettings'); section.append(heading);
    function input(key: string, label: string, type: string, value: string | boolean, host: HTMLElement = section) {
      const wrapper = document.createElement('label'), name = document.createElement('span'), field = document.createElement('input');
      name.textContent = label; field.type = type; field.dataset.fibKey = key; field.setAttribute('aria-label', label);
      if (typeof value === 'boolean') field.checked = value; else field.value = value;
      wrapper.append(name, field); host.append(wrapper); return field;
    }
    for (const [key, message] of Object.entries(flags)) input(key, t(message), 'checkbox', config[key as keyof typeof flags]);
    const opacity = input('fillOpacity', t('fibOpacity'), 'number', String(config.fillOpacity));
    opacity.min = '0'; opacity.max = '.6'; opacity.step = '.01';
    const patterns = document.createElement('fieldset'), caption = document.createElement('legend');
    caption.textContent = t('fibLineStyle'); patterns.append(caption); section.append(patterns);
    for (const value of ['solid', 'dashed', 'dotted'] as const) {
      const field = input('lineStyle', t(`fib${value}` as MessageKey), 'radio', config.lineStyle === value, patterns);
      field.name = 'fib-line-style'; field.value = value;
    }
    const list = document.createElement('div'); list.className = 'fib-levels'; section.append(list);
    for (const [index, level] of config.levels.entries()) {
      const row = document.createElement('div'); row.className = 'fib-level'; list.append(row);
      input(`enabled:${index}`, t('fibEnabled', { n: index + 1 }), 'checkbox', level.enabled, row);
      const ratio = input(`ratio:${index}`, `${t('fibRatio')} ${index + 1}`, 'number', String(level.ratio), row);
      ratio.min = '-10'; ratio.max = '10'; ratio.step = 'any';
      input(`color:${index}`, `${t('fibLevelColor')} ${index + 1}`, 'color', level.color, row);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.dataset.removeLevel = String(index);
      remove.title = t('fibRemove', { n: index + 1 }); remove.setAttribute('aria-label', remove.title); remove.disabled = config.levels.length <= 1; row.append(remove);
    }
    const add = document.createElement('button'); add.type = 'button'; add.dataset.addLevel = ''; add.className = 'quiet-button';
    add.textContent = `${t('fibAdd')} (${config.levels.length}/${MAX_FIBONACCI_LEVELS})`; add.disabled = config.levels.length >= MAX_FIBONACCI_LEVELS; section.append(add);
    const hint = document.createElement('p'); hint.className = 'settings-hint'; hint.textContent = t('fibHint'); section.append(hint);
    const error = document.createElement('p'); error.className = 'fib-error'; error.setAttribute('role', 'status'); section.append(error);
    if (activeKey) Array.from(section.querySelectorAll<HTMLInputElement>('input')).find(field =>
      field.dataset.fibKey === activeKey && (field.type !== 'radio' || field.value === activeValue))?.focus({ preventScroll: true });
  }
  function commit(field: HTMLInputElement) {
    if (committing || !field.isConnected) return;
    const key = field.dataset.fibKey;
    const current = options.getSelection()?.fibonacci;
    if (!key || !current) return;
    const config = structuredClone(current), [name, slot] = key.split(':');
    if (Object.hasOwn(flags, key)) config[key as keyof typeof flags] = field.checked;
    else if (key === 'fillOpacity') config.fillOpacity = field.valueAsNumber;
    else if (key === 'lineStyle') config.lineStyle = field.value as FibonacciStyle['lineStyle'];
    else if (slot !== undefined && config.levels[Number(slot)]) {
      const level = config.levels[Number(slot)];
      if (name === 'ratio') level.ratio = field.valueAsNumber;
      if (name === 'enabled') level.enabled = field.checked;
      if (name === 'color') level.color = field.value;
    }
    const valid = validFibonacciStyle(config);
    field.setAttribute('aria-invalid', String(!valid));
    section.querySelector('.fib-error')!.textContent = section.querySelector('input[aria-invalid="true"]') ? t('fibInvalid') : '';
    if (valid && JSON.stringify(config) !== JSON.stringify(current)) {
      // Keep the live input in place while committing so typing and focus are stable.
      committing = true;
      try { options.onChange(config); } finally { committing = false; }
      const selected = options.getSelection();
      signature = `${getLocale()}:${selected?.id}:${JSON.stringify(selected?.fibonacci)}`;
    }
  }
  section.addEventListener('change', event => commit(event.target as HTMLInputElement), { signal: events.signal });
  section.addEventListener('focusout', event => {
    const field = event.target as HTMLInputElement;
    if (field.type === 'number') commit(field);
  }, { signal: events.signal });
  section.addEventListener('keydown', event => {
    const field = event.target as HTMLInputElement;
    if (event.key === 'Enter' && field.type === 'number') { event.preventDefault(); commit(field); }
  }, { signal: events.signal });
  section.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const current = options.getSelection()?.fibonacci;
    if (!button || button.disabled || !current) return;
    const config = structuredClone(current);
    if (button.dataset.removeLevel !== undefined) config.levels.splice(Number(button.dataset.removeLevel), 1);
    else if (button.dataset.addLevel !== undefined && config.levels.length < MAX_FIBONACCI_LEVELS) {
      config.levels.push({ ratio: 1.618, color: createFibonacciStyle().levels[0].color, enabled: true });
    } else return;
    if (validFibonacciStyle(config)) options.onChange(config);
  }, { signal: events.signal });
  return { refresh, dispose() { events.abort(); section.remove(); } };
}
