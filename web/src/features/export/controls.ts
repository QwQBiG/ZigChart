import { getLocale, type Locale } from '../../ui/i18n.ts';

const english = {
  title: 'Save chart image', close: 'Close image preview', done: 'Close',
  loading: 'Preparing chart image…', error: 'The chart image could not be prepared. Please try again.',
  retry: 'Try again', download: 'Download PNG', preview: 'Chart image', pixels: 'pixels',
  help: 'Includes the visible chart, panes, drawings and chart labels. Toolbars, the sidebar and crosshair are excluded.',
};
const messages: Record<Locale, typeof english> = {
  en: english,
  'zh-CN': { title: '保存图表图片', close: '关闭图片预览', done: '关闭',
    loading: '正在生成图表图片…', error: '无法生成图表图片，请重试。',
    retry: '重试', download: '下载 PNG', preview: '图表图片', pixels: '像素',
    help: '包含可见图表、副图、绘图与图表标签；不包含工具栏、右侧栏和十字光标。' },
};

interface Snapshot { blob: Blob; filename: string; width: number; height: number }
interface SnapshotOptions { button: HTMLButtonElement; capture: () => Promise<Snapshot> }

/** Own the export dialog and borrowed image URL; the host owns image composition. */
export function createSnapshotControls({ button, capture }: SnapshotOptions) {
  let disposed = false, generation = 0, url: string | null = null;
  let state: 'idle' | 'loading' | 'ready' | 'error' = 'idle', snapshot: Snapshot | null = null;
  const dialog = document.createElement('dialog'); dialog.id = 'chart-snapshot';
  dialog.className = 'chart-snapshot-dialog'; dialog.setAttribute('aria-labelledby', 'chart-snapshot-title');
  const header = document.createElement('header'), title = document.createElement('h2');
  title.id = 'chart-snapshot-title';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
  header.append(title, close);
  const content = document.createElement('div'); content.className = 'chart-snapshot-content';
  const preview = document.createElement('img'); preview.hidden = true;
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const help = document.createElement('p'); help.className = 'chart-snapshot-help';
  content.append(preview, status, help);
  const footer = document.createElement('footer'), retry = document.createElement('button');
  retry.type = 'button';
  const done = document.createElement('button'); done.type = 'button';
  const download = document.createElement('a'); download.className = 'chart-snapshot-download';
  footer.append(retry, done, download); dialog.append(header, content, footer); document.body.append(dialog);
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id);

  function release() {
    if (url !== null) URL.revokeObjectURL(url);
    url = null; snapshot = null; preview.removeAttribute('src'); download.removeAttribute('href');
    download.removeAttribute('download');
  }
  function refresh() {
    if (disposed) return;
    const text = messages[getLocale()];
    title.textContent = button.title = text.title; button.setAttribute('aria-label', text.title);
    button.setAttribute('aria-expanded', String(dialog.open));
    close.title = text.close; close.setAttribute('aria-label', text.close);
    done.textContent = text.done; retry.textContent = text.retry; download.textContent = text.download;
    help.textContent = text.help;
    const dimensions = snapshot ? `${snapshot.width} × ${snapshot.height} ${text.pixels}` : '';
    preview.alt = `${text.preview}${dimensions ? ` (${dimensions})` : ''}`;
    status.textContent = state === 'loading' ? text.loading : state === 'error' ? text.error : dimensions;
    status.dataset.state = state; content.setAttribute('aria-busy', String(state === 'loading'));
    preview.hidden = state !== 'ready'; download.hidden = state !== 'ready'; retry.hidden = state !== 'error';
  }
  async function prepare() {
    const current = ++generation;
    release(); state = 'loading'; refresh();
    try {
      const result = await capture();
      if (disposed || !dialog.open || current !== generation) return;
      if (result.blob.type !== 'image/png' || !result.blob.size || !Number.isInteger(result.width) ||
        !Number.isInteger(result.height) || result.width <= 0 || result.height <= 0) throw new Error('Invalid chart snapshot');
      url = URL.createObjectURL(result.blob); snapshot = result;
      preview.src = url; download.href = url; download.download = result.filename;
      state = 'ready'; refresh();
    } catch {
      if (disposed || !dialog.open || current !== generation) return;
      release(); state = 'error'; refresh();
    }
  }
  function open() {
    if (disposed || button.disabled || dialog.open) return;
    dialog.showModal(); void prepare();
  }
  function dismiss() { generation += 1; release(); state = 'idle'; dialog.close(); refresh(); }
  function closed() {
    if (dialog.open) return;
    generation += 1; release(); state = 'idle'; refresh();
    if (!disposed) button.focus({ preventScroll: true });
  }
  button.addEventListener('click', open); close.addEventListener('click', dismiss); done.addEventListener('click', dismiss);
  retry.addEventListener('click', () => { if (state === 'error') void prepare(); });
  dialog.addEventListener('close', closed);
  dialog.addEventListener('cancel', () => { generation += 1; release(); state = 'idle'; });
  preview.addEventListener('error', () => {
    if (disposed || !dialog.open || state !== 'ready') return;
    release(); state = 'error'; refresh();
  });
  refresh();
  return { refresh, dispose() {
    disposed = true; generation += 1; release(); button.removeEventListener('click', open);
    dialog.removeEventListener('close', closed); dialog.close(); dialog.remove();
    button.setAttribute('aria-expanded', 'false');
  } };
}
