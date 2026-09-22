import type { Locale } from '../../ui/i18n';
import { analysisCatalog, indicatorTitle } from './catalog';
import { studyKind, studySettings, updateStudy, type StudyId, type IndicatorState, type AverageSettings } from './model';

interface SettingsOptions {
  id: StudyId;
  locale: Locale;
  getState(): IndicatorState;
  onChange(next: IndicatorState): void;
  onBack(): void;
}

const labels = {
  en: {
    back: 'Back to indicators', period: 'Period', color: 'Line color', width: 'Line width',
    upColor: 'Rising-bar color', downColor: 'Falling-bar color', opacity: 'Opacity',
    fastPeriod: 'Fast EMA period', slowPeriod: 'Slow EMA period', signalPeriod: 'Signal EMA period',
    lineColor: 'MACD line', signalColor: 'Signal line', positiveColor: 'Positive histogram', negativeColor: 'Negative histogram',
    upper: 'Upper reference level', lower: 'Lower reference level', showLevels: 'Show reference levels',
    multiplier: 'Standard deviation multiplier', basisColor: 'Basis line', upperColor: 'Upper band', lowerColor: 'Lower band',
    fillColor: 'Band fill color', fillOpacity: 'Band fill opacity', showFill: 'Show band fill',
    bbInvalid: 'Use a whole-number period from 1 to 500, a multiplier from 0.1 to 10, line width from 1 to 4, and fill opacity from 0% to 100%.',
    levelsHint: 'Reference levels change the display only; they do not affect RSI calculation.',
    apply: 'Apply settings', hint: 'Changes apply only to this indicator.',
    invalid: 'Use a whole-number period from 1 to 500, line width from 1 to 4, and opacity from 10% to 100%.',
    macdOrder: 'The fast period must be smaller than the slow period. All periods must be whole numbers from 1 to 500.',
    rsiLevels: 'Reference levels must satisfy 0 ≤ lower < upper ≤ 100.',
    saved: 'Settings applied.',
  },
  'zh-CN': {
    back: '返回指标列表', period: '周期', color: '线条颜色', width: '线宽',
    upColor: '上涨柱颜色', downColor: '下跌柱颜色', opacity: '不透明度',
    fastPeriod: '快 EMA 周期', slowPeriod: '慢 EMA 周期', signalPeriod: '信号 EMA 周期',
    lineColor: 'MACD 主线', signalColor: '信号线', positiveColor: '正值柱颜色', negativeColor: '负值柱颜色',
    upper: '上参考线', lower: '下参考线', showLevels: '显示参考线',
    multiplier: '标准差倍数', basisColor: '中轨颜色', upperColor: '上轨颜色', lowerColor: '下轨颜色',
    fillColor: '带状填充颜色', fillOpacity: '带状填充不透明度', showFill: '显示带状填充',
    bbInvalid: '周期须为 1 至 500 的整数，标准差倍数为 0.1 至 10，线宽为 1 至 4，填充不透明度为 0% 至 100%。',
    levelsHint: '参考线仅影响显示，不改变 RSI 的计算结果。',
    apply: '应用设置', hint: '修改仅应用于当前指标。',
    invalid: '周期须为 1 至 500 的整数，线宽为 1 至 4，不透明度为 10% 至 100%。',
    macdOrder: '快周期必须小于慢周期，各周期须为 1 至 500 的整数。',
    rsiLevels: '参考线须满足 0 ≤ 下参考线 < 上参考线 ≤ 100。',
    saved: '设置已应用。',
  },
};

