import { t, type MessageKey } from './i18n.ts';

function node<T extends HTMLElement = HTMLElement>(doc: Document, id: string): T {
  const found = doc.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

function action(button: HTMLButtonElement, key: MessageKey): void {
  const label = t(key);
  button.title = label;
  button.setAttribute('aria-label', label);
}

/** Derive action labels from current state without owning the state or its persistence. */
export function syncDrawingFeedback(selected: { locked: boolean } | null, doc: Document = document): void {
  const lock = node<HTMLButtonElement>(doc, 'drawing-lock');
  const locked = selected?.locked ?? false;
  const key = locked ? 'unlockDrawing' : 'lockDrawing';
  lock.disabled = selected === null;
  lock.textContent = t(key);
  lock.setAttribute('aria-pressed', String(locked));
  lock.classList.toggle('active', locked);
  action(lock, key);
  node(doc, 'drawing-hint').textContent = t(locked ? 'drawingLocked' : selected ? 'drawingSelectedHint' : 'drawingHint');
}

export function syncPanelFeedback(sidebarOpen: boolean, doc: Document = document): void {
  const sidebar = node<HTMLButtonElement>(doc, 'sidebar-toggle');
  sidebar.setAttribute('aria-expanded', String(sidebarOpen));
  sidebar.classList.toggle('active', sidebarOpen);
  action(sidebar, sidebarOpen ? 'hideDetails' : 'showDetails');
}
