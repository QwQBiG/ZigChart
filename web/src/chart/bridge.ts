import type { Bar, BarInfo, Frame, PaneId, PaneInfo, PriceScaleMode } from './types';
import { DRAWING_KINDS as drawingKinds } from './drawing-types.ts';
import { encodeFibonacci, validFibonacciGeometry, type FibonacciGeometryOptions } from './fibonacci.ts';

type CoreExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  abi_version(): number;
  capacity(): number;
  input_ptr(): number;
  apply(mode: number, count: number): number;
  bar_count(): number;
  set_view(start: number, span: number): void;
  fit_time_range(from: number, to: number): number;
  resize_plot(width: number): void;
  set_pane_split(ratio: number): void;
  configure_indicators(maPeriod: number, emaPeriod: number, mask: number): number;
  configure_oscillators(rsi: number, fast: number, slow: number, signal: number, mask: number): number;
  overlay_input_ptr(): number;
  configure_overlays(): number;
  overlay_mask(): number;
  overlay_frame_ptr(): number;
  configure_bollinger(period: number, multiplier: number, enabled: number): number;
  bollinger_enabled(): number;
  bollinger_frame_ptr(): number;
  set_pane_weights(price: number, volume: number, rsi: number, macd: number): number;
  resize_pane(upper: number, delta: number, height: number): number;
  pane_weights_ptr(): number;
  set_pane_order(a: number, b: number, c: number, d: number): number;
  pane_order_ptr(): number;
  move_pane(id: number, direction: number): number;
  maximize_pane(id: number): number;
  maximized_pane(): number;
  pane_value_to_y(id: number, value: number, width: number, height: number): number;
  pane_value_at_y(id: number, y: number, width: number, height: number): number;
  pane_info_ptr(): number;
  pane_count(): number;
  oscillator_frame_ptr(): number;
  pane_ticks_ptr(): number;
  pane_tick_count(): number;
  pan(delta: number): void;
  zoom(factor: number, anchor: number): void;
  transform_view(factor: number, from: number, to: number): void;
  scale_price(factor: number, anchor: number): void;
  configure_price_scale(mode: number, inverted: number): number;
  price_to_y(price: number, width: number, height: number): number;
  price_at_y(y: number, width: number, height: number): number;
  reset_scale(): void;
  scale_is_auto(): number;
  follow(): void;
  frame(width: number, height: number): number;
  frame_ptr(): number;
  meta_ptr(): number;
  price_axis_ptr(): number;
  price_ticks_ptr(): number;
  price_tick_count(): number;
  hit(x: number, width: number): number;
  inspect(index: number): number;
  drawing_capacity(): number;
  drawing_input_ptr(): number;
  drawing_output_ptr(): number;
  drawing_strokes_ptr(): number;
  drawing_text_bounds_ptr(): number;
  drawing_fib_input_ptr(): number;
  drawing_fib_output_ptr(): number;
  drawing_project(count: number, width: number, height: number): number;
  drawing_point(x: number, y: number, width: number, height: number): number;
  drawing_translate(time: number, price: number, slots: number, delta: number): number;
  drawing_shift(time: number, price: number, fromX: number, fromY: number, toX: number, toY: number, width: number, height: number): number;
  drawing_hit(count: number, width: number, height: number, x: number, y: number, tolerance: number): number;
  measure(timeA: number, priceA: number, timeB: number, priceB: number, width: number, height: number): number;
};

const failures = ['OK', 'Invalid bar values', 'Bar capacity exceeded', 'Bars are out of order', 'Unknown update mode',
  'Correction timestamp is not loaded'];
const modes = { replace: 0, prepend: 1, upsert: 2, correct: 3 } as const;
const priceModes: Record<PriceScaleMode, number> = { normal: 0, logarithmic: 1, percentage: 2, indexed: 3 };

