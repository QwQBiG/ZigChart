import { getLocale, type Locale } from '../../ui/i18n';
import { analysisCategories, indicatorTitle, searchAnalysis, type AnalysisCategory, type IndicatorGroup } from './catalog';
import { addAverage, isExtraAverage, setIndicatorEnabled, type IndicatorId, type IndicatorState, type StudyId } from './model';
import { createSettingsForm } from './settings';
import './panel.css';

interface AnalysisLibraryOptions {
  getState(): IndicatorState;
  onChange(next: IndicatorState): void;
}

const messages = {
  en: {
    title: 'Indicators, strategies & scripts', close: 'Close analysis library',
    search: 'Search indicators in English or Chinese', placeholder: 'Search indicators…',
    categories: 'Analysis categories', indicators: 'Indicators', strategies: 'Strategies', scripts: 'Scripts',
    heading: 'Built-in indicators', hint: 'Add overlays to the price chart or use a dedicated pane.',
    trend: 'Trend', volatility: 'Volatility', volume: 'Volume', oscillators: 'Oscillators',
    price: 'Price chart', pane: 'Separate pane', add: 'Add', remove: 'Remove', settings: 'Settings',
    addAnother: 'Add another', additional: 'Additional averages', limit: 'Six additional averages maximum',
    noResults: 'No matching indicators', tryAgain: 'Try MA, EMA, BB, Volume, RSI or MACD. You can search in either language.',
    strategyTitle: 'Strategies', scriptTitle: 'My scripts', planned: 'Planned',
    strategyDescription: 'This is the home for future strategy definitions and results. Strategy execution and backtesting are not available yet.',
    scriptDescription: 'This is the home for future personal indicators and Python scripts. A script editor and execution runtime are not available yet.',
  },
  'zh-CN': {
    title: '指标、策略与脚本', close: '关闭分析库',
    search: '使用中文或英文搜索指标', placeholder: '搜索指标…',
    categories: '分析分类', indicators: '指标', strategies: '策略', scripts: '脚本',
    heading: '内置技术指标', hint: '在主图叠加指标，或使用独立副图。',
    trend: '趋势', volatility: '波动率', volume: '成交量', oscillators: '振荡指标',
    price: '主图叠加', pane: '独立副图', add: '添加', remove: '移除', settings: '设置',
    addAnother: '再添加一条', additional: '额外均线实例', limit: '最多添加六条额外均线',
    noResults: '未找到匹配指标', tryAgain: '试试 MA、EMA、BB、成交量、RSI 或 MACD，中英文都可以搜索。',
    strategyTitle: '策略', scriptTitle: '我的脚本', planned: '规划中',
    strategyDescription: '这里将统一管理策略定义与结果。目前尚未提供策略执行和回测功能。',
    scriptDescription: '这里将统一管理个人指标与 Python 脚本。目前尚未提供脚本编辑器和运行环境。',
  },
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createAnalysisLibrary(options: AnalysisLibraryOptions) {
  const dialog = element('dialog', 'analysis-dialog');
  dialog.id = 'analysis-library';
  dialog.setAttribute('aria-labelledby', 'analysis-title');
  const header = element('header', 'analysis-header');
  const title = element('h2', 'analysis-title');
  title.id = 'analysis-title';
  const close = element('button', 'analysis-close', '×');
  close.type = 'button';
  header.append(title, close);
  const body = element('div', 'analysis-body');
  const navigation = element('div', 'analysis-navigation');
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-orientation', 'vertical');
  const content = element('section', 'analysis-content');
  content.id = 'analysis-content';
  content.setAttribute('role', 'tabpanel');
  const search = element('input', 'analysis-search');
  search.type = 'search';
  search.autocomplete = 'off';
  search.maxLength = 100;
  const results = element('div', 'analysis-results');
  content.append(search, results);
  body.append(navigation, content);
  dialog.append(header, body);
  document.body.append(dialog);
  let category: AnalysisCategory = 'indicators';
  let setting: StudyId | null = null;
  let membership = '';
  let locale: Locale = getLocale();
  const tabs = new Map<AnalysisCategory, HTMLButtonElement>();
  const actions = new Map<IndicatorId, HTMLButtonElement>();
  const settingsButtons = new Map<IndicatorId, HTMLButtonElement>();
  const names = new Map<IndicatorId, HTMLElement>();
  const additionalButtons = new Map<'ma' | 'ema', HTMLButtonElement>();
  for (const id of analysisCategories) {
    const tab = element('button', 'analysis-category');
    tab.id = `analysis-category-${id}`;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', content.id);
    tab.addEventListener('click', () => { category = id; setting = null; render(); });
    navigation.append(tab);
    tabs.set(id, tab);
  }
  navigation.addEventListener('keydown', event => {
    const current = analysisCategories.indexOf(category);
    const next = event.key === 'ArrowDown' ? (current + 1) % 3 : event.key === 'ArrowUp' ? (current + 2) % 3
      : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
    if (next < 0) return;
    event.preventDefault();
    category = analysisCategories[next];
    setting = null;
    render();
    tabs.get(category)?.focus();
  });
  close.addEventListener('click', () => dialog.close());
  search.addEventListener('input', () => renderResults());

  function updateActions() {
    const state = options.getState();
    const text = messages[locale];
    for (const [id, button] of actions) {
      const enabled = state[id].enabled;
      const name = indicatorTitle(id, state, locale);
      names.get(id)!.textContent = name;
      button.textContent = enabled ? text.remove : text.add;
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('is-active', enabled);
      button.setAttribute('aria-label', `${enabled ? text.remove : text.add} ${name}`);
      const settingsButton = settingsButtons.get(id)!;
      settingsButton.disabled = !enabled;
      settingsButton.setAttribute('aria-label', `${text.settings}: ${name}`);
    }
    for (const [id, button] of additionalButtons) {
      button.hidden = !state[id].enabled;
      button.disabled = state.averages.length >= 6;
      button.textContent = text.addAnother;
      button.title = button.disabled ? text.limit : `${text.addAnother} ${id.toUpperCase()}`;
      button.setAttribute('aria-label', button.title);
    }
  }

  function renderResults() {
    const text = messages[locale];
    results.replaceChildren();
    actions.clear();
    settingsButtons.clear();
    names.clear();
    additionalButtons.clear();
    membership = options.getState().averages.map(item => item.id).join(',');
    if (setting) {
      const id = setting;
      results.append(createSettingsForm({
        id, locale, getState: options.getState, onChange: options.onChange,
        onBack: () => { setting = null; render(); if (!isExtraAverage(id)) actions.get(id)?.focus(); },
      }));
      return;
    }
    if (category !== 'indicators') {
      const empty = element('div', 'analysis-empty');
      empty.append(element('span', 'analysis-badge', text.planned),
        element('h3', '', category === 'strategies' ? text.strategyTitle : text.scriptTitle),
        element('p', '', category === 'strategies' ? text.strategyDescription : text.scriptDescription));
      results.append(empty);
      return;
    }
    results.append(element('h3', 'analysis-section-heading', text.heading), element('p', 'analysis-hint', text.hint));
    const entries = searchAnalysis(search.value);
    if (!entries.length) {
      const empty = element('div', 'analysis-empty');
      empty.setAttribute('role', 'status');
      empty.append(element('h3', '', text.noResults), element('p', '', text.tryAgain));
      results.append(empty);
      return;
    }
    const list = element('ul', 'analysis-list');
    let group: IndicatorGroup | null = null;
    for (const entry of entries) {
      if (group !== entry.group) {
        const heading = element('li', 'analysis-group', text[entry.group]);
        heading.setAttribute('role', 'presentation');
        list.append(heading); group = entry.group;
      }
      const item = element('li', 'analysis-item');
      const details = element('div', 'analysis-item-details');
      const name = element('h4', 'analysis-item-name', entry.title[locale]);
      names.set(entry.id, name);
      const description = element('p', 'analysis-item-description', entry.description[locale]);
      details.append(name, description, element('span', 'analysis-placement', text[entry.placement]));
      item.append(details);
      const id = entry.id;
      const controls = element('div', 'analysis-item-actions');
      const action = element('button', 'analysis-action');
      action.type = 'button'; action.dataset.indicator = id;
      action.addEventListener('click', () => {
        const state = options.getState();
        options.onChange(setIndicatorEnabled(state, id, !state[id].enabled));
        updateActions();
      });
      const settingsButton = element('button', 'analysis-action analysis-settings-action', text.settings);
      settingsButton.type = 'button'; settingsButton.dataset.indicatorSettings = id;
      settingsButton.addEventListener('click', () => openSettings(id));
      actions.set(id, action); settingsButtons.set(id, settingsButton);
      controls.append(action, settingsButton);
      if (id === 'ma' || id === 'ema') {
        const another = element('button', 'analysis-action'); another.type = 'button';
        another.addEventListener('click', () => { options.onChange(addAverage(options.getState(), id)); renderResults(); });
        additionalButtons.set(id, another); controls.append(another);
      }
      item.append(controls);
      list.append(item);
    }
    results.append(list);
    const extras = options.getState().averages.filter(item => entries.some(entry => entry.id === item.kind));
    if (extras.length) {
      results.append(element('h3', 'analysis-section-heading', text.additional));
      const active = element('ul', 'analysis-list');
      for (const study of extras) {
        const row = element('li', 'analysis-item');
        row.append(element('h4', 'analysis-item-name', indicatorTitle(study.id, options.getState(), locale)));
        const controls = element('div', 'analysis-item-actions');
        const settings = element('button', 'analysis-action', text.settings); settings.type = 'button';
        settings.setAttribute('aria-label', `${text.settings}: ${indicatorTitle(study.id, options.getState(), locale)}`);
        settings.addEventListener('click', () => openSettings(study.id));
        const remove = element('button', 'analysis-action', text.remove); remove.type = 'button';
        remove.setAttribute('aria-label', `${text.remove} ${indicatorTitle(study.id, options.getState(), locale)}`);
        remove.addEventListener('click', () => {
          options.onChange(setIndicatorEnabled(options.getState(), study.id, false)); renderResults();
        });
        controls.append(settings, remove); row.append(controls); active.append(row);
      }
      results.append(active);
    }
    updateActions();
  }

  function render() {
    locale = getLocale();
    const text = messages[locale];
    title.textContent = text.title;
    close.setAttribute('aria-label', text.close);
    navigation.setAttribute('aria-label', text.categories);
    search.placeholder = text.placeholder;
    search.setAttribute('aria-label', text.search);
    search.hidden = category !== 'indicators' || setting !== null;
    content.setAttribute('aria-labelledby', `analysis-category-${category}`);
    for (const [id, tab] of tabs) {
      tab.textContent = text[id];
      tab.setAttribute('aria-selected', String(id === category));
      tab.tabIndex = id === category ? 0 : -1;
    }
    renderResults();
  }

  render();
  function openSettings(id: StudyId) {
    category = 'indicators'; setting = id; render();
    if (!dialog.open) dialog.showModal();
    results.querySelector('input')?.focus();
  }
  return {
    open() {
      setting = null;
      render();
      if (!dialog.open) dialog.showModal();
      if (category === 'indicators') search.focus();
      else tabs.get(category)?.focus();
    },
    openSettings,
    refresh() {
      if (locale !== getLocale()) render();
      else if (!setting && membership !== options.getState().averages.map(item => item.id).join(',')) renderResults();
      else updateActions();
    },
    dispose() { dialog.close(); dialog.remove(); },
  };
}
