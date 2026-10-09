import { getLocale } from '../../ui/i18n';

const english = {
  title: 'Price lines', close: 'Close price lines', new: 'New price line',
  empty: 'No price lines yet.', name: 'Name', price: 'Price', color: 'Color', width: 'Line width',
  style: 'Line style', solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', visible: 'Show line',
  axisLabel: 'Show price label', add: 'Add line', save: 'Save changes', unnamed: 'Price line',
  remove: 'Delete price line', hidden: 'Hidden',
  note: 'Up to 16 references per instrument, shared across periods. Prices use instrument precision. Lines do not change the automatic price range.',
  saved: 'Saved on this device.', session: 'Available in this session; device storage is unavailable.',
  draft: 'Unsaved changes.',
  invalid: 'Enter a valid price using instrument precision and a name of at most 64 characters.',
  damaged: 'Saved price lines could not be restored.', limit: 'The 16-line limit has been reached.',
};
const chinese: Record<keyof typeof english, string> = {
  title: '价位线', close: '关闭价位线', new: '新增价位线', empty: '尚未添加价位线。',
  name: '名称', price: '价格', color: '颜色', width: '线宽', style: '线型',
  solid: '实线', dashed: '虚线', dotted: '点线', visible: '显示线条', axisLabel: '显示价格标签',
  add: '添加线条', save: '保存修改', unnamed: '价位线', remove: '删除价位线', hidden: '已隐藏',
  note: '每个品种最多保存 16 条，跨周期共用。价格遵循品种精度；线条不改变自动价格范围。',
  saved: '已保存在本设备。', session: '本次会话可用；设备存储不可用。',
  draft: '修改尚未保存。',
  invalid: '请输入符合品种精度的价格，名称最多 64 个字符。',
  damaged: '已保存的价位线无法恢复。', limit: '已达到 16 条的上限。',
};
export type PriceLineMessage = keyof typeof english;
export function priceLineMessage(key: PriceLineMessage): string {
  return (getLocale() === 'zh-CN' ? chinese : english)[key];
}
