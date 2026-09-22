/** Present existing drawing controls without coupling them to market information. */
export function createDrawingPanel() {
  const dialog = document.getElementById('drawing-panel') as HTMLDialogElement;
  const trigger = document.getElementById('drawing-settings-open') as HTMLButtonElement;
  const close = document.getElementById('drawing-settings-close') as HTMLButtonElement;
  const events = new AbortController();
  const signal = events.signal;
  function open() {
    if (!dialog.open) dialog.showModal();
    trigger.classList.add('active');
    trigger.setAttribute('aria-expanded', 'true');
  }
  trigger.addEventListener('click', open, { signal });
  close.addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener('close', () => {
    trigger.classList.remove('active'); trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  }, { signal });
  return { open, dispose() { events.abort(); if (dialog.open) dialog.close(); } };
}
