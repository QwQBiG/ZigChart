import { getLocale, t, type Locale, type MessageKey as SharedMessageKey } from '../../ui/i18n';
import { appearanceForTheme, parseAppearance, type Appearance } from './model';
import { DEFAULT_SERIES_STYLE, isCloseSeries, parseSeriesStyle, type SeriesStyle, type SeriesType } from '../series/model';
import { createBaselineFields } from '../series/baseline-fields';
import { DEFAULT_SCALES, parseScales, type ScalePreferences } from '../scales/model';
import { createScaleFields } from '../scales/fields';
import './panel.css';

interface AppearancePanelOptions {
  getPriceScale(): number;
  getState(): Appearance;
  getSeriesState(): SeriesStyle;
  getScaleState(): ScalePreferences;
  onApply(next: Appearance, series: SeriesStyle, scales: ScalePreferences): void;
  onClose?(): void;
  refreshControls?(): void;
}

const english = {
  title: 'Chart settings', close: 'Close chart settings', categories: 'Settings categories',
  symbol: 'Symbol', canvas: 'Canvas', scales: 'Scales',
  showBody: 'Body', showBorder: 'Border', showWick: 'Wick', rising: 'Rising', falling: 'Falling',
  barColors: 'Colors',
  theme: 'Theme', dark: 'Dark', light: 'Light', backgroundColor: 'Background', gridColor: 'Grid color',
  showGrid: 'Show grid', showLastPrice: 'Show last price',
  defaults: 'Restore defaults', cancel: 'Cancel', apply: 'Apply',
  draftHint: 'Changes take effect when you apply them.',
};
type MessageKey = keyof typeof english;
const messages: Record<Locale, Record<MessageKey, string>> = {
  en: english,
  'zh-CN': {
    title: '图表设置', close: '关闭图表设置', categories: '设置分类',
    symbol: '商品代码', canvas: '版面', scales: '坐标轴',
    showBody: '主体', showBorder: '边框', showWick: '影线', rising: '上涨', falling: '下跌',
    barColors: '颜色',
    theme: '主题', dark: '深色', light: '浅色', backgroundColor: '背景', gridColor: '网格颜色',
    showGrid: '显示网格', showLastPrice: '显示末价线',
    defaults: '恢复默认', cancel: '取消', apply: '应用',
    draftHint: '点击应用后保存并生效。',
  },
};
type Category = 'symbol' | 'scales' | 'canvas';
const categories: readonly Category[] = ['symbol', 'scales', 'canvas'];
type ColorKey = 'upColor' | 'downColor' | 'borderUpColor' | 'borderDownColor' | 'wickUpColor' | 'wickDownColor' | 'backgroundColor' | 'gridColor';
type ToggleKey = 'showBody' | 'showBorder' | 'showWick' | 'showGrid' | 'showLastPrice';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createAppearancePanel(options: AppearancePanelOptions) {
  let draft = { ...options.getState() };
  let seriesDraft = { ...options.getSeriesState() };
  let scaleDraft = { ...options.getScaleState() };
  let category: Category = 'symbol';
  let restoreFocus: HTMLElement | null = null;
  let disposed = false;
  const localized: Array<[HTMLElement, MessageKey]> = [];
  const colors = new Map<ColorKey, HTMLInputElement>();
  const toggles = new Map<ToggleKey, HTMLInputElement>();
  const selects = new Map<'theme', HTMLSelectElement>();
  const tabs = new Map<Category, HTMLButtonElement>();
  const sections = new Map<Category, HTMLElement>();
  function label<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, key: MessageKey) {
    const node = element(tag, className);
    localized.push([node, key]);
    return node;
  }
  function button(className: string, key: MessageKey) {
    const node = label('button', className, key);
    node.type = 'button';
    return node;
  }
  const dialog = element('dialog', 'appearance-dialog');
  dialog.id = 'appearance-dialog';
  dialog.setAttribute('aria-labelledby', 'appearance-title');
  const header = element('header', 'appearance-header');
  const title = label('h2', '', 'title');
  title.id = 'appearance-title';
  const close = element('button', 'appearance-close', '×');
  close.type = 'button';
  header.append(title, close);
  const body = element('div', 'appearance-body');
  const navigation = element('div', 'appearance-navigation');
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-orientation', 'vertical');
  const content = element('div', 'appearance-content');
  for (const id of categories) {
    const tab = button('appearance-category', id);
    tab.id = `appearance-category-${id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `appearance-section-${id}`);
    tab.addEventListener('click', () => { category = id; render(); });
    const section = element('section', 'appearance-section');
    section.id = `appearance-section-${id}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', tab.id);
    tabs.set(id, tab); sections.set(id, section);
    navigation.append(tab); content.append(section);
  }
  body.append(navigation, content);
  const footer = element('footer', 'appearance-footer');
  const defaults = button('appearance-button', 'defaults');
  const cancel = button('appearance-button', 'cancel');
  const apply = button('appearance-button appearance-apply', 'apply');
  const actions = element('div', 'appearance-actions');
  actions.append(cancel, apply); footer.append(defaults, actions);
  dialog.append(header, body, footer);
  document.body.append(dialog);
  function color(key: ColorKey) {
    const input = element('input', 'appearance-color');
    input.type = 'color'; input.dataset.appearanceDraft = key;
    input.addEventListener('input', () => { draft[key] = input.value; });
    colors.set(key, input);
    return input;
  }
  function toggle(key: ToggleKey) {
    const control = element('label', 'appearance-toggle');
    const input = element('input', '');
    input.type = 'checkbox'; input.dataset.appearanceDraft = key;
    input.addEventListener('change', () => { draft[key] = input.checked; renderValues(); });
    control.append(input, label('span', '', key));
    toggles.set(key, input);
    return control;
  }
  function select(key: 'theme', values: readonly string[]) {
    const row = element('label', 'appearance-row');
    row.append(label('span', '', key));
    const input = element('select', '');
    input.dataset.appearanceDraft = key;
    for (const value of values) {
      const option = label('option', '', value as MessageKey);
      option.value = value; input.append(option);
    }
    input.addEventListener('change', () => {
      const palette = appearanceForTheme(input.value as Appearance['theme']);
      draft = { ...draft, ...palette, showBody: draft.showBody, showBorder: draft.showBorder,
        showWick: draft.showWick, showGrid: draft.showGrid, showLastPrice: draft.showLastPrice,
        candleStyle: draft.candleStyle };
      renderValues();
    });
    selects.set(key, input); row.append(input);
    return row;
  }
  const symbol = sections.get('symbol')!;
  const seriesHeading = element('h3', '');
  const seriesHint = element('p', 'appearance-hint');
  const candleFields = element('div', 'appearance-series-fields');
  const candleRowElements = new Map<ToggleKey, HTMLElement>();
  symbol.append(seriesHeading, seriesHint, candleFields);
  const headings = element('div', 'appearance-color-headings');
  headings.append(label('span', '', 'rising'), label('span', '', 'falling'));
  candleFields.append(headings);
  const candleRows: ReadonlyArray<readonly [ToggleKey, ColorKey, ColorKey]> = [
    ['showBody', 'upColor', 'downColor'], ['showBorder', 'borderUpColor', 'borderDownColor'],
    ['showWick', 'wickUpColor', 'wickDownColor'],
  ];
  for (const [enabled, rising, falling] of candleRows) {
    const row = element('div', 'appearance-row');
    const pair = element('div', 'appearance-color-pair');
    pair.append(color(rising), color(falling)); row.append(toggle(enabled), pair);
    candleRowElements.set(enabled, row);
    candleFields.append(row);
  }
  const lineFields = element('div', 'appearance-series-fields');
  symbol.append(lineFields);
  type SeriesField = 'lineColor' | 'lineWidth' | 'lineType' | 'areaTopColor' | 'areaBottomColor';
  const seriesInputs = new Map<SeriesField, HTMLInputElement | HTMLSelectElement>();
  const seriesLabels: Array<[HTMLElement, SharedMessageKey]> = [];
  function seriesField(key: SeriesField, caption: SharedMessageKey, values?: readonly string[]) {
    const row = element('label', 'appearance-row');
    const name = element('span', '');
    seriesLabels.push([name, caption]);
    const input = values ? element('select', '') : element('input', 'appearance-color');
    input.dataset.seriesDraft = key;
    if (input instanceof HTMLInputElement) input.type = 'color';
    else for (const value of values!) {
      const option = element('option', '', key === 'lineWidth' ? `${value} px` : '');
      option.value = value;
      if (key === 'lineType') seriesLabels.push([option, value === 'simple' ? 'seriesSimpleLine' : 'seriesStepLine']);
      input.append(option);
    }
    input.addEventListener('input', () => {
      seriesDraft = parseSeriesStyle({ ...seriesDraft, [key]: key === 'lineWidth' ? Number(input.value) : input.value });
    });
    seriesInputs.set(key, input); row.append(name, input);
    return row;
  }
  const lineColorField = seriesField('lineColor', 'seriesLineColor');
  lineFields.append(lineColorField,
    seriesField('lineWidth', 'seriesLineWidth', ['1', '2', '3', '4']),
    seriesField('lineType', 'seriesLineType', ['simple', 'step']));
  const areaFields = element('div', 'appearance-series-fields');
  areaFields.append(seriesField('areaTopColor', 'seriesAreaTopColor'), seriesField('areaBottomColor', 'seriesAreaBottomColor'));
  lineFields.append(areaFields);
  const baselineContainer = element('div', 'appearance-series-fields'); lineFields.append(baselineContainer);
  const baselineFields = createBaselineFields(baselineContainer, options.getPriceScale, update => {
    seriesDraft = parseSeriesStyle({ ...seriesDraft, ...update });
  });
  const seriesNames: Record<SeriesType, SharedMessageKey> = {
    candles: 'seriesCandles', hollow: 'seriesHollow', bars: 'seriesBars', line: 'seriesLine', area: 'seriesArea', baseline: 'seriesBaseline',
  };
  const seriesHints: Record<SeriesType, SharedMessageKey> = {
    candles: 'seriesCandlesHelp', hollow: 'seriesCandlesHelp', bars: 'seriesBarsHelp', line: 'seriesLineHelp', area: 'seriesAreaHelp', baseline: 'seriesBaselineHelp',
  };
  const canvas = sections.get('canvas')!;
  canvas.append(select('theme', ['dark', 'light']));
  for (const key of ['backgroundColor', 'gridColor'] as const) {
    const row = element('label', 'appearance-row');
    row.append(label('span', '', key), color(key)); canvas.append(row);
  }
  canvas.append(toggle('showGrid'), toggle('showLastPrice'));
  const scaleFields = createScaleFields(sections.get('scales')!, value => { scaleDraft = value; });
  for (const section of sections.values()) section.append(label('p', 'appearance-hint', 'draftHint'));

  function renderValues() {
    scaleFields.refresh(scaleDraft);
    const isLine = isCloseSeries(seriesDraft.type);
    const isBars = seriesDraft.type === 'bars';
    candleFields.hidden = isLine; lineFields.hidden = !isLine;
    areaFields.hidden = seriesDraft.type !== 'area';
    lineColorField.hidden = seriesDraft.type === 'baseline';
    baselineFields.refresh(seriesDraft);
    seriesHeading.textContent = t(seriesNames[seriesDraft.type]);
    seriesHint.textContent = t(seriesHints[seriesDraft.type]);
    for (const [node, key] of seriesLabels) node.textContent = t(key);
    for (const [key, input] of seriesInputs) input.value = String(seriesDraft[key]);
    for (const [enabled, row] of candleRowElements) row.hidden = isBars && enabled !== 'showBody';
    const bodyToggle = toggles.get('showBody')!;
    bodyToggle.hidden = isBars;
    bodyToggle.nextElementSibling!.textContent = messages[getLocale()][isBars ? 'barColors' : 'showBody'];
    for (const [key, input] of colors) input.value = draft[key];
    for (const [key, input] of toggles) input.checked = draft[key];
    for (const [key, input] of selects) input.value = draft[key];
    for (const [enabled, rising, falling] of candleRows) {
      colors.get(rising)!.disabled = colors.get(falling)!.disabled = !(isBars || draft[enabled]);
    }
    colors.get('gridColor')!.disabled = !draft.showGrid;
    options.refreshControls?.();
  }
  function render() {
    const text = messages[getLocale()];
    for (const [node, key] of localized) node.textContent = text[key];
    close.setAttribute('aria-label', text.close);
    navigation.setAttribute('aria-label', text.categories);
    for (const [enabled, rising, falling] of candleRows) {
      const name = seriesDraft.type === 'bars' && enabled === 'showBody' ? text.barColors : text[enabled];
      colors.get(rising)!.setAttribute('aria-label', `${name} · ${text.rising}`);
      colors.get(falling)!.setAttribute('aria-label', `${name} · ${text.falling}`);
    }
    for (const [id, tab] of tabs) {
      tab.setAttribute('aria-selected', String(id === category));
      tab.tabIndex = id === category ? 0 : -1;
      sections.get(id)!.hidden = id !== category;
    }
    renderValues();
  }
  navigation.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? -1 : 1;
    category = event.key === 'Home' ? 'symbol' : event.key === 'End' ? 'canvas'
      : categories[(categories.indexOf(category) + step + categories.length) % categories.length];
    render(); tabs.get(category)?.focus();
  });
  close.addEventListener('click', () => dialog.close());
  cancel.addEventListener('click', () => dialog.close());
  defaults.addEventListener('click', () => {
    draft = appearanceForTheme(draft.theme);
    seriesDraft = { ...DEFAULT_SERIES_STYLE, type: seriesDraft.type };
    scaleDraft = { ...DEFAULT_SCALES };
    renderValues();
  });
  apply.addEventListener('click', () => {
    if (!baselineFields.validate()) return;
    options.onApply(parseAppearance(draft), parseSeriesStyle(seriesDraft), parseScales(scaleDraft)); dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (disposed) return;
    options.onClose?.();
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
  });
  render();
  return {
    open(initialCategory: Category = 'symbol') {
      if (dialog.open) return;
      draft = { ...options.getState() }; category = initialCategory;
      seriesDraft = { ...options.getSeriesState() };
      scaleDraft = { ...options.getScaleState() };
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render(); dialog.showModal(); tabs.get(category)?.focus();
    },
    close() { if (dialog.open) dialog.close(); },
    refresh() {
      if (!dialog.open) {
        draft = { ...options.getState() };
        seriesDraft = { ...options.getSeriesState() };
        scaleDraft = { ...options.getScaleState() };
      }
      render();
    },
    dispose() { disposed = true; dialog.close(); dialog.remove(); },
  };
}