export interface DrawingAnchor { time: number; price: number }
export interface DrawingPoint extends DrawingAnchor { index: number }
export interface DrawingPrimitive { kind: keyof typeof drawingKinds; a: DrawingAnchor; b: DrawingAnchor; fibonacci?: FibonacciGeometryOptions }
export interface DrawingSegment { x1: number; y1: number; x2: number; y2: number }
export interface DrawingTextBounds { width: number; height: number }
export interface Measurement extends DrawingSegment {
  priceChange: number;
  percentChange: number | null;
  barDistance: number;
  elapsedMs: number;
  volume: number | null;
  barCount: number;
}
export interface ProjectedFibonacciLevel { slot: number; ratio: number; price: number; x1: number; y: number; x2: number }
export interface ProjectedDrawing extends DrawingSegment { valid: boolean; stroke: DrawingSegment | null; levels?: ProjectedFibonacciLevel[] }
export interface DrawingHit { index: number; handle: 0 | 1 | 2 }

export class ChartCore {
  private constructor(private readonly core: CoreExports) {
    if (core.abi_version() !== 1) throw new Error('Unsupported chart core ABI');
  }

  static async create(bytes?: BufferSource): Promise<ChartCore> {
    if (!bytes) {
      const response = await fetch(`${import.meta.env.BASE_URL}core.wasm`);
      if (!response.ok) throw new Error(`Chart core unavailable (${response.status})`);
      bytes = await response.arrayBuffer();
    }
    const result = await WebAssembly.instantiate(bytes, {});
    return new ChartCore(result.instance.exports as CoreExports);
  }

  get count(): number { return this.core.bar_count(); }

