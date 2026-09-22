import { validTextStyle, type TextStyle } from './text-model.ts';
import { getLocale } from '../../ui/i18n.ts';

interface Options {
  container: HTMLElement;
  getSelection(): { id: string; kind: string; text?: TextStyle } | null;
  onChange(style: TextStyle): void;
}
const messages = {
  en: { title: 'Text annotation', content: 'Text', fontSize: 'Font size', bold: 'Bold', italic: 'Italic',
    wrapWidth: 'Wrap width', background: 'Background', backgroundColor: 'Background color',
    backgroundOpacity: 'Background opacity', border: 'Border', borderColor: 'Border color',
    hint: 'Changes save when you leave a field. Ctrl+Enter saves text. Text color and border width use the object style.',
    invalid: 'Use nonblank text up to 1,000 characters and 20 lines, font size 10–48, wrap width 80–640, and opacity 0–1.' },
  'zh-CN': { title: '文字标注', content: '文字', fontSize: '字号', bold: '粗体', italic: '斜体',
    wrapWidth: '换行宽度', background: '显示背景', backgroundColor: '背景颜色',
    backgroundOpacity: '背景不透明度', border: '显示边框', borderColor: '边框颜色',
    hint: '离开字段时保存修改；Ctrl+Enter 保存文字。文字颜色和边框宽度使用对象样式。',
    invalid: '文字不能为空，最多 1,000 个字符、20 行；字号 10–48、换行宽度 80–640、不透明度 0–1。' },
};
type Field = HTMLInputElement | HTMLTextAreaElement;
const flags = new Set<keyof TextStyle>(['bold', 'italic', 'background', 'border']);
const numbers = new Set<keyof TextStyle>(['fontSize', 'wrapWidth', 'backgroundOpacity']);

/** Independent object edits preserve the mounted input nodes and their focus. */
export function createTextControls(options: Options) {
  const doc = options.container.ownerDocument, section = doc.createElement('section');
  section.className = 'text-controls'; section.hidden = true; options.container.append(section);
  const events = new AbortController(), listener = { signal: events.signal };
  const heading = doc.createElement('h3'), fields = new Map<keyof TextStyle, Field>(), labels = new Map<keyof TextStyle, HTMLElement>();
  section.append(heading);
  function add(key: keyof TextStyle, type: string, bounds?: [number, number, number]) {
    const wrapper = doc.createElement('label'), label = doc.createElement('span');
    const field = type === 'textarea' ? doc.createElement('textarea') : doc.createElement('input');
    if (field instanceof HTMLInputElement) {
      field.type = type;
      if (bounds) { field.min = String(bounds[0]); field.max = String(bounds[1]); field.step = String(bounds[2]); }
    } else { field.rows = 4; field.maxLength = 1000; wrapper.className = 'text-content-field'; }
    field.dataset.textKey = key; wrapper.append(label, field); section.append(wrapper); fields.set(key, field); labels.set(key, label);
  }
  add('content', 'textarea'); add('fontSize', 'number', [10, 48, 1]); add('wrapWidth', 'number', [80, 640, 1]);
  add('bold', 'checkbox'); add('italic', 'checkbox'); add('background', 'checkbox'); add('backgroundColor', 'color');
  add('backgroundOpacity', 'number', [0, 1, .01]); add('border', 'checkbox'); add('borderColor', 'color');
  const hint = doc.createElement('p'), error = doc.createElement('p');
  hint.className = 'settings-hint'; error.className = 'text-error'; error.setAttribute('role', 'status'); section.append(hint, error);
  let renderedId: string | null = null, signature = '', committing = false;
  function refresh(): void {
    if (committing) return;
    const selected = options.getSelection(), config = selected?.kind === 'text' ? selected.text : undefined;
    section.hidden = !config;
    if (!config || !selected) { renderedId = null; signature = ''; return; }
    const text = messages[getLocale()], changedSelection = renderedId !== selected.id;
    const next = `${selected.id}:${JSON.stringify(config)}`;
    heading.textContent = text.title; hint.textContent = text.hint;
    for (const [key, field] of fields) {
      labels.get(key)!.textContent = text[key]; field.setAttribute('aria-label', text[key]);
      if (changedSelection || signature !== next) {
        if (flags.has(key)) (field as HTMLInputElement).checked = config[key] as boolean;
        else field.value = String(config[key]);
        field.removeAttribute('aria-invalid');
      }
    }
    renderedId = selected.id; signature = next;
    error.textContent = section.querySelector('[aria-invalid="true"]') ? text.invalid : '';
  }
  function commit(field: Field): void {
    const key = field.dataset.textKey as keyof TextStyle | undefined, selected = options.getSelection();
    if (committing || !key || fields.get(key) !== field || selected?.id !== renderedId || selected.kind !== 'text' || !selected.text) return;
    const config = { ...selected.text };
    if (flags.has(key)) Object.assign(config, { [key]: (field as HTMLInputElement).checked });
    else if (numbers.has(key)) Object.assign(config, { [key]: (field as HTMLInputElement).valueAsNumber });
    else Object.assign(config, { [key]: key === 'content' ? field.value.replace(/\r\n?/g, '\n') : field.value });
    const valid = validTextStyle(config); field.setAttribute('aria-invalid', String(!valid));
    error.textContent = section.querySelector('[aria-invalid="true"]') ? messages[getLocale()].invalid : '';
    if (!valid || JSON.stringify(config) === JSON.stringify(selected.text)) return;
    committing = true;
    try { options.onChange(config); } finally { committing = false; }
    const current = options.getSelection(); signature = `${current?.id}:${JSON.stringify(current?.text)}`;
  }
  section.addEventListener('change', event => commit(event.target as Field), listener);
  section.addEventListener('focusout', event => commit(event.target as Field), listener);
  section.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const field = event.target as Field;
    if (event.key === 'Enter' && (field.type === 'number' || (field.tagName === 'TEXTAREA' && (event.ctrlKey || event.metaKey)))) {
      event.preventDefault(); commit(field);
    }
  }, listener);
  return { refresh, focus() { refresh(); if (!section.hidden) { const field = fields.get('content') as HTMLTextAreaElement; field.focus({ preventScroll: true }); field.select(); } },
    dispose() { events.abort(); section.remove(); } };
}
