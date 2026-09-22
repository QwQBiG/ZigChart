import { isDrawingKind, type DrawingKind } from '../../chart/drawing-types';
import { getLocale, t } from '../../ui/i18n';
import type { DrawingTool } from './editor';
import './tools.css';

/** A themed, keyboard-accessible category menu; the editor owns active gesture state. */
export function createDrawingTools(select: HTMLSelectElement, choose: (tool: DrawingKind) => void) {
  const events = new AbortController();
  let locale = '';
  const paths: Partial<Record<DrawingKind, string>> = {
    horizontal: 'M3 12h18', vertical: 'M12 3v18', horizontalRay: 'M5 12h16M5 9v6',
    trend: 'M5 19L19 5M3 17l4 4M17 3l4 4', ray: 'M5 19L21 3M3 17l4 4', extended: 'M3 21L21 3',
    fibonacci: 'M3 5h18M3 10h18M3 14h18M3 19h18M5 19L19 5',
  };
  function refresh(tool: DrawingTool, disabled: boolean): void {
    if (locale !== getLocale()) {
      locale = getLocale();
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = t('lineTools'); placeholder.disabled = true;
      select.replaceChildren(placeholder);
      for (const [label, kinds] of [
        ['singlePointTools', ['horizontal', 'horizontalRay', 'vertical']],
        ['twoPointTools', ['trend', 'ray', 'extended']],
        ['fibonacciTools', ['fibonacci']],
      ] as const) {
        const group = document.createElement('optgroup'); group.label = t(label);
        for (const kind of kinds) {
          const option = document.createElement('option'); option.value = kind;
          option.textContent = t(`${kind}Tool`); group.append(option);
        }
        select.append(group);
      }
      select.setAttribute('aria-label', t('lineTools'));
    }
    const active = tool !== 'pointer' && tool !== 'rectangle' && tool !== 'text';
    select.value = active ? tool : ''; select.disabled = disabled;
    select.title = active ? t(`${tool}Tool`) : t('lineTools');
    select.closest('.line-tools')?.classList.toggle('active', active);
    select.closest('.line-tools')?.querySelector('svg path')?.setAttribute('d', paths[active ? tool : 'trend']!);
  }
  select.addEventListener('change', () => {
    if (isDrawingKind(select.value)) choose(select.value);
  }, { signal: events.signal });
  return { refresh, dispose() { events.abort(); } };
}
