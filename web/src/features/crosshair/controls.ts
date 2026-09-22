import { getLocale, type Locale } from '../../ui/i18n';
import { CROSSHAIR_MODES, DEFAULT_CROSSHAIR_STYLE, parseCrosshairStyle, type CrosshairStyle } from './model';

interface CrosshairControlOptions {
  trigger: HTMLElement;
  getState(): CrosshairStyle;
  onChange(next: CrosshairStyle): void;
  onClose?(): void;
  refreshControls?(): void;
}
const english = {
  title: 'Crosshair settings', close: 'Close crosshair settings', mode: 'Mode',
  normal: 'Free movement', magnet: 'Snap to close', hidden: 'Hidden', magnetOHLC: 'Snap to nearest OHLC',
  color: 'Color', width: 'Width', lineStyle: 'Line style', solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted',
  vertical: 'Vertical line', horizontal: 'Horizontal line', apply: 'Apply', cancel: 'Cancel', defaults: 'Restore defaults',
  normalHint: 'Default. The crosshair follows the pointer freely; the candle readout still follows the bar under the pointer.',
  magnetHint: 'Snap to close for both rising and falling candles, volume in its pane, or the nearest indicator value in an oscillator pane.',
  hiddenHint: 'Hide the crosshair while keeping candle readouts available.',
  magnetOHLCHint: 'Snap to the nearest open, high, low or close. Line, area and baseline use close; auxiliary panes use their nearest indicator value.',
  draftHint: 'Apply saves these settings. Cancel or Escape discards changes.',
};
type TextKey = keyof typeof english;
const messages: Record<Locale, Record<TextKey, string>> = {
  en: english,
  'zh-CN': {
    title: '十字线设置', close: '关闭十字线设置', mode: '模式',
    normal: '自由移动', magnet: '吸附收盘价', hidden: '隐藏', magnetOHLC: '吸附最近开高低收',
    color: '颜色', width: '线宽', lineStyle: '线型', solid: '实线', dashed: '虚线', dotted: '点线',
    vertical: '垂直线', horizontal: '水平线', apply: '应用', cancel: '取消', defaults: '恢复默认',
    normalHint: '默认模式。十字线跟随光标自由移动；行情读数仍对应指针所在的 K 线。',
    magnetHint: '上涨和下跌蜡烛均吸附收盘价；成交量副图吸附成交量，振荡指标副图吸附最近指标值。',
    hiddenHint: '隐藏十字线，同时保留 K 线行情读数。',
    magnetOHLCHint: '吸附最近的开盘、最高、最低或收盘价。折线、面积与基准线图使用收盘价，副图使用各自最近的指标值。',
    draftHint: '点击应用保存设置，取消或按 Esc 丢弃修改。',
  },
};

export function createCrosshairControls(container: HTMLElement, options: CrosshairControlOptions) {
  let draft = { ...options.getState() }, disposed = false;
  let restoreFocus: HTMLElement | null = null;
  const localized: Array<[HTMLElement, TextKey]> = [];
  const inputs = new Map<keyof CrosshairStyle, HTMLInputElement | HTMLSelectElement>();
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', key?: TextKey): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag); value.className = className;
    if (key) localized.push([value, key]);
    return value;
  }
  function button(key: TextKey, className = '') {
    const value = node('button', className, key); value.type = 'button'; return value;
  }
  const dialog = node('dialog', 'crosshair-dialog');
  dialog.id = 'crosshair-dialog'; dialog.setAttribute('aria-labelledby', 'crosshair-title');
  const header = node('header', 'crosshair-header');
  const title = node('h2', '', 'title'); title.id = 'crosshair-title';
  const close = node('button', 'crosshair-close'); close.type = 'button'; close.textContent = '×';
  header.append(title, close);
  const body = node('div', 'crosshair-body');
  function select(key: 'mode' | 'width' | 'lineStyle', values: readonly string[]) {
    const row = node('label', 'crosshair-field'); row.append(node('span', '', key));
    const input = node('select'); input.dataset.crosshairDraft = key;
    for (const value of values) {
      const option = key === 'width' ? node('option') : node('option', '', value as TextKey);
      option.value = value;
      if (key === 'width') option.textContent = `${value} px`;
      input.append(option);
    }
    input.addEventListener('change', () => {
      draft = parseCrosshairStyle({ ...draft, [key]: key === 'width' ? Number(input.value) : input.value }); render();
    });
    inputs.set(key, input); row.append(input); body.append(row);
  }
  select('mode', CROSSHAIR_MODES);
  const hint = node('p', 'crosshair-hint'); body.append(hint);
  const colorRow = node('label', 'crosshair-field'); colorRow.append(node('span', '', 'color'));
  const color = node('input', 'crosshair-color'); color.type = 'color'; color.dataset.crosshairDraft = 'color';
  color.addEventListener('input', () => { draft.color = color.value; });
  inputs.set('color', color); colorRow.append(color); body.append(colorRow);
  select('width', ['1', '2', '3']); select('lineStyle', ['solid', 'dashed', 'dotted']);
  for (const key of ['vertical', 'horizontal'] as const) {
    const row = node('label', 'crosshair-toggle'); const input = node('input');
    input.type = 'checkbox'; input.dataset.crosshairDraft = key;
    input.addEventListener('change', () => { draft[key] = input.checked; });
    inputs.set(key, input); row.append(input, node('span', '', key)); body.append(row);
  }
  body.append(node('p', 'crosshair-hint', 'draftHint'));
  const footer = node('footer', 'crosshair-footer'); const actions = node('div', 'crosshair-actions');
  const defaults = button('defaults'), cancel = button('cancel'), apply = button('apply', 'crosshair-apply');
  actions.append(cancel, apply); footer.append(defaults, actions);
  dialog.append(header, body, footer); container.append(dialog);
  function render() {
    const text = messages[getLocale()];
    const label = `${text.title} · ${text[options.getState().mode]}`;
    options.trigger.title = label;
    options.trigger.setAttribute('aria-label', label);
    for (const [target, key] of localized) target.textContent = text[key];
    close.setAttribute('aria-label', text.close);
    hint.textContent = text[`${draft.mode}Hint` as TextKey];
    for (const [key, input] of inputs) {
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = draft[key] as boolean;
      else input.value = String(draft[key]);
    }
    options.refreshControls?.();
  }
  close.addEventListener('click', () => dialog.close()); cancel.addEventListener('click', () => dialog.close());
  defaults.addEventListener('click', () => { draft = { ...DEFAULT_CROSSHAIR_STYLE }; render(); });
  apply.addEventListener('click', () => { options.onChange(parseCrosshairStyle(draft)); render(); dialog.close(); });
  dialog.addEventListener('close', () => {
    if (disposed) return;
    options.onClose?.();
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
  });
  render();
  return {
    open() {
      if (disposed || dialog.open) return;
      draft = { ...options.getState() };
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render(); dialog.showModal();
      const mode = inputs.get('mode');
      const trigger = mode?.parentElement?.querySelector<HTMLElement>('[role="combobox"]');
      (trigger ?? mode)?.focus();
    },
    refresh() { if (!dialog.open) draft = { ...options.getState() }; render(); },
    dispose() { disposed = true; dialog.close(); dialog.remove(); },
  };
}
