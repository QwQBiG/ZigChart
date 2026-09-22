import type { Frame } from '../../chart/types';
import type { ScalePreferences } from './model';
import { getLocale } from '../../ui/i18n';

const messages = {
  en: { settings: 'Price scale settings', normal: 'Price', logarithmic: 'Log', percentage: '%', indexed: '100',
    inverted: 'Inverted', fallback: 'Regular scale is active because the visible data or reference cannot use the selected mode.' },
  'zh-CN': { settings: '价格坐标轴设置', normal: '价格', logarithmic: '对数', percentage: '%', indexed: '100',
    inverted: '已反转', fallback: '可见数据或基准不支持所选模式，当前使用常规刻度。' },
};

export function syncScaleFeedback(button: HTMLButtonElement, frame: Frame | null, preferences: ScalePreferences): void {
  const text = messages[getLocale()];
  const axis = frame?.priceAxis;
  const fallback = !!axis && axis.requestedMode !== axis.effectiveMode;
  const label = `${text[preferences.mode]}${preferences.inverted ? ' ↕' : ''}${fallback ? ' !' : ''}`;
  if (button.textContent !== label) button.textContent = label;
  const title = `${text.settings}: ${text[preferences.mode]}${preferences.inverted ? ` · ${text.inverted}` : ''}${fallback ? ` · ${text.fallback}` : ''}`;
  if (button.title !== title) { button.title = title; button.setAttribute('aria-label', title); }
  button.dataset.fallback = String(fallback);
  button.disabled = !frame?.rows.length;
}
