import { getLocale, type Locale } from '../../ui/i18n';
import { customRange, formatUtcDate } from './model';
import type { RangeController } from './controller';

const english = {
  title: 'Go to date', close: 'Close date navigation', day: 'Date', range: 'Custom range',
  start: 'Start date (UTC)', end: 'End date (UTC)', go: 'Go', cancel: 'Cancel',
  hint: 'Dates use UTC. The end date is included. Candle resolution adjusts to fit the range.',
  invalid: 'Enter valid dates in order, starting before the latest available data.',
};
const messages: Record<Locale, typeof english> = {
  en: english,
  'zh-CN': { title: '跳转到日期', close: '关闭日期导航', day: '日期', range: '自定义范围',
    start: '开始日期（UTC）', end: '结束日期（UTC）', go: '跳转', cancel: '取消',
    hint: '日期按 UTC 计算，结束日期包含在范围内。K 线周期会自动适配范围。',
    invalid: '请输入有效且顺序正确的日期，开始日期须早于最新可用数据。' },
};

/** Calendar input owns only a draft; loading and viewport changes belong to the range controller. */
export function createDateNavigation(container: HTMLElement, controller: RangeController) {
  let mode: 'day' | 'range' = 'day', invalid = false, disposed = false;
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'range-date-open';
  trigger.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18M8 15h3v3H8z"/></svg>';
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'date-navigation');
  const dialog = document.createElement('dialog'); dialog.className = 'range-date-dialog'; dialog.id = 'date-navigation';
  dialog.setAttribute('aria-labelledby', 'date-navigation-title');
  const header = document.createElement('header'), title = document.createElement('h2'); title.id = 'date-navigation-title';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
  header.append(title, close);
  const form = document.createElement('form'); form.noValidate = true;
  const modes = document.createElement('div'); modes.className = 'range-date-modes'; modes.setAttribute('role', 'group');
  const day = document.createElement('button'), range = document.createElement('button');
  day.type = range.type = 'button'; modes.append(day, range);
  function dateField() {
    const label = document.createElement('label'), text = document.createElement('span'), input = document.createElement('input');
    input.type = 'date'; input.required = true; input.min = '1970-01-01'; input.max = '9999-12-31';
    input.addEventListener('input', () => { invalid = false; refresh(); });
    label.append(text, input); return { label, text, input };
  }
  const start = dateField(), end = dateField();
  const hint = document.createElement('p'), error = document.createElement('p');
  hint.className = 'range-date-hint'; error.className = 'range-date-error'; error.setAttribute('role', 'alert');
  const footer = document.createElement('footer'), cancel = document.createElement('button'), go = document.createElement('button');
  cancel.type = 'button'; go.type = 'submit'; go.className = 'range-date-go'; footer.append(cancel, go);
  form.append(modes, start.label, end.label, hint, error, footer); dialog.append(header, form);
  container.append(trigger); document.body.append(dialog);
  function refresh() {
    const text = messages[getLocale()];
    title.textContent = trigger.title = text.title;
    trigger.setAttribute('aria-label', text.title); trigger.setAttribute('aria-expanded', String(dialog.open));
    trigger.setAttribute('aria-pressed', String(controller.selected === 'Custom'));
    trigger.disabled = controller.cutoff() === null || controller.status === 'loading';
    close.title = text.close; close.setAttribute('aria-label', text.close);
    modes.setAttribute('aria-label', text.title);
    day.textContent = text.day; range.textContent = text.range;
    day.setAttribute('aria-pressed', String(mode === 'day')); range.setAttribute('aria-pressed', String(mode === 'range'));
    start.text.textContent = mode === 'day' ? `${text.day} (UTC)` : text.start; end.text.textContent = text.end;
    end.label.hidden = mode === 'day'; end.input.disabled = mode === 'day';
    hint.textContent = text.hint; error.textContent = invalid ? text.invalid : ''; error.hidden = !invalid;
    start.input.setAttribute('aria-invalid', String(invalid)); end.input.setAttribute('aria-invalid', String(invalid));
    go.textContent = text.go; cancel.textContent = text.cancel;
  }
  function open() {
    const cutoff = controller.cutoff();
    if (disposed || dialog.open || cutoff === null || controller.status === 'loading') return;
    invalid = false;
    if (!start.input.value) start.input.value = end.input.value = formatUtcDate(cutoff - 1);
    refresh(); dialog.showModal(); refresh(); start.input.focus();
  }
  trigger.addEventListener('click', open);
  for (const button of [close, cancel]) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!disposed) { refresh(); trigger.focus({ preventScroll: true }); } });
  day.addEventListener('click', () => { mode = 'day'; invalid = false; refresh(); });
  range.addEventListener('click', () => { mode = 'range'; invalid = false; refresh(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const cutoff = controller.cutoff();
    const value = cutoff === null ? null : customRange(start.input.value, mode === 'day' ? start.input.value : end.input.value, cutoff);
    if (!value) { invalid = true; refresh(); start.input.focus(); return; }
    dialog.close(); void controller.custom(value.from, value.to);
  });
  refresh();
  return { refresh, open, dispose() { disposed = true; dialog.close(); dialog.remove(); trigger.remove(); } };
}