  apply(mode: keyof typeof modes, bars: Bar[]): void {
    if (!Object.hasOwn(modes, mode)) throw new Error('Unknown update mode');
    if (bars.length > this.core.capacity()) throw new Error(failures[2]);
    const values = new Float64Array(this.core.memory.buffer, this.core.input_ptr(), bars.length * 6);
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (!bar || typeof bar !== 'object') throw new Error('Each bar must be a complete OHLCV snapshot');
      const row = [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume];
      if (row.some(value => typeof value !== 'number')) throw new Error('Bar fields must be numbers');
      values.set(row, i * 6);
    }
    const status = this.core.apply(modes[mode], bars.length);
    if (status !== 0) throw new Error(failures[status] ?? `Core error ${status}`);
  }

  frame(width: number, height: number): Frame {
    const count = this.core.frame(width, height);
    const [requestedMode, effectiveMode, inverted, base] = new Float64Array(this.core.memory.buffer, this.core.price_axis_ptr(), 4);
    const paneValues = new Float64Array(this.core.memory.buffer, this.core.pane_info_ptr(), this.core.pane_count() * 7);
    const panes: PaneInfo[] = Array.from({ length: this.core.pane_count() }, (_, index) => {
      const [id, top, bottom, contentTop, contentBottom, min, max] = paneValues.subarray(index * 7, index * 7 + 7);
      return { id: id as PaneId, top, bottom, contentTop, contentBottom, min, max };
    });
    return {
      rows: new Float64Array(this.core.memory.buffer, this.core.frame_ptr(), count * 17).slice(),
      meta: new Float64Array(this.core.memory.buffer, this.core.meta_ptr(), 13).slice(),
      priceAxis: { requestedMode, effectiveMode, inverted: inverted === 1, base },
      priceTicks: new Float64Array(this.core.memory.buffer, this.core.price_ticks_ptr(), this.core.price_tick_count() * 3).slice(),
      panes,
      oscillators: new Float64Array(this.core.memory.buffer, this.core.oscillator_frame_ptr(), count * 8).slice(),
      averages: this.core.overlay_mask() ? new Float64Array(this.core.memory.buffer, this.core.overlay_frame_ptr(), count * 12).slice() : undefined,
      bollinger: this.core.bollinger_enabled() ? new Float64Array(this.core.memory.buffer, this.core.bollinger_frame_ptr(), count * 6).slice() : undefined,
      paneTicks: new Float64Array(this.core.memory.buffer, this.core.pane_ticks_ptr(), this.core.pane_tick_count() * 3).slice(),
    };
  }

  pan(delta: number): void { this.core.pan(delta); }
  configureBollinger(period: number, multiplier: number, enabled: boolean): void {
    if (!Number.isInteger(period) || period < 1 || period > 500 || !Number.isFinite(multiplier)
      || multiplier < .1 || multiplier > 10 || typeof enabled !== 'boolean'
      || this.core.configure_bollinger(period, multiplier, Number(enabled)) !== 0) {
      throw new Error('Invalid Bollinger Bands configuration');
    }
  }
  configureAverages(instances: readonly { slot: number; kind: 'ma' | 'ema'; period: number }[]): void {
    const seen = new Set<number>();
    for (const instance of instances) {
      if (!Number.isInteger(instance.slot) || instance.slot < 0 || instance.slot >= 6 || seen.has(instance.slot)
        || !['ma', 'ema'].includes(instance.kind) || !Number.isInteger(instance.period) || instance.period < 1 || instance.period > 500) {
        throw new Error('Invalid average instances');
      }
      seen.add(instance.slot);
    }
    const input = new Float64Array(this.core.memory.buffer, this.core.overlay_input_ptr(), 12);
    for (let slot = 0; slot < 6; slot++) { input[slot * 2] = 0; input[slot * 2 + 1] = 20; }
    for (const instance of instances) {
      input[instance.slot * 2] = instance.kind === 'ma' ? 1 : 2;
      input[instance.slot * 2 + 1] = instance.period;
    }
    if (this.core.configure_overlays() !== 0) throw new Error('Invalid average instances');
  }
  zoom(factor: number, anchor: number): void { this.core.zoom(factor, anchor); }
  transformView(factor: number, from: number, to: number): void { this.core.transform_view(factor, from, to); }
  scalePrice(factor: number, anchor: number): void { this.core.scale_price(factor, anchor); }
  configurePriceScale(mode: PriceScaleMode, inverted: boolean): void {
    if (!Object.hasOwn(priceModes, mode) || typeof inverted !== 'boolean' ||
      this.core.configure_price_scale(priceModes[mode], Number(inverted)) !== 0) throw new Error('Invalid price scale configuration');
  }
  priceToY(price: number, width: number, height: number): number { return this.core.price_to_y(price, width, height); }
  priceAtY(y: number, width: number, height: number): number { return this.core.price_at_y(y, width, height); }
  resetScale(): void { this.core.reset_scale(); }
  get scaleIsAuto(): boolean { return this.core.scale_is_auto() === 1; }
  follow(): void { this.core.follow(); }
  setView(start: number, span: number): void { this.core.set_view(start, span); }
  fitTimeRange(from: number, to: number): number { return this.core.fit_time_range(from, to); }
  resizePlot(width: number): void { this.core.resize_plot(width); }
  setPaneSplit(ratio: number): void { this.core.set_pane_split(ratio); }
  configureOscillators(rsi: number, fast: number, slow: number, signal: number, mask: number): void {
    if ([rsi, fast, slow, signal, mask].some(value => typeof value !== 'number') ||
      this.core.configure_oscillators(rsi, fast, slow, signal, mask) !== 0) throw new Error('Invalid oscillator configuration');
  }
  setPaneWeights(weights: readonly number[]): void {
    if (!Array.isArray(weights) || weights.length !== 4 || [0, 1, 2, 3].some(index => typeof weights[index] !== 'number') ||
      this.core.set_pane_weights(weights[0], weights[1], weights[2], weights[3]) !== 0) throw new Error('Invalid pane weights');
  }
  getPaneWeights(): number[] { return Array.from(new Float64Array(this.core.memory.buffer, this.core.pane_weights_ptr(), 4)); }
  setPaneOrder(order: readonly number[]): void {
    if (!Array.isArray(order) || order.length !== 4 || [0, 1, 2, 3].some(i => typeof order[i] !== 'number') ||
      this.core.set_pane_order(order[0], order[1], order[2], order[3]) !== 0) throw new Error('Invalid pane order');
  }
  getPaneOrder(): number[] { return Array.from(new Float64Array(this.core.memory.buffer, this.core.pane_order_ptr(), 4)); }
  movePane(id: number, direction: number): void {
    if (typeof id !== 'number' || typeof direction !== 'number' || this.core.move_pane(id, direction) !== 0) throw new Error('Invalid pane move');
  }
  maximizePane(id: number): void {
    if (typeof id !== 'number' || this.core.maximize_pane(id) !== 0) throw new Error('Invalid pane focus');
  }
  get maximizedPane(): number { return this.core.maximized_pane(); }
  resizePane(upperId: number, deltaPixels: number, height: number): void {
    if ([upperId, deltaPixels, height].some(value => typeof value !== 'number') ||
      this.core.resize_pane(upperId, deltaPixels, height) !== 0) throw new Error('Invalid pane resize');
  }
  paneValueToY(id: number, value: number, width: number, height: number): number { return this.core.pane_value_to_y(id, value, width, height); }
  paneValueAtY(id: number, y: number, width: number, height: number): number { return this.core.pane_value_at_y(id, y, width, height); }
  configureIndicators(maPeriod: number, emaPeriod: number, mask: number): void {
    if ([maPeriod, emaPeriod, mask].some(value => typeof value !== 'number') ||
      this.core.configure_indicators(maPeriod, emaPeriod, mask) !== 0) {
      throw new Error('Invalid indicator configuration');
    }
  }
  hit(x: number, width: number): number { return this.core.hit(x, width); }

  inspect(index: number): BarInfo | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return null;
    const pointer = this.core.inspect(index);
    if (!pointer) return null;
    const [i, time, open, high, low, close, volume, ma, ema] = new Float64Array(this.core.memory.buffer, pointer, 9);
    return { index: i, time, open, high, low, close, volume, ma, ema };
  }

  measure(a: DrawingAnchor, b: DrawingAnchor, width: number, height: number): Measurement | null {
    if (!a || !b || [a.time, a.price, b.time, b.price, width, height].some(value => typeof value !== 'number')) return null;
    const pointer = this.core.measure(a.time, a.price, b.time, b.price, width, height);
    if (!pointer) return null;
    const [x1, y1, x2, y2, priceChange, percent, barDistance, elapsedMs, volume, barCount] =
      new Float64Array(this.core.memory.buffer, pointer, 10);
    return { x1, y1, x2, y2, priceChange, percentChange: Number.isFinite(percent) ? percent : null,
      barDistance, elapsedMs, volume: Number.isFinite(volume) ? volume : null, barCount };
  }

  private writeDrawings(drawings: readonly DrawingPrimitive[]): void {
    if (drawings.length > this.core.drawing_capacity()) throw new Error('Drawing capacity exceeded');
    const values = new Float64Array(this.core.memory.buffer, this.core.drawing_input_ptr(), drawings.length * 6);
    for (let i = 0; i < drawings.length; i++) {
      const item = drawings[i];
      if (!item || !Object.hasOwn(drawingKinds, item.kind) || !item.a || !item.b) throw new Error('Invalid drawing primitive');
      const row = [drawingKinds[item.kind], item.a.time, item.a.price, item.b.time, item.b.price, 0];
      if (row.some(value => typeof value !== 'number')) throw new Error('Drawing anchor fields must be numbers');
      values.set(row, i * 6);
      if (item.kind === 'fibonacci') {
        if (!validFibonacciGeometry(item.fibonacci)) throw new Error('Invalid Fibonacci configuration');
        encodeFibonacci(item.fibonacci, new Float64Array(this.core.memory.buffer, this.core.drawing_fib_input_ptr() + i * 25 * 8, 25));
      }
    }
  }

  projectDrawings(drawings: readonly DrawingPrimitive[], width: number, height: number): ProjectedDrawing[] {
    if (drawings.length === 0) return [];
    this.writeDrawings(drawings);
    const count = this.core.drawing_project(drawings.length, width, height);
    if (count < 0) throw new Error('Drawing capacity exceeded');
    const values = new Float64Array(this.core.memory.buffer, this.core.drawing_output_ptr(), count * 5);
    const strokes = new Float64Array(this.core.memory.buffer, this.core.drawing_strokes_ptr(), count * 5);
    return Array.from({ length: count }, (_, i) => {
      const offset = i * 5;
      const stroke = strokes[offset] === 1 ? { x1: strokes[offset + 1], y1: strokes[offset + 2], x2: strokes[offset + 3], y2: strokes[offset + 4] } : null;
      const result: ProjectedDrawing = { valid: values[offset] === 1, x1: values[offset + 1], y1: values[offset + 2], x2: values[offset + 3], y2: values[offset + 4], stroke };
      if (drawings[i].kind === 'fibonacci') {
        const levels = new Float64Array(this.core.memory.buffer, this.core.drawing_fib_output_ptr() + i * 144 * 8, 144);
        result.levels = [];
        for (let slot = 0; slot < 24; slot++) {
          const n = slot * 6;
          if (levels[n] === 1) result.levels.push({ slot, ratio: levels[n + 1], price: levels[n + 2], x1: levels[n + 3], y: levels[n + 4], x2: levels[n + 5] });
        }
      }
      return result;
    });
  }

  private readDrawingPoint(pointer: number): DrawingPoint | null {
    if (!pointer) return null;
    const [time, price, index] = new Float64Array(this.core.memory.buffer, pointer, 3);
    return { time, price, index };
  }

  drawingPoint(x: number, y: number, width: number, height: number): DrawingPoint | null {
    return this.readDrawingPoint(this.core.drawing_point(x, y, width, height));
  }

  translateAnchor(anchor: DrawingAnchor, slotDelta: number, priceDelta: number): DrawingPoint | null {
    if (!anchor || [anchor.time, anchor.price, slotDelta, priceDelta].some(value => typeof value !== 'number')) return null;
    return this.readDrawingPoint(this.core.drawing_translate(anchor.time, anchor.price, slotDelta, priceDelta));
  }

  shiftDrawingAnchor(anchor: DrawingAnchor, from: { x: number; y: number }, to: { x: number; y: number }, width: number, height: number): DrawingPoint | null {
    if (!anchor || !from || !to || [anchor.time, anchor.price, from.x, from.y, to.x, to.y, width, height].some(value => typeof value !== 'number')) return null;
    return this.readDrawingPoint(this.core.drawing_shift(anchor.time, anchor.price, from.x, from.y, to.x, to.y, width, height));
  }

  hitDrawings(drawings: readonly DrawingPrimitive[], width: number, height: number, x: number, y: number, tolerance = 6,
    textBounds: readonly (DrawingTextBounds | null | undefined)[] = []): DrawingHit | null {
    if (drawings.length === 0) return null;
    this.writeDrawings(drawings);
    const bounds = new Float64Array(this.core.memory.buffer, this.core.drawing_text_bounds_ptr(), drawings.length * 2);
    bounds.fill(0);
    for (let i = 0; i < drawings.length; i++) {
      const size = textBounds[i];
      if (drawings[i].kind === 'text' && size && Number.isFinite(size.width) && Number.isFinite(size.height) &&
        size.width > 0 && size.height > 0 && size.width <= 65536 && size.height <= 65536) {
        bounds[i * 2] = size.width; bounds[i * 2 + 1] = size.height;
      }
    }
    const pointer = this.core.drawing_hit(drawings.length, width, height, x, y, tolerance);
    if (!pointer) return null;
    const [index, handle] = new Float64Array(this.core.memory.buffer, pointer, 2);
    return { index, handle: handle as 0 | 1 | 2 };
  }
}
