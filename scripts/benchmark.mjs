import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { sampleBar } from '../web/src/data/sample-feed.ts';

const wasm = readFileSync(process.env.BENCHMARK_WASM_PATH || 'web/public/core.wasm');
const core = await ChartCore.create(wasm);
const raw = (await WebAssembly.instantiate(wasm, {})).instance.exports;
const bars = Array.from({ length: 100_000 }, (_, i) => sampleBar(i));
const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)];
function measure(action, operationsPerSample = 1, prepare = () => {}) {
  const run = () => { for (let i = 0; i < operationsPerSample; i++) action(); };
  for (let i = 0; i < 10; i++) { prepare(); run(); }
  const values = [];
  for (let i = 0; i < 31; i++) {
    prepare();
    const start = performance.now();
    run();
    values.push((performance.now() - start) / operationsPerSample);
  }
  return { samples: values.length, operationsPerSample, medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95), samplesMs: values };
}

const rawInput = new Float64Array(raw.memory.buffer, raw.input_ptr(), bars.length * 6);
for (let i = 0; i < bars.length; i++) {
  const bar = bars[i];
  rawInput.set([bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume], i * 6);
}
if (raw.apply(0, bars.length) !== 0) throw new Error('Raw snapshot rejected');
const memoryBytes = raw.memory.buffer.byteLength;
const last = bars.at(-1);
const revisions = [last, { ...last, close: last.close + 1, high: Math.max(last.high, last.close + 1) }];
const revisionBatches = revisions.map(bar => [bar]);
const revisionRows = revisions.map(bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]);
const results = {};
for (const period of [20, 500]) {
  core.configureIndicators(period, period, 7);
  if (raw.configure_indicators(period, period, 7) !== 0) throw new Error('Raw configuration rejected');
  const snapshot = measure(() => core.apply('replace', bars));
  const tail = bars.slice(2500);
  const history = bars.slice(0, 2500);
  const prepend = measure(() => core.apply('prepend', history), 1, () => core.apply('replace', tail));
  let revision = 0;
  const update = measure(() => core.apply('upsert', revisionBatches[revision++ & 1]), 2000);
  const rawUpdate = measure(() => {
    rawInput.set(revisionRows[revision++ & 1], 0);
    if (raw.apply(2, 1) !== 0) throw new Error('Raw revision rejected');
  }, 2000);
  // Match the browser's width contract; an oversized request is clamped by the core.
  core.resizePlot(1400);
  core.setView(50_000, 2000);
  const geometry = core.frame(1400, 750);
  const drawings = Array.from({ length: 256 }, (_, i) => {
    const a = bars[50_000 + i % 200];
    const b = bars[50_000 + (i + 25) % 200];
    return { kind: ['horizontal', 'trend', 'rectangle'][i % 3],
      a: { time: a.time, price: a.close }, b: { time: b.time, price: b.close } };
  });
  const extensions = drawings.map((drawing, i) => ({ ...drawing,
    kind: ['vertical', 'ray', 'extended', 'horizontalRay'][i % 4] }));
  results[period] = {
    load: { storedBars: core.count, requestedSpan: 2000, actualSpan: geometry.meta[9],
      projectedRows: geometry.rows.length / 17, plotCssPixels: [1400, 750], indicators: 'MA, EMA, Volume', drawings: 256 },
    snapshotIncludingMarshal: snapshot, prepend2500Into97500IncludingMarshal: prepend,
    finalBarRevisionIncludingMarshal: update, finalBarRevisionPrepackedNumericInput: rawUpdate,
    frameIncludingCopy: measure(() => core.frame(1400, 750), 100),
    drawingProjectionIncludingMarshalAndCopy: measure(() => core.projectDrawings(drawings, 1400, 750), 100),
    drawingExtensionProjectionIncludingMarshalAndCopy: measure(() => core.projectDrawings(extensions, 1400, 750), 100),
    drawingPointerConversion: measure(() => core.drawingPoint(700, 250, 1400, 750), 100),
  };
}
core.configureIndicators(20, 20, 3);
const retracements = Array.from({ length: 256 }, (_, i) => ({ kind: 'fibonacci',
  a: { time: bars[50_000 + i % 200].time, price: bars[50_000 + i % 200].close },
  b: { time: bars[50_000 + (i + 25) % 200].time, price: bars[50_000 + (i + 25) % 200].close },
  fibonacci: { extendLeft: true, extendRight: true, reverse: false, logarithmic: false, trend: true,
    levels: Array.from({ length: 24 }, (_, slot) => ({ ratio: slot / 23, enabled: true })) },
}));
results.fibonacci = {
  load: { storedBars: core.count, drawings: 256, levelsPerDrawing: 24, plotCssPixels: [1400, 750],
    projectedRows: core.frame(1400, 750).rows.length / 17 },
  projectionIncludingMarshalAndCopy: measure(() => core.projectDrawings(retracements, 1400, 750), 30),
};
core.configureAverages(Array.from({ length: 6 }, (_, slot) => ({ slot, kind: slot % 2 ? 'ema' : 'ma', period: [20, 50, 100][slot % 3] })));
core.apply('replace', bars); core.resizePlot(1400); core.setView(50_000, 2000);
let averageRevision = 0;
results.multipleAverages = {
  load: { storedBars: core.count, primaryAverages: 2, additionalAverages: 6, periods: [20, 50, 100, 20, 50, 100],
    projectedRows: core.frame(1400, 750).rows.length / 17, plotCssPixels: [1400, 750] },
  finalBarRevisionIncludingMarshal: measure(() => core.apply('upsert', revisionBatches[averageRevision++ & 1]), 2000),
  frameIncludingCopy: measure(() => core.frame(1400, 750), 100),
};
console.log(JSON.stringify({
  environment: { os: `${platform()} ${release()}`, cpu: cpus()[0].model, node: process.version },
  artifact: { sha256: createHash('sha256').update(wasm).digest('hex'), mode: 'ReleaseFast',
    zig: readFileSync('.zig-version', 'utf8').trim(), memoryBytes, finalMemoryBytes: raw.memory.buffer.byteLength },
  results,
  scope: 'Node Wasm and bridge CPU timings; excludes browser painting, compositing and input latency. Each sample is mean milliseconds per operation; setup is untimed. Prepacked revisions include copying six numbers and the raw Wasm call; other cases include bridge work.',
}, null, 2));
