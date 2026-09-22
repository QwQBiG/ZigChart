import './select-control.css';

interface SelectControl {
  select: HTMLSelectElement;
  wrapper: HTMLSpanElement;
  button: HTMLButtonElement;
  value: HTMLSpanElement;
  popup: HTMLDivElement;
  options: HTMLElement[];
  signature: string;
  active: number;
  originalHidden: boolean;
}

let sequence = 0;

/** Keep native form values while rendering the menu in the current page theme. */
export function setupSelectControls(root: Document = document): { refresh(): void; dispose(): void } {
  const controls: SelectControl[] = [];
  const events = new AbortController();
  const signal = events.signal;
  let opened: SelectControl | null = null;
  let search = '';
  let searchedAt = 0;

  function enabled(control: SelectControl, index: number): boolean {
    const option = control.select.options[index];
    return !!option && !option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
  }

  function activate(control: SelectControl, index: number, scroll = true): void {
    control.active = index;
    control.options.forEach((option, i) => option.classList.toggle('is-active', i === index));
    const option = control.options[index];
    if (option && opened === control) {
      control.button.setAttribute('aria-activedescendant', option.id);
      if (scroll) option.scrollIntoView({ block: 'nearest' });
    } else control.button.removeAttribute('aria-activedescendant');
  }

  function close(restoreFocus = false): void {
    if (!opened) return;
    const control = opened;
    opened = null;
    control.popup.hidden = true;
    control.button.setAttribute('aria-expanded', 'false');
    control.button.removeAttribute('aria-activedescendant');
    search = '';
    if (restoreFocus) control.button.focus({ preventScroll: true });
  }

  function position(control: SelectControl): void {
    const bounds = control.button.getBoundingClientRect();
    const view = root.defaultView!;
    const inset = 8;
    const width = Math.min(Math.max(bounds.width, 170), view.innerWidth - inset * 2);
    control.popup.style.width = `${width}px`;
    control.popup.style.left = `${Math.max(inset, Math.min(bounds.left, view.innerWidth - width - inset))}px`;
    const below = view.innerHeight - bounds.bottom - inset - 4;
    const above = bounds.top - inset - 4;
    const upwards = below < 200 && above > below;
    const available = Math.max(40, upwards ? above : below);
    control.popup.style.maxHeight = `${Math.min(360, available)}px`;
    control.popup.style.top = `${upwards ? Math.max(inset, bounds.top - control.popup.offsetHeight - 4) : bounds.bottom + 4}px`;
  }

  function open(control: SelectControl): void {
    if (control.select.disabled || control.options.length === 0) return;
    close();
    opened = control;
    control.popup.hidden = false;
    control.button.setAttribute('aria-expanded', 'true');
    position(control);
    const selected = control.select.selectedIndex;
    activate(control, enabled(control, selected) ? selected : Array.from(control.select.options).findIndex((_, index) => enabled(control, index)));
  }

  function choose(control: SelectControl, index: number): void {
    if (control.select.disabled || !enabled(control, index)) return;
    const changed = control.select.selectedIndex !== index;
    control.select.selectedIndex = index;
    close(true);
    update(control);
    if (changed) {
      control.select.dispatchEvent(new Event('input', { bubbles: true }));
      control.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function accessibleLabel(select: HTMLSelectElement): string {
    if (select.hasAttribute('aria-label')) return select.getAttribute('aria-label')!;
    return Array.from(select.labels ?? []).map(label => {
      const copy = label.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('select,.custom-select').forEach(node => node.remove());
      return copy.textContent?.trim() ?? '';
    }).filter(Boolean).join(' ');
  }

  function update(control: SelectControl): void {
    const { select, button, value, popup } = control;
    value.textContent = select.selectedOptions[0]?.label ?? '';
    button.disabled = select.disabled;
    button.title = select.title;
    const label = accessibleLabel(select);
    if (label) button.setAttribute('aria-label', label);
    else button.removeAttribute('aria-label');
    for (const name of ['aria-labelledby', 'aria-describedby', 'aria-required', 'aria-invalid']) {
      const attribute = select.getAttribute(name);
      if (attribute) button.setAttribute(name, attribute);
      else button.removeAttribute(name);
    }
    popup.setAttribute('aria-label', label);
    const signature = JSON.stringify(Array.from(select.children).map(child => child.outerHTML));
    if (signature !== control.signature) {
      control.signature = signature;
      popup.replaceChildren();
      control.options = [];
      buildOptions(control);
    }
    control.options.forEach((option, index) => option.setAttribute('aria-selected', String(index === select.selectedIndex)));
    if (opened === control && select.disabled) close();
    else if (opened === control) {
      const active = enabled(control, control.active) ? control.active : Array.from(select.options).findIndex((_, index) => enabled(control, index));
      activate(control, active, false);
      position(control);
    }
  }

  function buildOptions(control: SelectControl): void {
    let index = 0;
    const append = (source: HTMLOptionElement, parent: HTMLElement): void => {
      const option = root.createElement('div');
      option.className = 'select-option';
      option.id = `${control.popup.id}-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-disabled', String(!enabled(control, index)));
      option.dataset.index = String(index++);
      option.textContent = source.label;
      if (source.lang) option.lang = source.lang;
      parent.append(option);
      control.options.push(option);
    };
    for (const child of control.select.children) {
      if (child instanceof HTMLOptGroupElement) {
        const group = root.createElement('div');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', child.label);
        const heading = root.createElement('div');
        heading.className = 'select-group-label';
        heading.textContent = child.label;
        heading.setAttribute('aria-hidden', 'true');
        group.append(heading);
        for (const option of child.children) if (option instanceof HTMLOptionElement) append(option, group);
        control.popup.append(group);
      } else if (child instanceof HTMLOptionElement) append(child, control.popup);
    }
  }

  function keydown(control: SelectControl, event: KeyboardEvent): void {
    const { key } = event;
    if (key === 'Tab') { close(); return; }
    if (key === 'Escape') {
      if (opened === control) { event.preventDefault(); event.stopPropagation(); close(true); }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key) && key.length !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const wasOpen = opened === control;
    if (!wasOpen) open(control);
    if (key === 'Enter' || key === ' ') {
      if (wasOpen) choose(control, control.active);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      if (!wasOpen && key.startsWith('Arrow')) return;
      const direction = key === 'ArrowUp' || key === 'End' ? -1 : 1;
      let index = key === 'Home' ? 0 : key === 'End' ? control.options.length - 1 : control.active + direction;
      while (index >= 0 && index < control.options.length) {
        if (enabled(control, index)) { activate(control, index); break; }
        index += direction;
      }
      return;
    }
    const now = Date.now();
    search = now - searchedAt > 700 ? key : search + key;
    searchedAt = now;
    const query = Array.from(search).every(character => character === search[0]) ? key : search;
    for (let offset = 1; offset <= control.options.length; offset++) {
      const index = (control.active + offset) % control.options.length;
      if (enabled(control, index) && control.select.options[index].label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) {
        activate(control, index);
        break;
      }
    }
  }

  function create(select: HTMLSelectElement): void {
    const wrapper = root.createElement('span');
    wrapper.className = 'custom-select';
    const button = root.createElement('button');
    button.type = 'button';
    button.className = 'select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const value = root.createElement('span');
    value.className = 'select-value';
    button.append(value);
    const popup = root.createElement('div');
    popup.className = 'select-popover';
    popup.id = `select-popover-${++sequence}`;
    popup.setAttribute('role', 'listbox');
    popup.hidden = true;
    button.setAttribute('aria-controls', popup.id);
    const control: SelectControl = { select, wrapper, button, value, popup, options: [], signature: '', active: -1, originalHidden: select.hidden };
    select.before(wrapper);
    wrapper.append(select, button);
    select.hidden = true;
    (select.closest('dialog') ?? root.body).append(popup);
    controls.push(control);
    button.addEventListener('click', () => { update(control); if (opened === control) close(); else open(control); }, { signal });
    button.addEventListener('keydown', event => keydown(control, event), { signal });
    button.addEventListener('blur', () => { if (opened === control) close(); }, { signal });
    select.addEventListener('change', () => update(control), { signal });
    popup.addEventListener('pointerdown', event => {
      if ((event.target as HTMLElement).closest('[data-index]')) event.preventDefault();
    }, { signal });
    popup.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (target) choose(control, Number(target.dataset.index));
    }, { signal });
    popup.addEventListener('pointermove', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (target && enabled(control, Number(target.dataset.index))) activate(control, Number(target.dataset.index), false);
    }, { signal });
    update(control);
  }

  function refresh(): void {
    for (const select of root.querySelectorAll<HTMLSelectElement>('select')) {
      if (!select.multiple && select.size <= 1 && !controls.some(control => control.select === select)) create(select);
    }
    for (const control of controls) update(control);
  }

  root.addEventListener('pointerdown', event => {
    if (opened && !opened.wrapper.contains(event.target as Node) && !opened.popup.contains(event.target as Node)) close();
  }, { capture: true, signal });
  root.addEventListener('scroll', event => {
    if (opened && !opened.popup.contains(event.target as Node)) position(opened);
  }, { capture: true, signal });
  root.defaultView?.addEventListener('resize', () => { if (opened) position(opened); }, { signal });
  refresh();
  return { refresh, dispose() {
    close();
    events.abort();
    for (const { select, wrapper, popup, originalHidden } of controls) {
      select.hidden = originalHidden;
      wrapper.replaceWith(select);
      popup.remove();
    }
  } };
}
