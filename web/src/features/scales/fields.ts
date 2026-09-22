import { getLocale } from '../../ui/i18n';
import { SCALE_MODES, parseScales, type ScalePreferences } from './model';

const messages = {
  en: { mode: 'Price scale', normal: 'Regular', logarithmic: 'Logarithmic', percentage: 'Percentage',
    indexed: 'Indexed to 100', inverted: 'Invert price scale',
    hint: 'Relative scales use the first visible close. Zero references and non-positive logarithmic ranges use Regular until valid. Volume keeps its own scale.' },
  'zh-CN': { mode: '价格刻度', normal: '常规', logarithmic: '对数', percentage: '百分比',
    indexed: '指数化至 100', inverted: '反转价格轴',
    hint: '相对刻度以首根可见 K 线的收盘价为基准。基准为零或对数范围非正时，暂用常规刻度。成交量保持独立比例。' },
};

/** Edit only a scale draft; the workspace owns persistence and the core owns transforms. */
export function createScaleFields(container: HTMLElement, onChange: (value: ScalePreferences) => void) {
  let state: ScalePreferences;
  const row = document.createElement('label'); row.className = 'appearance-row';
  const caption = document.createElement('span');
  const select = document.createElement('select');
  for (const mode of SCALE_MODES) {
    const option = document.createElement('option'); option.value = mode; select.append(option);
  }
  row.append(caption, select);
  const inverted = document.createElement('label'); inverted.className = 'appearance-toggle';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
  const inversionLabel = document.createElement('span'); inverted.append(checkbox, inversionLabel);
  const hint = document.createElement('p'); hint.className = 'appearance-hint';
  container.append(row, inverted, hint);
  select.addEventListener('change', () => { state = parseScales({ ...state, mode: select.value }); onChange(state); });
  checkbox.addEventListener('change', () => { state = { ...state, inverted: checkbox.checked }; onChange(state); });
  return {
    refresh(value: ScalePreferences) {
      state = { ...value };
      const text = messages[getLocale()];
      caption.textContent = text.mode; inversionLabel.textContent = text.inverted; hint.textContent = text.hint;
      for (const option of select.options) option.textContent = text[option.value as keyof typeof text];
      select.value = state.mode; checkbox.checked = state.inverted;
    },
  };
}
