import type { Instrument } from '../../data/contracts';

export const PRICE_LINE_LIMIT = 16;
const MAX_DOCUMENT_BYTES = 32 * 1024;
export type PriceLineStyle = 'solid' | 'dashed' | 'dotted';
export interface PriceLine {
  id: number;
  price: number;
  title: string;
  color: string;
  width: 1 | 2 | 3 | 4;
  style: PriceLineStyle;
  visible: boolean;
  axisLabel: boolean;
}
export type PriceLineDraft = Omit<PriceLine, 'id'>;
export const DEFAULT_PRICE_LINE: Readonly<PriceLineDraft> = Object.freeze({
  price: 0, title: '', color: '#8a9eba', width: 1, style: 'dashed', visible: true, axisLabel: true,
});
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
type Identity = Pick<Instrument, 'symbol' | 'priceScale'>;
interface DocumentState { nextId: number; lines: PriceLine[]; saved: boolean; invalid: boolean }
function validDraft(value: unknown): value is PriceLineDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const line = value as PriceLineDraft;
  return Number.isSafeInteger(line.price) && Math.abs(line.price) <= 1e12 && typeof line.title === 'string'
    && line.title.length <= 64 && !/[\u0000-\u001f\u007f]/.test(line.title)
    && typeof line.color === 'string' && /^#[\da-f]{6}$/i.test(line.color)
    && [1, 2, 3, 4].includes(line.width) && ['solid', 'dashed', 'dotted'].includes(line.style)
    && typeof line.visible === 'boolean' && typeof line.axisLabel === 'boolean';
}
function knownDraft(line: PriceLineDraft): PriceLineDraft {
  return { price: line.price, title: line.title, color: line.color, width: line.width,
    style: line.style, visible: line.visible, axisLabel: line.axisLabel };
}
function knownLine(line: PriceLine): PriceLine { return { id: line.id, ...knownDraft(line) }; }
function identity(instrument: Identity): string { return `${encodeURIComponent(instrument.symbol)}:${instrument.priceScale}`; }

/** Price references are instrument-bound, shared across periods, and survive unavailable storage. */
export class PriceLineStore {
  private readonly documents = new Map<string, DocumentState>();
  constructor(private readonly storage?: StorageAccess) {}
  private document(instrument: Identity): DocumentState {
    const id = identity(instrument), existing = this.documents.get(id);
    if (existing) return existing;
    const result: DocumentState = { nextId: 1, lines: [], saved: this.storage !== undefined, invalid: false };
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(`zigchart.price-lines:${id}`);
    } catch { result.saved = false; }
    if (raw !== null && raw !== undefined) {
      try {
        // Bound both character allocation and UTF-8 document size before JSON parsing.
        if (raw.length > MAX_DOCUMENT_BYTES || new TextEncoder().encode(raw).length > MAX_DOCUMENT_BYTES) {
          throw new Error('Price line document exceeds its size limit');
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
          || parsed.version !== 1 || parsed.symbol !== instrument.symbol || parsed.priceScale !== instrument.priceScale
          || !Number.isSafeInteger(parsed.nextId) || parsed.nextId < 1 || parsed.nextId > 2 ** 31
          || !Array.isArray(parsed.lines) || parsed.lines.length > PRICE_LINE_LIMIT
          || parsed.lines.some((line: PriceLine) => !validDraft(line) || !Number.isSafeInteger(line.id) || line.id < 1 || line.id >= parsed.nextId)
          || new Set(parsed.lines.map((line: PriceLine) => line.id)).size !== parsed.lines.length) throw new Error('Invalid price line document');
        result.lines = parsed.lines.map(knownLine); result.nextId = parsed.nextId;
      } catch { result.invalid = true; result.saved = false; }
    }
    this.documents.set(id, result); return result;
  }
  items(instrument: Identity): PriceLine[] { return this.document(instrument).lines.map(knownLine); }
  status(instrument: Identity): { saved: boolean; invalid: boolean } {
    const { saved, invalid } = this.document(instrument); return { saved, invalid };
  }
  private save(instrument: Identity): void {
    const doc = this.document(instrument); doc.saved = false; doc.invalid = false;
    try {
      if (this.storage) {
        this.storage.setItem(`zigchart.price-lines:${identity(instrument)}`, JSON.stringify({
          version: 1, symbol: instrument.symbol, priceScale: instrument.priceScale, nextId: doc.nextId, lines: doc.lines,
        })); doc.saved = true;
      }
    } catch { /* Keep the current document in memory. */ }
  }
  put(instrument: Identity, draft: PriceLineDraft, id?: number): boolean {
    if (!validDraft(draft)) return false;
    const doc = this.document(instrument), index = doc.lines.findIndex(line => line.id === id);
    if (id !== undefined && index < 0) return false;
    if (id === undefined && (doc.lines.length >= PRICE_LINE_LIMIT || doc.nextId >= 2 ** 31)) return false;
    const line: PriceLine = { ...knownDraft(draft), title: draft.title.trim(), color: draft.color.toLowerCase(), id: id ?? doc.nextId++ };
    if (index >= 0) doc.lines[index] = line; else doc.lines.push(line);
    this.save(instrument); return true;
  }
  remove(instrument: Identity, id: number): boolean {
    const doc = this.document(instrument), index = doc.lines.findIndex(line => line.id === id);
    if (index < 0) return false;
    doc.lines.splice(index, 1); this.save(instrument); return true;
  }
}
