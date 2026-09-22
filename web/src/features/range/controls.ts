import { getLocale } from '../../ui/i18n';
import { RANGE_IDS, type RangeId } from './model';
import type { RangeController } from './controller';
import { createDateNavigation } from './date-navigation';
import './controls.css';

const labels = {
  en: ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'],
  'zh-CN': ['1天', '5天', '1个月', '3个月', '6个月', '今年', '1年', '5年', '全部'],
};
const messages = {
  en: { title: 'Date range · automatically selects candle resolution', loading: 'Loading range…',
    empty: 'No bars are available in this range. Choose another date or return to Latest.',
    partial: 'Only part of the requested history is available.',
    ready: 'Range applied', limited: 'Widen the chart to see the full range at readable spacing.', error: 'Could not load the full range. Select it again to retry.' },
  'zh-CN': { title: '时间范围 · 自动选择 K 线周期', loading: '正在加载范围…',
    empty: '该范围没有可用 K 线，请选择其他日期或返回最新。', partial: '仅有部分所选历史可用。',
    ready: '已应用范围', limited: '请加宽图表，以清晰间距查看完整范围。', error: '未能加载完整范围，可再次选择重试。' },
};

export function createRangeControls(container: HTMLElement, controller: RangeController, ready: () => boolean) {
  container.classList.add('range-toolbar');
  const group = document.createElement('div'); group.className = 'range-buttons'; group.setAttribute('role', 'group');
  const status = document.createElement('span'); status.className = 'range-status'; status.setAttribute('role', 'status');
  const buttons = new Map<RangeId, HTMLButtonElement>();
  for (const id of RANGE_IDS) {
    const button = document.createElement('button'); button.type = 'button';
    button.addEventListener('click', () => { void controller.select(id); });
    buttons.set(id, button); group.append(button);
  }
  container.append(group);
  const dates = createDateNavigation(container, controller);
  container.append(status);
  return {
    openDates: dates.open,
    dispose: dates.dispose,
    refresh() {
      dates.refresh();
      const locale = getLocale(), text = messages[locale];
      group.setAttribute('aria-label', text.title);
      group.setAttribute('aria-busy', String(controller.status === 'loading'));
      RANGE_IDS.forEach((id, index) => {
        const button = buttons.get(id)!;
        button.textContent = labels[locale][index]; button.title = text.title;
        button.disabled = (!ready() && controller.cutoff() === null) || controller.status === 'loading';
        button.setAttribute('aria-pressed', String(controller.selected === id));
      });
      status.textContent = controller.status === 'idle' || controller.status === 'ready' ? '' : text[controller.status];
    },
  };
}
