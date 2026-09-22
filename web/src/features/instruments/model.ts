import type { Instrument } from '../../chart/types';
import { DrawingDocument } from '../drawings/document.ts';
import type { SeriesStyle } from '../series/model';

type Preferences = Pick<Storage, 'getItem' | 'setItem'>;
type Baseline = Pick<SeriesStyle, 'baselineSource' | 'baselinePrice'>;
export interface InstrumentDocument {
  document: DrawingDocument;
  key: string;
  invalid: boolean;
  saved: boolean;
}
export const SYMBOL_KEY = 'zigchart.symbol';
const defaultBaseline: Baseline = { baselineSource: 'first-visible', baselinePrice: 0 };
function identity(instrument: Pick<Instrument, 'symbol' | 'priceScale'>): string {
  return `${encodeURIComponent(instrument.symbol)}:${instrument.priceScale}`;
}
function read(storage: Preferences | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
export function selectedSymbol(raw: string | null, supported: readonly string[], fallback: string): string {
  return raw !== null && supported.includes(raw) ? raw : fallback;
}

/** Keep unsaved documents and symbol-specific prices alive during this visit. */
export class InstrumentWorkspace {
  private readonly documents = new Map<string, InstrumentDocument>();
  private readonly baselines = new Map<string, Baseline>();
  constructor(private readonly storage: Preferences | undefined, private readonly periods: readonly string[],
    private readonly legacy: Pick<Instrument, 'symbol' | 'priceScale'>, private readonly legacyBaseline: Baseline) {}

  drawing(instrument: Instrument): InstrumentDocument {
    const id = identity(instrument), known = this.documents.get(id);
    if (known) return known;
    const key = `zigchart.drawings:${id}`;
    const saved = read(this.storage, key);
    const raw = saved ?? (id === identity(this.legacy) ? read(this.storage, 'zigchart.drawings') : null);
    const document = new DrawingDocument(instrument.symbol, instrument.priceScale);
    const record = { document, key, invalid: !document.restore(raw, this.periods), saved: true };
    this.documents.set(id, record);
    return record;
  }
  saveDrawing(record: InstrumentDocument): void {
    record.saved = false;
    try {
      if (this.storage) { this.storage.setItem(record.key, record.document.serialize()); record.saved = true; record.invalid = false; }
    } catch { /* In-memory documents survive symbol switches. */ }
  }
  baseline(instrument: Instrument): Baseline {
    const id = identity(instrument), known = this.baselines.get(id);
    if (known) return { ...known };
    let value = { ...(id === identity(this.legacy) ? this.legacyBaseline : defaultBaseline) };
    const raw = read(this.storage, `zigchart.baseline:${id}`);
    if (raw !== null) {
      value = { ...defaultBaseline };
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && ['price', 'first-visible'].includes(parsed.baselineSource)
          && Number.isSafeInteger(parsed.baselinePrice) && Math.abs(parsed.baselinePrice) <= 1e12) {
          value = { baselineSource: parsed.baselineSource, baselinePrice: parsed.baselinePrice };
        }
      } catch { /* Invalid saved prices use the automatic baseline. */ }
    }
    this.baselines.set(id, value);
    return { ...value };
  }
  saveBaseline(instrument: Instrument, value: Baseline): void {
    const id = identity(instrument), baseline = { baselineSource: value.baselineSource, baselinePrice: value.baselinePrice };
    this.baselines.set(id, baseline);
    try { this.storage?.setItem(`zigchart.baseline:${id}`, JSON.stringify({ version: 1, ...baseline })); }
    catch { /* In-memory baseline prices survive symbol switches. */ }
  }
}