export function createSettingsForm(options: SettingsOptions): HTMLFormElement {
  const { id, locale } = options;
  const text = labels[locale];
  const state = options.getState();
  const kind = studyKind(state, id);
  const selected = studySettings(state, id) as AverageSettings;
  const form = document.createElement('form');
  form.className = 'indicator-settings';
  form.noValidate = true;
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'indicator-settings-back'; back.textContent = `‹ ${text.back}`;
  back.addEventListener('click', options.onBack);
  const title = document.createElement('h3');
  const name = analysisCatalog.find(entry => entry.id === kind)!.title[locale];
  title.textContent = indicatorTitle(id, state, locale);
  const hint = document.createElement('p'); hint.className = 'analysis-hint'; hint.textContent = text.hint;
  const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
  const inputs = new Map<string, HTMLInputElement>();
  const status = document.createElement('p'); status.className = 'indicator-settings-status'; status.setAttribute('role', 'status');
  type SettingField = 'period' | 'color' | 'width' | 'upColor' | 'downColor' | 'opacity' | 'fastPeriod' | 'slowPeriod'
    | 'signalPeriod' | 'lineColor' | 'signalColor' | 'positiveColor' | 'negativeColor' | 'upper' | 'lower' | 'showLevels'
    | 'multiplier' | 'basisColor' | 'upperColor' | 'lowerColor' | 'fillColor' | 'fillOpacity' | 'showFill';
  function field(key: SettingField, type: string, value: string | number | boolean, min?: number, max?: number, step?: number) {
    const label = document.createElement('label');
    const caption = document.createElement('span'); caption.textContent = text[key];
    const control = document.createElement('span'); control.className = 'indicator-setting-control';
    const input = document.createElement('input'); input.type = type; input.name = key;
    input.id = `indicator-${id}-${key}`; input.dataset.indicatorSetting = key;
    if (type === 'checkbox') input.checked = Boolean(value);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    input.value = String(value);
    control.append(input);
    const output = document.createElement('output');
    output.setAttribute('for', input.id);
    const showValue = () => { output.value = key === 'opacity' || key === 'fillOpacity'
      ? `${Math.round(Number(input.value) * 100)}%` : `${input.value} px`; };
    if (type === 'range') { showValue(); control.append(output); }
    input.addEventListener('input', () => {
      status.textContent = ''; status.classList.remove('is-error');
      if (type === 'range') showValue();
      if (id === 'bb' && (key === 'period' || key === 'multiplier')) {
        const draft = updateStudy(state, id, { period: Number(inputs.get('period')?.value || NaN),
          multiplier: Number(inputs.get('multiplier')?.value || NaN) });
        if (draft) title.textContent = indicatorTitle(id, draft, locale);
      } else if (key === 'period' && input.validity.valid && input.value) title.textContent = `${name} ${input.value}`;
    });
    label.append(caption, control); fields.append(label); inputs.set(key, input);
  }
  if (id === 'volume') {
    field('upColor', 'color', state.volume.upColor);
    field('downColor', 'color', state.volume.downColor);
    field('opacity', 'range', state.volume.opacity, .1, 1, .1);
  } else if (id === 'macd') {
    const settings = state.macd;
    field('fastPeriod', 'number', settings.fastPeriod, 1, 500, 1);
    field('slowPeriod', 'number', settings.slowPeriod, 1, 500, 1);
    field('signalPeriod', 'number', settings.signalPeriod, 1, 500, 1);
    for (const key of ['lineColor', 'signalColor', 'positiveColor', 'negativeColor'] as const) field(key, 'color', settings[key]);
    field('width', 'range', settings.width, 1, 4, 1);
  } else if (id === 'bb') {
    const settings = state.bb;
    field('period', 'number', settings.period, 1, 500, 1);
    field('multiplier', 'number', settings.multiplier, .1, 10, .1);
    for (const key of ['basisColor', 'upperColor', 'lowerColor', 'fillColor'] as const) field(key, 'color', settings[key]);
    field('width', 'range', settings.width, 1, 4, 1);
    field('showFill', 'checkbox', settings.showFill);
    field('fillOpacity', 'range', settings.fillOpacity, 0, 1, .01);
  } else {
    field('period', 'number', selected.period, 1, 500, 1);
    field('color', 'color', selected.color);
    field('width', 'range', selected.width, 1, 4, 1);
    if (id === 'rsi') {
      field('lower', 'number', state.rsi.lower, 0, 100, .1);
      field('upper', 'number', state.rsi.upper, 0, 100, .1);
      field('showLevels', 'checkbox', state.rsi.showLevels);
    }
  }
  const apply = document.createElement('button');
  apply.type = 'submit'; apply.className = 'analysis-action indicator-settings-apply'; apply.textContent = text.apply;
  form.append(back, title, hint, fields);
  if (id === 'rsi') {
    const note = document.createElement('p'); note.className = 'analysis-hint'; note.textContent = text.levelsHint; form.append(note);
  }
  form.append(apply, status);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const latest = options.getState();
    const values = Object.fromEntries([...inputs].map(([key, input]) => [key,
      input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range'
        ? (input.value.trim() ? Number(input.value) : NaN) : input.value]));
    const next = updateStudy(latest, id, values);
    if (!next) {
      const invalidOrder = id === 'macd' && Number(values.fastPeriod) >= Number(values.slowPeriod);
      const invalidLevels = id === 'rsi' && (!Number.isFinite(values.lower) || !Number.isFinite(values.upper)
        || Number(values.lower) < 0 || Number(values.upper) > 100 || Number(values.lower) >= Number(values.upper));
      status.textContent = invalidOrder ? text.macdOrder : invalidLevels ? text.rsiLevels : id === 'bb' ? text.bbInvalid : text.invalid;
      status.classList.add('is-error');
      inputs.get(invalidLevels ? 'lower' : id === 'macd' ? 'fastPeriod' : 'period')?.focus();
      return;
    }
    options.onChange(next);
    title.textContent = indicatorTitle(id, next, locale);
    status.textContent = text.saved; status.classList.remove('is-error');
  });
  return form;
}
