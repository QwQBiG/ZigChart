import './panel.css';
import type { Instrument } from '../../data/contracts';
import { formatPrice } from '../../chart/format';
import { parsePriceInput, priceInputText } from '../../chart/price-input';
import { createWorkspaceIcon } from '../../ui/icons';
import { DEFAULT_PRICE_LINE, PRICE_LINE_LIMIT, type PriceLineStore, type PriceLineDraft } from './model';
import { priceLineMessage as message, type PriceLineMessage } from './messages';

interface Options {
  rail: HTMLElement;
  store: PriceLineStore;
  getInstrument(): Instrument;
  getLatestPrice(): number | null;
  onChange(): void;
  onOpen(): void;
  refreshControls(): void;
}

/** Edit instrument-bound references without adding a market source or viewport. */
export function createPriceLinePanel(options: Options) {
  const events = new AbortController(), signal = events.signal;
  let selectedId: number | undefined, feedback: PriceLineMessage | null = null, disposed = false;
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = 'price-lines-open'; trigger.className = 'tool-button';
  trigger.setAttribute('aria-controls', 'price-lines-dialog'); trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.append(createWorkspaceIcon('priceLine'));
  options.rail.insertBefore(trigger, options.rail.querySelector('.tool-divider'));
  const dialog = document.createElement('dialog');
  dialog.id = 'price-lines-dialog'; dialog.className = 'price-lines-dialog';
  dialog.setAttribute('aria-labelledby', 'price-lines-title');
  dialog.innerHTML = `<header class="price-lines-header"><h2 id="price-lines-title" data-message="title"></h2><button type="button" class="icon-button" data-close></button></header>
    <div class="price-lines-body"><div class="price-lines-list"></div><button type="button" class="quiet-button price-lines-new" data-message="new"></button>
    <form id="price-lines-form" class="price-lines-fields">
      <label><span data-message="name"></span><input type="text" name="title" maxlength="64" autocomplete="off"></label>
      <label><span data-message="price"></span><input type="text" name="price" inputmode="decimal" autocomplete="off" required></label>
      <label><span data-message="color"></span><input type="color" name="color"></label>
      <label><span data-message="width"></span><select name="width"><option value="1">1 px</option><option value="2">2 px</option><option value="3">3 px</option><option value="4">4 px</option></select></label>
      <label><span data-message="style"></span><select name="style"><option value="solid" data-message="solid"></option><option value="dashed" data-message="dashed"></option><option value="dotted" data-message="dotted"></option></select></label>
      <label><span data-message="visible"></span><input type="checkbox" name="visible"></label>
      <label><span data-message="axisLabel"></span><input type="checkbox" name="axisLabel"></label>
    </form><p class="price-lines-note" data-message="note"></p></div>
    <footer class="price-lines-footer"><p class="price-lines-status" role="status" aria-live="polite"></p><button class="price-lines-apply" type="submit" form="price-lines-form"></button></footer>`;
  document.body.append(dialog);
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  close.append(createWorkspaceIcon('close'));
  const list = dialog.querySelector<HTMLDivElement>('.price-lines-list')!;
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const apply = dialog.querySelector<HTMLButtonElement>('.price-lines-apply')!;
  const status = dialog.querySelector<HTMLParagraphElement>('.price-lines-status')!;
  const newButton = dialog.querySelector<HTMLButtonElement>('.price-lines-new')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  function load(draft: PriceLineDraft) {
    field('title').value = draft.title;
    field('price').value = priceInputText(draft.price, options.getInstrument().priceScale);
    field('color').value = draft.color; field('width').value = String(draft.width); field('style').value = draft.style;
    (field('visible') as HTMLInputElement).checked = draft.visible;
    (field('axisLabel') as HTMLInputElement).checked = draft.axisLabel;
  }
  function startNew() {
    selectedId = undefined; feedback = null;
    load({ ...DEFAULT_PRICE_LINE, price: options.getLatestPrice() ?? 0 }); refresh();
  }
  function open() {
    if (dialog.open || options.getLatestPrice() === null) return;
    options.onOpen(); startNew(); dialog.showModal();
    trigger.classList.add('active'); trigger.setAttribute('aria-expanded', 'true');
  }
  trigger.addEventListener('click', open, { signal });
  close.addEventListener('click', () => dialog.close(), { signal });
  newButton.addEventListener('click', startNew, { signal });
  dialog.addEventListener('close', () => {
    trigger.classList.remove('active'); trigger.setAttribute('aria-expanded', 'false'); feedback = null;
    if (!disposed) trigger.focus({ preventScroll: true });
  }, { signal });
  function updateStatus() {
    const state = options.store.status(options.getInstrument()), items = options.store.items(options.getInstrument());
    const key = feedback ?? (state.invalid ? 'damaged' : !state.saved ? 'session' : apply.disabled ? 'limit' : null);
    status.textContent = key ? message(key) : `${items.length} / ${PRICE_LINE_LIMIT}`;
    status.classList.toggle('is-error', key === 'invalid' || key === 'damaged');
  }
  const draftChanged = () => { feedback = 'draft'; updateStatus(); };
  form.addEventListener('input', draftChanged, { signal });
  form.addEventListener('change', draftChanged, { signal });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const instrument = options.getInstrument(), price = parsePriceInput(field('price').value, instrument.priceScale);
    const draft: PriceLineDraft = {
      price: price ?? Number.NaN, title: field('title').value, color: field('color').value,
      width: Number(field('width').value) as PriceLineDraft['width'], style: field('style').value as PriceLineDraft['style'],
      visible: (field('visible') as HTMLInputElement).checked, axisLabel: (field('axisLabel') as HTMLInputElement).checked,
    };
    if (!options.store.put(instrument, draft, selectedId)) { feedback = 'invalid'; refresh(); return; }
    if (selectedId === undefined) selectedId = options.store.items(instrument).at(-1)!.id;
    feedback = options.store.status(instrument).saved ? 'saved' : 'session';
    options.onChange(); refresh();
  }, { signal });
  list.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-line-id]');
    if (!button) return;
    const id = Number(button.dataset.lineId), instrument = options.getInstrument();
    if (button.dataset.delete !== undefined) {
      if (!options.store.remove(instrument, id)) return;
      if (selectedId === id) startNew();
      feedback = options.store.status(instrument).saved ? 'saved' : 'session';
      options.onChange(); refresh(); return;
    }
    const line = options.store.items(instrument).find(item => item.id === id);
    if (line) { selectedId = id; feedback = null; load(line); refresh(); }
  }, { signal });
  function refresh() {
    const instrument = options.getInstrument(), items = options.store.items(instrument);
    trigger.title = message('title'); trigger.setAttribute('aria-label', message('title'));
    trigger.disabled = options.getLatestPrice() === null;
    close.title = message('close'); close.setAttribute('aria-label', message('close'));
    dialog.querySelectorAll<HTMLElement>('[data-message]').forEach(node => {
      node.textContent = message(node.dataset.message as PriceLineMessage);
    });
    apply.textContent = message(selectedId === undefined ? 'add' : 'save');
    apply.disabled = selectedId === undefined && items.length >= PRICE_LINE_LIMIT;
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'price-lines-empty';
      empty.textContent = message('empty'); list.append(empty);
    }
    for (const line of items) {
      const row = document.createElement('div'); row.className = 'price-line-item';
      const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.lineId = String(line.id);
      edit.setAttribute('aria-pressed', String(selectedId === line.id));
      const swatch = document.createElement('span'); swatch.className = 'price-line-swatch'; swatch.style.background = line.color;
      const title = document.createElement('span'); title.className = 'price-line-title';
      title.textContent = `${line.title || message('unnamed')}${line.visible ? '' : ` · ${message('hidden')}`}`;
      const value = document.createElement('output'); value.textContent = formatPrice(line.price, instrument.priceScale);
      edit.append(swatch, title, value);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button';
      remove.dataset.lineId = String(line.id); remove.dataset.delete = '';
      remove.title = `${message('remove')} · ${line.title || value.textContent}`;
      remove.setAttribute('aria-label', remove.title); remove.append(createWorkspaceIcon('trash'));
      row.append(edit, remove); list.append(row);
    }
    updateStatus();
    options.refreshControls();
  }
  refresh();
  return {
    open, refresh, close() { if (dialog.open) dialog.close(); },
    dispose() { disposed = true; events.abort(); if (dialog.open) dialog.close(); dialog.remove(); trigger.remove(); },
  };
}
