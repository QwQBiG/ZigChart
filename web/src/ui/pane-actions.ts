import type { Frame } from '../chart/types';
import { t } from './i18n.ts';
import './pane-actions.css';

interface PaneActionsOptions {
  container: HTMLElement;
  onMove(id: number, direction: number): void;
  onMaximize(id: number): void;
}

/** Controls consume copied pane geometry; ordering and sizing stay in the core. */
export function createPaneActions(options: PaneActionsOptions) {
  const events = new AbortController();
  let frame: Frame | null = null;
  let focused = -1;
  const names = () => [t('pricePane'), t('volume'), 'RSI', 'MACD'];
  const controls = [0, 1, 2, 3].map(id => {
    const host = document.createElement('div');
    host.className = 'pane-actions'; host.hidden = true;
    host.setAttribute('role', 'group');
    const buttons = ['↑', '↓', '⛶'].map((symbol, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = symbol;
      button.addEventListener('click', () => {
        if (index < 2) options.onMove(id, index === 0 ? -1 : 1);
        else options.onMaximize(focused === id ? -1 : id);
      }, { signal: events.signal });
      host.append(button); return button;
    });
    options.container.append(host);
    return { host, buttons };
  });
  function refresh() {
    const panes = frame?.panes ?? [];
    for (const [id, { host, buttons }] of controls.entries()) {
      const index = panes.findIndex(pane => pane.id === id);
      const pane = panes[index];
      if (host.hidden !== !pane) host.hidden = !pane;
      if (!pane) continue;
      const name = names()[id];
      const groupLabel = t('paneActions', { name });
      if (host.getAttribute('aria-label') !== groupLabel) host.setAttribute('aria-label', groupLabel);
      const top = `${pane.top + 4}px`;
      if (host.style.top !== top) host.style.top = top;
      for (const [i, button] of buttons.entries()) {
        const label = t(i === 0 ? 'movePaneUp' : i === 1 ? 'movePaneDown' : focused === id ? 'restorePanes' : 'maximizePane', { name });
        if (button.title !== label) { button.title = label; button.setAttribute('aria-label', label); }
        const disabled = i < 2 && (focused >= 0 || (i === 0 ? index === 0 : index === panes.length - 1));
        if (button.disabled !== disabled) button.disabled = disabled;
      }
      const symbol = focused === id ? '⊡' : '⛶', pressed = String(focused === id);
      if (buttons[2].textContent !== symbol) buttons[2].textContent = symbol;
      if (buttons[2].getAttribute('aria-pressed') !== pressed) buttons[2].setAttribute('aria-pressed', pressed);
    }
  }
  return { refresh,
    resetFrame() { frame = null; focused = -1; refresh(); },
    updateFrame(value: Frame, maximized: number) { frame = value; focused = maximized; refresh(); },
    dispose() { events.abort(); for (const { host } of controls) host.remove(); },
  };
}
