import type { ChartCore, DrawingPoint, DrawingPrimitive, DrawingTextBounds } from '../../chart/bridge';
import { DrawingDocument } from './document.ts';
import type { Drawing } from './document';
import { isSingleAnchor } from '../../chart/drawing-types.ts';
import { createFibonacciStyle } from './fibonacci-model.ts';
import { createTextStyle } from './text-model.ts';

export type DrawingTool = 'pointer' | DrawingPrimitive['kind'];
type Point = { x: number; y: number };
type Move = { original: Drawing; start: DrawingPoint | null; pointer: Point; handle: 0 | 1 | 2 };
interface TextOptions {
  initialContent?(): string;
  bounds?(drawings: readonly Drawing[]): readonly (DrawingTextBounds | null)[];
}

/** Pointer gestures preview data-space edits; only completed gestures enter history. */
export class DrawingEditor {
  tool: DrawingTool = 'pointer';
  color = '#4f8cff';
  width = 2;
  private preview: Drawing | null = null;
  private move: Move | null = null;
  private creating = false;

  constructor(readonly document: DrawingDocument, private readonly core: () => ChartCore,
    private readonly size: () => { width: number; height: number }, private readonly changed: (save: boolean) => void,
    private readonly textOptions: TextOptions = {}) {}

  get dragging(): boolean { return this.move !== null; }
  get drawing(): boolean { return this.creating; }
  get items(): readonly Drawing[] {
    const items = [...this.document.items];
    if (this.preview) {
      const index = items.findIndex(d => d.id === this.preview?.id);
      if (index >= 0) items[index] = this.preview;
      else items.push(this.preview);
    }
    return items;
  }
  get selected(): string | null { return this.preview?.id ?? this.document.selected; }
  setTool(tool: DrawingTool): void {
    this.cancel();
    this.tool = tool;
    if (tool !== 'pointer') this.document.selected = null;
    this.changed(false);
  }
  private point(point: Point): DrawingPoint | null {
    const size = this.size();
    return this.core().drawingPoint(point.x, point.y, size.width, size.height);
  }
  down(point: Point): boolean {
    const anchor = this.point(point);
    if (this.tool !== 'pointer') {
      if (!anchor || this.document.full) return true;
      if (this.creating && this.preview) {
        this.preview.b = { time: anchor.time, price: anchor.price };
        this.document.add(this.preview);
        this.preview = null; this.creating = false; this.tool = 'pointer'; this.changed(true);
      } else {
        const a = { time: anchor.time, price: anchor.price };
        this.preview = { id: crypto.randomUUID(), kind: this.tool, a, b: { ...a },
          color: this.color, width: this.width, locked: false };
        if (this.tool === 'fibonacci') this.preview.fibonacci = createFibonacciStyle();
        if (this.tool === 'text') this.preview.text = createTextStyle(this.textOptions.initialContent?.() ?? 'Text');
        if (isSingleAnchor(this.tool)) {
          this.document.add(this.preview); this.preview = null; this.tool = 'pointer'; this.changed(true);
        } else { this.creating = true; this.changed(false); }
      }
      return true;
    }
    const size = this.size();
    const items = this.document.items;
    const hit = this.core().hitDrawings(items, size.width, size.height, point.x, point.y, 6, this.textOptions.bounds?.(items));
    this.document.selected = hit ? items[hit.index].id : null;
    if (hit && !items[hit.index].locked && (anchor || (items[hit.index].kind === 'text' && hit.handle === 0))) {
      this.move = { original: structuredClone(items[hit.index]), start: anchor, pointer: { ...point }, handle: hit.handle };
      this.preview = structuredClone(items[hit.index]);
    }
    this.changed(false);
    return hit !== null;
  }
  motion(point: Point): void {
    if (!this.creating && !this.move) return;
    if (this.move?.original.kind === 'text' && this.move.handle === 0 && this.preview) {
      const size = this.size();
      const shifted = this.core().shiftDrawingAnchor(this.move.original.a, this.move.pointer, point, size.width, size.height);
      if (shifted) {
        this.preview.a = { time: shifted.time, price: shifted.price };
        this.preview.b = { ...this.preview.a }; this.changed(false);
      }
      return;
    }
    const anchor = this.point(point);
    if (!anchor || !this.preview) return;
    if (this.creating) this.preview.b = { time: anchor.time, price: anchor.price };
    else if (this.move) {
      const { original, start, handle } = this.move;
      if (handle !== 0) {
        this.preview[handle === 1 ? 'a' : 'b'] = { time: anchor.time, price: anchor.price };
        if (isSingleAnchor(original.kind)) this.preview.b = { ...this.preview.a };
      } else {
        if (!start) return;
        const currentStart = this.core().translateAnchor(start, 0, 0);
        if (!currentStart) return;
        const slots = anchor.index - currentStart.index;
        const price = anchor.price - start.price;
        const a = this.core().translateAnchor(original.a, slots, price);
        const b = isSingleAnchor(original.kind) ? a : this.core().translateAnchor(original.b, slots, price);
        if (a && b) {
          this.preview.a = { time: a.time, price: a.price };
          this.preview.b = { time: b.time, price: b.price };
        }
      }
    }
    this.changed(false);
  }
  up(): void {
    if (!this.move) return;
    if (this.preview) this.document.update(this.preview);
    this.preview = null; this.move = null; this.changed(true);
  }
  cancel(): void {
    this.preview = null; this.move = null; this.creating = false;
    this.changed(false);
  }
  edit(action: 'undo' | 'redo' | 'delete' | 'lock'): void {
    this.cancel();
    if (action === 'undo') this.document.undo();
    else if (action === 'redo') this.document.redo();
    else if (action === 'delete') this.document.removeSelected();
    else {
      const selected = this.document.selection;
      if (selected) this.document.update({ ...selected, locked: !selected.locked });
    }
    this.changed(true);
  }
  style(color: string, width: number): void {
    this.color = color; this.width = width;
    const selected = this.creating ? null : this.document.selection;
    if (selected) this.document.update({ ...selected, color, width });
    if (this.preview) { this.preview.color = color; this.preview.width = width; }
    this.changed(!!selected);
  }
}
