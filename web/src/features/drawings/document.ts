import type { DrawingPrimitive } from '../../chart/bridge';
import { isDrawingKind } from '../../chart/drawing-types.ts';
import { validFibonacciStyle, type FibonacciStyle } from './fibonacci-model.ts';
import { validTextStyle, type TextStyle } from './text-model.ts';

export interface Drawing extends DrawingPrimitive {
  id: string;
  color: string;
  width: number;
  locked: boolean;
  fibonacci?: FibonacciStyle;
  text?: TextStyle;
}
type Edit = { before: Drawing | null; after: Drawing | null; index: number };
type Page = { items: Drawing[]; undo: Edit[]; redo: Edit[] };
const MAX_DRAWINGS = 256;
const MAX_HISTORY = 100;
const clone = <T>(value: T): T => structuredClone(value);

export function validDrawing(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const d = value as Drawing;
  return typeof d.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(d.id) &&
    isDrawingKind(d.kind) && typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) &&
    Number.isInteger(d.width) && d.width >= 1 && d.width <= 4 && typeof d.locked === 'boolean' &&
    (d.kind === 'fibonacci' ? validFibonacciStyle(d.fibonacci) : d.fibonacci === undefined) &&
    (d.kind === 'text' ? validTextStyle(d.text) : d.text === undefined) &&
    [d.a, d.b].every(p => p && Number.isSafeInteger(p.time) && p.time >= 0 && p.time <= 8.64e15 &&
      Number.isSafeInteger(p.price) && Math.abs(p.price) <= 1e12) &&
    (d.kind !== 'text' || (d.a.time === d.b.time && d.a.price === d.b.price));
}

/** Per-period edits are independent of feed updates and history array indices. */
export class DrawingDocument {
  private readonly pages = new Map<string, Page>();
  private period = '1m';
  selected: string | null = null;

  constructor(private readonly symbol: string, private readonly priceScale: number) {}
  private get page(): Page {
    let page = this.pages.get(this.period);
    if (!page) { page = { items: [], undo: [], redo: [] }; this.pages.set(this.period, page); }
    return page;
  }
  get items(): readonly Drawing[] { return clone(this.page.items); }
  get selection(): Drawing | null { return clone(this.page.items.find(d => d.id === this.selected) ?? null); }
  get canUndo(): boolean { return this.page.undo.length > 0; }
  get canRedo(): boolean { return this.page.redo.length > 0; }
  get full(): boolean { return this.page.items.length >= MAX_DRAWINGS; }
  switchPeriod(period: string): void { this.period = period; this.selected = null; }

  add(drawing: Drawing): boolean {
    if (!validDrawing(drawing) || this.full || this.page.items.some(d => d.id === drawing.id)) return false;
    this.commit({ before: null, after: clone(drawing), index: this.page.items.length });
    return true;
  }
  update(drawing: Drawing): boolean {
    const index = this.page.items.findIndex(d => d.id === drawing.id);
    if (index < 0 || !validDrawing(drawing)) return false;
    const before = this.page.items[index];
    if (JSON.stringify(before) === JSON.stringify(drawing)) return false;
    if (before.locked && (JSON.stringify(before.a) !== JSON.stringify(drawing.a) ||
      JSON.stringify(before.b) !== JSON.stringify(drawing.b))) return false;
    this.commit({ before: clone(before), after: clone(drawing), index });
    return true;
  }
  removeSelected(): boolean {
    const index = this.page.items.findIndex(d => d.id === this.selected);
    if (index < 0 || this.page.items[index].locked) return false;
    this.commit({ before: clone(this.page.items[index]), after: null, index });
    return true;
  }
  private apply(edit: Edit, forward: boolean): void {
    const old = forward ? edit.before : edit.after;
    const next = forward ? edit.after : edit.before;
    if (old) this.page.items = this.page.items.filter(d => d.id !== old.id);
    if (next) this.page.items.splice(edit.index, 0, clone(next));
    this.selected = next?.id ?? null;
  }
  private commit(edit: Edit): void {
    this.apply(edit, true);
    this.page.undo.push(edit);
    if (this.page.undo.length > MAX_HISTORY) this.page.undo.shift();
    this.page.redo = [];
  }
  undo(): void {
    const edit = this.page.undo.pop();
    if (edit) { this.apply(edit, false); this.page.redo.push(edit); }
  }
  redo(): void {
    const edit = this.page.redo.pop();
    if (edit) { this.apply(edit, true); this.page.undo.push(edit); }
  }
  serialize(): string {
    return JSON.stringify({ version: 1, symbol: this.symbol, priceScale: this.priceScale,
      periods: Object.fromEntries([...this.pages].map(([period, page]) => [period, page.items])) });
  }
  restore(text: string | null, periods: readonly string[]): boolean {
    if (!text) return true;
    try {
      // Includes up to 24 styled levels per object across the supported periods.
      if (text.length > 16_000_000) return false;
      const value = JSON.parse(text);
      if (value.version !== 1 || value.symbol !== this.symbol || value.priceScale !== this.priceScale ||
        !value.periods || typeof value.periods !== 'object' || Array.isArray(value.periods)) return false;
      const pages = new Map<string, Page>();
      for (const [period, items] of Object.entries(value.periods)) {
        if (!periods.includes(period) || !Array.isArray(items) || items.length > MAX_DRAWINGS ||
          !items.every(validDrawing) || new Set(items.map(d => d.id)).size !== items.length) return false;
        pages.set(period, { items: clone(items), undo: [], redo: [] });
      }
      this.pages.clear();
      for (const [period, page] of pages) this.pages.set(period, page);
      this.selected = null;
      return true;
    } catch { return false; }
  }
}
