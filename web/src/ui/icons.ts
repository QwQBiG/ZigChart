const shapes = {
  brand: '<path d="M3 4h14L3 16h14"/>',
  indicators: '<path d="M3 16v-5m5 5V8m5 8v-4m4 4V6M3 8l5-4 5 4 4-5"/>',
  undo: '<path d="m7 4-4 4 4 4M3 8h8a6 6 0 0 1 6 6"/>',
  redo: '<path d="m13 4 4 4-4 4M17 8H9a6 6 0 0 0-6 6"/>',
  fullscreen: '<path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/>',
  camera: '<path d="m7 5 2-2h2l2 2h4v11H3V5z"/><circle cx="10" cy="10.5" r="3"/>',
  sidebar: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12 4v12"/>',
  pointer: '<path d="m4 3 12 7-5 2-2 5z"/>',
  line: '<path d="m5 15 10-10"/><circle cx="4" cy="16" r="1.5"/><circle cx="16" cy="4" r="1.5"/>',
  priceLine: '<path d="M2 10h11m2 0h1"/><rect x="13" y="7" width="5" height="6" rx="1"/>',
  rectangle: '<rect x="4" y="5" width="12" height="10"/><path d="M2 5h4M4 3v4m10 8h4m-2-2v4"/>',
  ruler: '<path d="m3 13 10-10 4 4L7 17zM6 10l2 2m1-5 2 2m1-5 2 2"/>',
  text: '<path d="M4 6V4h12v2M10 4v12m-3 0h6"/>',
  crosshair: '<path d="M10 2v5m0 6v5M2 10h5m6 0h5"/><circle cx="10" cy="10" r="2.5"/>',
  settings: '<path d="M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-5 1v4"/>',
  trash: '<path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6m4-6v6"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/>',
  strategy: '<path d="M3 15h4V9h6V4h4M3 5h4m6 10h4"/>',
  code: '<path d="m6 5-4 5 4 5m8-10 4 5-4 5M12 3 8 17"/>',
  candles: '<path d="M6 2v3m0 8v5m8-16v5m0 8v3"/><rect x="4" y="5" width="4" height="8"/><rect x="12" y="7" width="4" height="8"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
} as const;

export type WorkspaceIconName = keyof typeof shapes;
const svgNamespace = 'http://www.w3.org/2000/svg';

/** Original presentation assets share one grid and inherit the surrounding control color. */
export function createWorkspaceIcon(name: WorkspaceIconName): SVGSVGElement {
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.setAttribute('viewBox', '0 0 20 20');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.classList.add('workspace-icon');
  icon.innerHTML = shapes[name];
  return icon;
}

/** Populate icon leaves without replacing the controls that own input and localization. */
export function setupWorkspaceIcons(root: ParentNode = document): void {
  for (const leaf of root.querySelectorAll<HTMLElement | SVGSVGElement>('[data-icon]')) {
    const name = leaf.dataset.icon;
    if (!name || !Object.hasOwn(shapes, name)) continue;
    const icon = createWorkspaceIcon(name as WorkspaceIconName);
    if (leaf.namespaceURI === svgNamespace) {
      leaf.setAttribute('viewBox', '0 0 20 20');
      leaf.setAttribute('aria-hidden', 'true');
      leaf.setAttribute('focusable', 'false');
      leaf.classList.add('workspace-icon');
      leaf.replaceChildren(...Array.from(icon.childNodes));
    } else {
      leaf.replaceChildren(icon);
    }
  }
}
