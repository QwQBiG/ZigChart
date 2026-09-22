import { getLocale } from './i18n.ts';

interface FullscreenOptions {
  button: HTMLButtonElement;
  status: HTMLElement;
  target: HTMLElement;
  onChange?(): void;
}

const messages = {
  en: {
    enter: 'Enter fullscreen', exit: 'Exit fullscreen', busy: 'Changing fullscreen…',
    unavailable: 'Fullscreen is unavailable in this browser or context.',
    other: 'Another element is fullscreen. Exit it before expanding this workspace.',
    failed: 'Fullscreen could not be changed. Try again or use your browser’s fullscreen command.',
  },
  'zh-CN': {
    enter: '进入全屏', exit: '退出全屏', busy: '正在切换全屏…',
    unavailable: '当前浏览器或环境不支持全屏。',
    other: '其他元素正处于全屏状态，请先退出其全屏再展开工作台。',
    failed: '无法切换全屏。请重试或使用浏览器的全屏命令。',
  },
};

/** Fullscreen belongs to the browser; button state follows its actual document state. */
export function createFullscreenControl(options: FullscreenOptions) {
  const { button, status, target } = options;
  const doc = target.ownerDocument;
  const events = new AbortController();
  let busy = false, failed = false, disposed = false;
  const active = () => doc.fullscreenElement === target;
  const occupied = () => !!doc.fullscreenElement && !active();
  const supported = () => active() ? typeof doc.exitFullscreen === 'function'
    : doc.fullscreenEnabled === true && typeof target.requestFullscreen === 'function';

  function refresh(): void {
    if (disposed) return;
    const text = messages[getLocale()];
    const blocked = occupied(), available = supported();
    button.disabled = busy || blocked || !available;
    button.classList.toggle('active', active());
    button.setAttribute('aria-pressed', String(active()));
    button.setAttribute('aria-busy', String(busy));
    button.title = busy ? text.busy : blocked ? text.other : !available ? text.unavailable : active() ? text.exit : text.enter;
    button.setAttribute('aria-label', button.title);
    const message = failed ? text.failed : blocked ? text.other : !available ? text.unavailable : '';
    status.textContent = message;
    status.hidden = !message;
  }

  async function toggle(): Promise<void> {
    if (disposed || busy || occupied() || !supported()) return;
    busy = true; failed = false; refresh();
    try {
      if (active()) await doc.exitFullscreen();
      else await target.requestFullscreen();
    } catch {
      failed = true;
    } finally {
      busy = false; refresh();
    }
  }

  button.addEventListener('click', () => { void toggle(); }, { signal: events.signal });
  doc.addEventListener('fullscreenchange', () => {
    failed = false; refresh();
    options.onChange?.();
  }, { signal: events.signal });
  doc.addEventListener('fullscreenerror', () => {
    if (!busy) return;
    failed = true; refresh();
  }, { signal: events.signal });
  refresh();
  return { refresh, dispose() { disposed = true; events.abort(); } };
}
