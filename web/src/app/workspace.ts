import '../ui/workspace.css';
import '../chart/price-scale-controls.css';
import '../features/series/controls.css';
import { createChartInput } from './chart-input';
import { ChartCore } from '../chart/bridge';
import { SampleFeed } from '../data/sample-feed';
import { DEFAULT_SYMBOL, SAMPLE_CATALOG, findSampleInstrument } from '../data/catalog';
import { InstrumentWorkspace, selectedSymbol, SYMBOL_KEY } from '../features/instruments/model';
import type { BarInfo, Frame } from '../chart/types';
import { AXIS_WIDTH, TIME_HEIGHT, drawChart, drawCrosshair, type RenderOptions } from '../chart/render';
import { chooseLocale, getLocale, setLocale, t, translateDocument } from '../ui/i18n';
import type { MessageKey } from '../ui/i18n';
import { PERIODS, getPeriod, nextBucketStart } from '../data/periods';
import { RangeController } from '../features/range/controller';
import { createRangeControls } from '../features/range/controls';
import { MarketSession } from '../data/session';
import { createReplayController } from '../features/replay/controller';
import { drawReplaySelection } from '../features/replay/selection';
import { createMeasureController } from '../features/measure/controller';
import { createMeasureReadout } from '../features/measure/controls';
import { drawMeasure } from '../features/measure/render';
import '../features/measure/controls.css';
import { readAppearance } from '../features/appearance/model';
import type { Appearance } from '../features/appearance/model';
import { createAppearancePanel } from '../features/appearance/panel';
import { createDrawingPanel } from '../features/drawings/panel';
import { createFibonacciControls } from '../features/drawings/fibonacci-controls';
import { createTextControls } from '../features/drawings/text-controls';
import { getTextLayout } from '../features/drawings/text-render';
import '../features/drawings/text-controls.css';
import { createTouchNavigation } from '../chart/touch-navigation';
import { createDrawingTools } from '../features/drawings/tools';
import { createMarketSidebar } from '../features/watchlist/panel';
import { drawSeriesSelection } from '../features/series/selection';
import { readSeriesStyle, parseSeriesStyle } from '../features/series/model';
import type { SeriesStyle } from '../features/series/model';
import { createSeriesControls } from '../features/series/controls';
import { readScales, parseScales, type ScalePreferences } from '../features/scales/model';
import { syncScaleFeedback } from '../features/scales/feedback';
import { readCrosshairStyle, parseCrosshairStyle, type CrosshairStyle } from '../features/crosshair/model';
import { resolveCrosshair } from '../features/crosshair/resolve';
import { createCrosshairControls } from '../features/crosshair/controls';
import '../features/crosshair/controls.css';
import type { Drawing } from '../features/drawings/document';
import { DrawingEditor } from '../features/drawings/editor';
import type { DrawingTool } from '../features/drawings/editor';
import { drawAnnotations } from '../features/drawings/render';
import { createWorkspaceLayout } from '../ui/workspace-layout';
import { createPaneActions } from '../ui/pane-actions';
import { setupSelectControls } from '../ui/select-control';
import { createAnalysisLibrary } from '../features/analysis/panel';
import { createIndicatorState, parseIndicatorState, setIndicatorEnabled } from '../features/analysis/model';
import type { IndicatorState } from '../features/analysis/model';
import { createIndicatorLegends } from '../features/analysis/legend';
import { averageValuesAt, bollingerValuesAt, oscillatorValuesAt } from '../features/analysis/values';
import { createChartLayers } from '../chart/layers';
import { createFrameScheduler } from '../chart/scheduler';
import type { ChartInvalidation } from '../chart/scheduler';
import { createPriceScaleControls } from '../chart/price-scale-controls';
import { createTimeScaleControls } from '../chart/time-scale-controls';
import '../chart/time-scale-controls.css';
import { createChartReadout, setText } from '../ui/chart-readout';
import { syncDrawingFeedback, syncPanelFeedback } from '../ui/control-feedback';
import { createFullscreenControl } from '../ui/fullscreen';
import { createSnapshotControls } from '../features/export/controls';
import { captureChartSnapshot } from '../features/export/scene';
import '../features/export/controls.css';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

function preference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
const savedLocale = preference('zigchart.locale');
setLocale(chooseLocale(savedLocale, navigator.languages));
translateDocument(document);
let preferenceStorage: Storage | undefined;
try { preferenceStorage = window.localStorage; } catch { /* Session-only preferences remain available. */ }
let instrument = findSampleInstrument(selectedSymbol(preference(SYMBOL_KEY),
  SAMPLE_CATALOG.map(entry => entry.instrument.symbol), DEFAULT_SYMBOL))!.instrument;

const languageSelect = element<HTMLSelectElement>('language-select');
const periodSelect = element<HTMLSelectElement>('period-select');
const canvas = element<HTMLCanvasElement>('chart');
const overlayCanvas = element<HTMLCanvasElement>('chart-overlay-canvas');
const container = element('chart-container');
const context = canvas.getContext('2d', { alpha: false });
const ctx = context!;
const overlay = overlayCanvas.getContext('2d')!;
const surface = ctx && overlay ? createChartLayers(canvas, ctx, overlayCanvas, overlay, container) : null;
const historyButton = element<HTMLButtonElement>('load-history');
const latestButton = element<HTMLButtonElement>('go-latest');
const tooltip = element('chart-tooltip');
const readout = createChartReadout(element('ohlc'), element('selected-time'), tooltip, () => instrument);
let core: ChartCore;
let frame: Frame | null = null;
let width = 1;
let height = 1;
let pixelRatio = 1;
const scheduler = createFrameScheduler(paint);
let disposed = false;
let indicators = restoreIndicators();
let partialLastBar = false;
let snapshotCutoff: number | null = null;
let appearance = readAppearance(preference('zigchart.appearance'));
const savedSeriesStyle = preference('zigchart.series');
let seriesStyle = readSeriesStyle(savedSeriesStyle);
const instrumentWorkspace = new InstrumentWorkspace(preferenceStorage, PERIODS.map(period => period.id),
  findSampleInstrument(DEFAULT_SYMBOL)!.instrument, seriesStyle);
instrumentWorkspace.saveBaseline(findSampleInstrument(DEFAULT_SYMBOL)!.instrument,
  instrumentWorkspace.baseline(findSampleInstrument(DEFAULT_SYMBOL)!.instrument));
seriesStyle = { ...seriesStyle, ...instrumentWorkspace.baseline(instrument) };
let scalePreferences = readScales(preference('zigchart.scales'));
let crosshairStyle = readCrosshairStyle(preference('zigchart.crosshair'));
if (savedSeriesStyle === null && appearance.candleStyle === 'hollow') seriesStyle.type = 'hollow';
let drawingsStored = true;
let drawingRestoreFailed = false;
let drawingListSignature = '';
let seriesSelected = false;
let emptyState: 'preparing' | 'noHistory' | 'historyError' | 'coreError' | null = 'preparing';
let errorKey: MessageKey | null = null;
let sessionFeedbackKey = '';
const samples: number[] = [];
let lastMetric = 0;
let drawingRecord = instrumentWorkspace.drawing(instrument);
let drawings = drawingRecord.document;
drawingRestoreFailed = drawingRecord.invalid;
let editor = createEditor();
function createEditor(): DrawingEditor {
  return new DrawingEditor(drawings, () => core,
    () => ({ width: width - AXIS_WIDTH, height: height - TIME_HEIGHT }), drawingChanged,
    { initialContent: () => t('textTool'), bounds: textBounds });
}
function textBounds(items: readonly Drawing[]) {
  return items.map(item => item.kind === 'text' && item.text ? getTextLayout(ctx, item.text) : null);
}
const session = new MarketSession(new SampleFeed(instrument.symbol), {
  reset(period) {
    readout.reset();
    setSeriesSelected(false);
    cancelChartGesture(); drawings.switchPeriod(period); editor.tool = 'pointer';
    frame = null; tooltip.hidden = true;
    canvas.classList.remove('dragging');
    layout.resetFrame(); legends.resetFrame(); paneActions.resetFrame();
    core.apply('replace', []);
    ctx?.clearRect(0, 0, width, height);
    partialLastBar = false; errorKey = null; emptyState = 'preparing';
    updateSnapshot(null);
    updateHostText();
  },
  history(page, initial) {
    if (initial && page.asOf !== undefined) snapshotCutoff = page.asOf;
    else if (initial && page.bars.length && !session.browsingHistory) {
      // Historical bar times cannot replace the known current-data cutoff.
      const last = page.bars[page.bars.length - 1];
      snapshotCutoff = page.partialLastBar ? last.time + 1 : nextBucketStart(last.time, page.periodId);
    }
    if (page.bars.length) core.apply(initial ? 'replace' : 'prepend', page.bars);
    if (initial && core.count > 0 && core.count < 96) {
      core.setView(0, Math.max(10, (core.count - .5) / .8));
      core.follow();
    }
    if (initial) partialLastBar = page.partialLastBar;
    errorKey = null; emptyState = core.count ? null : 'noHistory';
    const latest = core.inspect(core.count - 1);
    if (latest) updateSnapshot(latest);
  },
  bars(bars, partial) {
    core.apply('upsert', bars); partialLastBar = partial;
    const latest = core.inspect(core.count - 1);
    if (session.replayState?.active) snapshotCutoff = session.replayState.cutoff;
    else if (latest) snapshotCutoff = Math.max(snapshotCutoff ?? 0, partial ? latest.time + 1 : nextBucketStart(latest.time, session.period));
    if (latest) updateSnapshot(latest);
    requestPaint();
  },
  change: updateSessionFeedback,
  corrections(bars) {
    core.apply('correct', bars);
    const latest = core.inspect(core.count - 1);
    if (latest) updateSnapshot(latest);
    requestPaint();
  },
  error(error, source) {
    reportError(error, source === 'history' ? 'errorHistory' : source === 'stream' ? 'errorStream' : 'errorUpdate');
    if (source === 'history' && !core.count) emptyState = 'historyError';
  },
});

const selects = setupSelectControls();
const rangeController = new RangeController({
  cutoff: () => snapshotCutoff, width: () => width - AXIS_WIDTH,
  open: async (period, before) => {
    replay.cancelSelection();
    cancelChartGesture();
    await session.open(period, before);
    if (errorKey === 'errorHistory') throw new Error('Range history request failed');
    try { localStorage.setItem('zigchart.period', session.period); } catch { /* Optional preference storage. */ }
  },
  load: async before => {
    await session.load(before);
    if (errorKey === 'errorHistory') throw new Error('Range history request failed');
  }, first: () => core?.inspect(0)?.time ?? null,
  hasMore: () => session.hasMore,
  fit: (from, to) => core.fitTimeRange(from, to),
  change: () => { rangeControls.refresh(); requestPaint(); },
});
const rangeElement = document.createElement('div'); rangeElement.id = 'chart-ranges';
element('chart-container').after(rangeElement);
const rangeControls = createRangeControls(rangeElement, rangeController, () => session.ready);
const replayElement = document.createElement('div'); replayElement.id = 'chart-replay'; rangeElement.before(replayElement);
const replay = createReplayController({
  session, container: replayElement, trigger: element<HTMLButtonElement>('header-replay'),
  cancelNavigation: () => { rangeController.cancel(); cancelChartGesture(); },
  selectPointer: () => {
    drawings.selected = null; editor.setTool('pointer'); setSeriesSelected(false); canvas.focus({ preventScroll: true });
  },
  onChange: requestPaint, refreshSelects: () => selects.refresh(),
});
const measureButton = element<HTMLButtonElement>('measure-tool');
const measure = createMeasureController({ getCore: () => core,
  getSize: () => ({ width: width - AXIS_WIDTH, height: height - TIME_HEIGHT }), onChange: requestOverlayPaint });
const measureReadout = createMeasureReadout(container, () => instrument);
const drawingTools = createDrawingTools(element<HTMLSelectElement>('line-tool-select'), tool => {
  replay.cancelSelection(); clearMeasurement();
  editor.setTool(tool); canvas.focus({ preventScroll: true });
});
const seriesControls = createSeriesControls(element<HTMLSelectElement>('series-type-select'), {
  getState: () => seriesStyle, onChange: changeSeriesStyle,
});
const appearancePanel = createAppearancePanel({ getState: () => appearance,
  getPriceScale: () => instrument.priceScale,
  getSeriesState: () => seriesStyle,
  getScaleState: () => scalePreferences,
  onApply(next: Appearance, nextSeries: SeriesStyle, nextScales: ScalePreferences) {
    appearance = next; changeSeriesStyle(nextSeries); changeScales(nextScales); applyAppearance(true);
  },
  refreshControls: () => selects.refresh(), onClose: () => canvas.focus({ preventScroll: true }),
});
const crosshairPanel = createCrosshairControls(document.body, {
  trigger: element('crosshair-settings-open'),
  getState: () => crosshairStyle, onChange: changeCrosshair,
  refreshControls: () => selects.refresh(), onClose: () => {
    const button = element('crosshair-settings-open');
    button.setAttribute('aria-expanded', 'false'); button.classList.remove('active');
    canvas.focus({ preventScroll: true });
  },
});
const drawingPanel = createDrawingPanel();
const fibonacciControls = createFibonacciControls({ container: element('drawing-panel').querySelector('.drawing-card')!,
  getSelection: () => drawings.selection,
  onChange: value => {
    const selected = drawings.selection;
    if (selected?.kind === 'fibonacci' && drawings.update({ ...selected, fibonacci: value })) drawingChanged(true);
  },
});
const textControls = createTextControls({ container: element('drawing-panel').querySelector('.drawing-card')!,
  getSelection: () => drawings.selection,
  onChange: value => {
    const selected = drawings.selection;
    if (selected?.kind === 'text' && drawings.update({ ...selected, text: value })) drawingChanged(true);
  },
});
function openTextSettings(): void {
  cancelChartGesture(); drawingChanged(false); drawingPanel.open(); textControls.focus();
}
const marketSidebar = createMarketSidebar(element('market-sidebar'), { catalog: SAMPLE_CATALOG,
  getInstrument: () => instrument, canSelect: () => !!core, onSelect: symbol => { void switchInstrument(symbol); },
});
element('symbol-open').addEventListener('click', () => marketSidebar.openPicker());
const library = createAnalysisLibrary({ getState: () => indicators, onChange: changeIndicators });
const legends = createIndicatorLegends({ getState: () => indicators,
  onSettings: id => library.openSettings(id),
  onRemove: id => changeIndicators(setIndicatorEnabled(indicators, id, false)),
});
const touchControls = createTouchNavigation({ canvas, getCore: () => core,
  getSize: () => ({ width: width - AXIS_WIDTH, height: height - TIME_HEIGHT }),
  onBegin: () => { rangeController.cancel(); cancelChartGesture(true); setSeriesSelected(false); }, requestPaint,
});
const axisControls = createPriceScaleControls({ canvas, button: element<HTMLButtonElement>('price-scale-auto'),
  getCore: () => core, getFrame: () => frame, getSize: () => ({ width, height }),
  canStart: () => !touchControls.active && !input.dragging && !editor.drawing && !editor.dragging,
  onBegin: cancelChartGesture, onChange: requestPaint,
});
const timeControls = createTimeScaleControls({ canvas,
  getCore: () => core, getFrame: () => frame, getSize: () => ({ width, height }),
  canStart: () => !touchControls.active && !input.dragging && !editor.drawing && !editor.dragging,
  onBegin: () => { rangeController.cancel(); cancelChartGesture(); }, onChange: requestPaint,
  onFollow: goLatest,
});
const layout = createWorkspaceLayout({ getCore: () => core, getFrame: () => frame,
  onStart: cancelChartGesture, requestPaint });
const paneActions = createPaneActions({ container,
  onMove: (id, direction) => { layout.movePane(id, direction); setSeriesSelected(false); },
  onMaximize: id => {
    layout.maximizePane(id); setSeriesSelected(false); editor.setTool('pointer'); drawingChanged(false);
  },
});
const fullscreen = createFullscreenControl({ button: element('chart-fullscreen'), status: element('fullscreen-status'),
  target: document.documentElement, onChange: () => { cancelChartGesture(); resize(); } });
const snapshotButton = element<HTMLButtonElement>('chart-save-image');
const snapshots = createSnapshotControls({ button: snapshotButton, capture: async () => {
  if (!core?.count || !surface || disposed || emptyState) throw new Error('Chart data is unavailable');
  cancelChartGesture(); paint('full');
  if (!frame || width <= AXIS_WIDTH || height <= TIME_HEIGHT) throw new Error('Chart has no visible area');
  const committed = drawings.items;
  const positions = core.projectDrawings(committed, width - AXIS_WIDTH, height - TIME_HEIGHT);
  return captureChartSnapshot({ frame, options: renderOptions(core.inspect(core.count - 1)), width, height,
    drawings: committed, positions, source: marketSourceLabel(), partial: partialLastBar });
} });
function cancelChartGesture(preserveTouches = false): void {
  axisControls.cancel(); timeControls.cancel();
  input.cancel(preserveTouches);
}

function clearMeasurement(): void {
  input.clearMeasurement();
}

function refreshMeasurement(): void {
  measureButton.disabled = !core?.count || core.maximizedPane > 0;
  measureButton.classList.toggle('active', measure.active);
  measureButton.setAttribute('aria-pressed', String(measure.active));
  const label = t(measure.active ? 'cancelMeasure' : 'measureTool');
  if (measureButton.title !== label) { measureButton.title = label; measureButton.setAttribute('aria-label', label); }
  const selection = document.querySelector<HTMLButtonElement>('[data-tool="pointer"]')!;
  const active = editor.tool === 'pointer' && !measure.active;
  selection.classList.toggle('active', active); selection.setAttribute('aria-pressed', String(active));
}

function startMeasurement(preserveTouches = false): void {
  replay.cancelSelection(); cancelChartGesture(preserveTouches); rangeController.cancel();
  drawings.selected = null; editor.setTool('pointer'); setSeriesSelected(false);
  measure.enable(); canvas.focus({ preventScroll: true });
}

measureButton.addEventListener('click', () => {
  if (measure.active) clearMeasurement(); else startMeasurement();
});
element('analysis-open').addEventListener('click', () => library.open());
element('drawing-settings-open').addEventListener('click', () => cancelChartGesture());
element('crosshair-settings-open').addEventListener('click', event => {
  cancelChartGesture(); crosshairPanel.open();
  const button = event.currentTarget as HTMLElement;
  button.setAttribute('aria-expanded', 'true'); button.classList.add('active');
});
element('price-scale-mode').addEventListener('click', () => { cancelChartGesture(); appearancePanel.open('scales'); });
element('series-select').addEventListener('click', () => {
  if (!core?.count) return;
  replay.cancelSelection();
  cancelChartGesture(); drawings.selected = null; editor.setTool('pointer');
  setSeriesSelected(true); canvas.focus({ preventScroll: true });
});

function setSeriesSelected(selected: boolean): void {
  seriesSelected = selected;
  element('series-select').setAttribute('aria-pressed', String(selected));
  element('series-selection-hint').hidden = !selected;
  element('series-selection-hint').textContent = t('seriesSelected');
  requestPaint();
}

function openSeriesSettings(): void {
  cancelChartGesture(); appearancePanel.open();
}

function restoreIndicators(): IndicatorState {
  try { return parseIndicatorState(JSON.parse(preference('zigchart.indicators') ?? 'null')) ?? createIndicatorState(); }
  catch { return createIndicatorState(); }
}

function changeSeriesStyle(next: SeriesStyle): void {
  cancelChartGesture();
  seriesStyle = parseSeriesStyle(next);
  instrumentWorkspace.saveBaseline(instrument, seriesStyle);
  try { localStorage.setItem('zigchart.series', JSON.stringify({ ...seriesStyle, baselineSource: 'first-visible', baselinePrice: 0 })); }
  catch { /* Optional preference storage. */ }
  seriesControls.refresh(); selects.refresh(); requestPaint();
}

async function switchInstrument(symbol: string): Promise<void> {
  if (disposed || !core || symbol === instrument.symbol) return;
  const entry = findSampleInstrument(symbol);
  if (!entry) return;
  const source = new SampleFeed(symbol);
  cancelChartGesture(); replay.cancelSelection(); appearancePanel.close();
  instrumentWorkspace.saveBaseline(instrument, seriesStyle);
  instrument = entry.instrument;
  seriesStyle = { ...seriesStyle, ...instrumentWorkspace.baseline(instrument) };
  drawingRecord = instrumentWorkspace.drawing(instrument); drawings = drawingRecord.document;
  drawingsStored = drawingRecord.saved; drawingRestoreFailed = drawingRecord.invalid;
  editor = createEditor(); drawingListSignature = '';
  snapshotCutoff = null; rangeController.resetSource();
  try { localStorage.setItem(SYMBOL_KEY, symbol); } catch { /* The selected chart remains usable without storage. */ }
  await session.replaceSource(source);
}

function changeScales(next: ScalePreferences): void {
  const valid = parseScales(next);
  if (valid.mode !== scalePreferences.mode || valid.inverted !== scalePreferences.inverted) {
    core?.configurePriceScale(valid.mode, valid.inverted);
  }
  scalePreferences = valid;
  try { localStorage.setItem('zigchart.scales', JSON.stringify(valid)); } catch { /* Optional preference storage. */ }
  requestPaint();
}

function changeCrosshair(next: CrosshairStyle): void {
  crosshairStyle = parseCrosshairStyle(next);
  try { localStorage.setItem('zigchart.crosshair', JSON.stringify(crosshairStyle)); } catch { /* Optional preference storage. */ }
  requestOverlayPaint();
}

function syncCoreIndicators(state: IndicatorState): void {
  const mask = Number(state.ma.enabled) | (Number(state.ema.enabled) << 1) | (Number(state.volume.enabled) << 2);
  core?.configureIndicators(state.ma.period, state.ema.period, mask);
  core?.configureAverages(state.averages.map(item => ({ slot: Number(item.id.slice(8)) - 1, kind: item.kind, period: item.period })));
  core?.configureBollinger(state.bb.period, state.bb.multiplier, state.bb.enabled);
  core?.configureOscillators(state.rsi.period, state.macd.fastPeriod, state.macd.slowPeriod,
    state.macd.signalPeriod, Number(state.rsi.enabled) | (Number(state.macd.enabled) << 1));
}

function changeIndicators(next: IndicatorState): void {
  const valid = parseIndicatorState(next);
  if (!valid) return;
  if (valid.volume.enabled !== indicators.volume.enabled || valid.rsi.enabled !== indicators.rsi.enabled ||
    valid.macd.enabled !== indicators.macd.enabled) layout.resetFrame();
  cancelChartGesture(); syncCoreIndicators(valid); indicators = valid;
  try { localStorage.setItem('zigchart.indicators', JSON.stringify(indicators)); } catch { /* Optional study storage. */ }
  legends.refresh(); library.refresh(); drawingChanged(false); surface?.invalidate(); requestPaint();
}

function reportError(error: unknown, key: MessageKey): void {
  errorKey = key;
  element('error-message').textContent = t(key);
  element('error-message').hidden = false;
  console.error(error);
}

function refreshPeriods(): void {
  const groups = ['minutes', 'hours', 'calendarPeriods'] as const;
  periodSelect.replaceChildren(...groups.map((key, index) => {
    const group = document.createElement('optgroup'); group.label = t(key);
    for (const period of PERIODS) {
      const position = period.unit === 'minute' ? 0 : period.unit === 'hour' ? 1 : 2;
      if (position !== index) continue;
      const option = document.createElement('option'); option.value = period.id;
      option.textContent = t(`${period.unit}Period`, { n: period.multiplier });
      group.append(option);
    }
    return group;
  }));
  periodSelect.value = session.period;
  const selectedPeriod = getPeriod(session.period);
  element('active-period').textContent = t(`${selectedPeriod.unit}Period`, { n: selectedPeriod.multiplier });
  element('active-symbol').textContent = instrument.symbol;
  element('symbol-open').setAttribute('aria-label', `${t('symbolSearch')} · ${instrument.symbol}`);
  element('symbol-open').title = t('symbolSearch');
  const name = findSampleInstrument(instrument.symbol)!.labels[getLocale()];
  element('instrument-description').textContent = name.includes(instrument.symbol) ? name : `${name} · ${instrument.symbol}`;
  element('period-description').textContent = marketSourceLabel();
}

function marketSourceLabel(): string {
  return t('sampleCalendar') + (session.replayState?.active ? ` · ${getLocale() === 'en' ? 'Historical replay' : '历史回放'}` : '');
}

function applyAppearance(save: boolean): void {
  document.documentElement.dataset.theme = appearance.theme;
  const colors = { '--chart-bg': appearance.backgroundColor, '--up': appearance.upColor, '--down': appearance.downColor };
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value);
  if (save) { try { localStorage.setItem('zigchart.appearance', JSON.stringify(appearance)); } catch { /* Optional preference storage. */ } }
  selects.refresh();
  requestPaint();
}

function drawingChanged(save: boolean): void {
  if (save) {
    instrumentWorkspace.saveDrawing(drawingRecord);
    drawingsStored = drawingRecord.saved; drawingRestoreFailed = drawingRecord.invalid;
  }
  const selected = drawings.selection;
  if (selected || editor.tool !== 'pointer') setSeriesSelected(false);
  const items = drawings.items;
  const list = element<HTMLSelectElement>('drawing-list');
  const signature = `${getLocale()}:${items.map(d => `${d.id}:${d.kind}:${d.locked}`).join(',')}`;
  if (signature !== drawingListSignature) {
    drawingListSignature = signature;
    const none = document.createElement('option'); none.value = ''; none.textContent = t('noDrawingSelected');
    list.replaceChildren(none, ...items.map((drawing, index) => {
      const option = document.createElement('option'); option.value = drawing.id;
      option.textContent = `${t(`${drawing.kind}Tool`)} ${index + 1}${drawing.locked ? ' 🔒' : ''}`;
      return option;
    }));
  }
  list.value = drawings.selected ?? '';
  const priceVisible = !core || core.maximizedPane <= 0;
  drawingTools.refresh(editor.tool, !core?.count || drawings.full || !priceVisible);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const active = button.dataset.tool === editor.tool;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    button.disabled = !core?.count || ((drawings.full || !priceVisible) && button.dataset.tool !== 'pointer');
  }
  element<HTMLButtonElement>('edit-undo').disabled = !drawings.canUndo;
  element<HTMLButtonElement>('edit-redo').disabled = !drawings.canRedo;
  element<HTMLButtonElement>('drawing-delete').disabled = !selected || selected.locked;
  element<HTMLButtonElement>('drawing-settings-delete').disabled = !selected || selected.locked;
  syncDrawingFeedback(selected);
  element<HTMLInputElement>('drawing-color').value = selected?.color ?? editor.color;
  element('drawing-color').closest('label')!.querySelector('span')!.textContent = t(selected?.kind === 'fibonacci'
    ? 'fibTrendColor' : selected?.kind === 'text' ? 'textColor' : 'drawingColor');
  element<HTMLSelectElement>('drawing-width').value = String(selected?.width ?? editor.width);
  fibonacciControls.refresh();
  textControls.refresh();
  element('drawing-status').textContent = t(drawingRestoreFailed ? 'drawingInvalid' : !drawingsStored ? 'drawingUnsaved' :
    editor.drawing ? 'drawingEnd' : editor.tool !== 'pointer' ? 'drawingStart' : drawings.full ? 'drawingLimit' : 'drawingReady', { count: drawings.items.length });
  selects.refresh();
  requestPaint();
}

function updateHostText(): void {
  sessionFeedbackKey = sessionUiKey();
  snapshots.refresh(); fullscreen.refresh();
  snapshotButton.disabled = !core?.count || emptyState !== null;
  rangeControls.refresh();
  syncSidebar();
  historyButton.textContent = t(session.loading ? 'loadingHistory' : session.hasMore ? 'olderHistory' : 'historyComplete');
  historyButton.disabled = !core || session.loading || !session.hasMore;
  latestButton.disabled = !core || session.loading || (!session.ready && !session.browsingHistory);
  latestButton.textContent = t(session.replayState?.active ? 'replayPosition' : 'latest');
  latestButton.title = t(session.replayState?.active ? 'replayPositionTitle' : 'latestTitle');
  periodSelect.disabled = !core;
  element<HTMLButtonElement>('symbol-open').disabled = !core;
  refreshPeriods();
  library.refresh(); legends.refresh(); layout.refresh(); paneActions.refresh(); seriesControls.refresh();
  appearancePanel.refresh(); crosshairPanel.refresh(); marketSidebar.refresh(); setSeriesSelected(seriesSelected);
  axisControls.refresh(); timeControls.refresh();
  syncScaleFeedback(element<HTMLButtonElement>('price-scale-mode'), frame, scalePreferences);
  drawingChanged(false);
  refreshMeasurement();
  updateReplayState();
  const empty = element('chart-empty');
  empty.hidden = emptyState === null;
  if (emptyState) {
    const messages = {
      preparing: ['preparingTitle', 'preparingDetail'], noHistory: ['noHistoryTitle', 'noHistoryDetail'],
      historyError: ['historyErrorTitle', 'historyErrorDetail'], coreError: ['coreErrorTitle', 'coreErrorDetail'],
    } as const;
    const [title, detail] = messages[emptyState];
    empty.innerHTML = `${emptyState === 'preparing' ? '<span class="loading-ring"></span>' : ''}<strong>${t(title)}</strong><span>${t(detail)}</span>`;
  }
  element('error-message').hidden = errorKey === null;
  if (errorKey) element('error-message').textContent = t(errorKey);
  if (!core?.count) {
    element('ohlc').innerHTML = (['openShort', 'highShort', 'lowShort', 'closeShort'] as const)
      .map(key => `<span>${t(key)} <b>—</b></span>`).join('');
    element('selected-time').textContent = t('allTimesUtc');
    updateSnapshot(null);
    element('chart-status').textContent = t(emptyState === 'coreError' || emptyState === 'historyError' ? 'unavailable' : emptyState === 'noHistory' ? 'noHistoryTitle' : 'initializing');
  } else {
    const latest = core.inspect(core.count - 1);
    if (latest) updateSnapshot(latest);
  }
  updateMetric();
  requestPaint();
}

function sessionUiKey(): string {
  return [session.period, session.loading, session.ready, session.hasMore, session.browsingHistory,
    session.replayState?.active, emptyState, errorKey].join(':');
}

function updateSessionFeedback(): void {
  if (sessionFeedbackKey !== sessionUiKey()) { updateHostText(); return; }
  // Playback ticks only change their controls and chart, not every settings dialog.
  updateReplayState(); requestPaint();
}

function updateMetric(): void {
  if (!samples.length) return;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  element('render-time').textContent = t('frameTime', { value: mean.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  element('render-time').title = t('frameScope', { count: samples.length });
}

languageSelect.addEventListener('change', () => {
  const value = languageSelect.value;
  if (value !== 'en' && value !== 'zh-CN') return;
  setLocale(value);
  try { window.localStorage.setItem('zigchart.locale', value); } catch { /* Keep working without persistence. */ }
  translateDocument(document);
  updateHostText();
});

function requestPaint(): void {
  scheduler.request('full');
}

function requestOverlayPaint(): void {
  scheduler.request('overlay');
}

function resize(): void {
  surface?.invalidate(); requestPaint();
}

function syncAxisTitle(): void {
  if (canvas.classList.contains('time-axis-hover')) canvas.title = canvas.dataset.timeAxisHint ?? '';
  else if (!canvas.classList.contains('price-axis-hover')) canvas.removeAttribute('title');
}

function updateSnapshot(latest: BarInfo | null): void {
  const period = getPeriod(session.period);
  marketSidebar.update({ symbol: instrument.symbol, latest, partial: partialLastBar, count: core?.count ?? 0, historical: session.browsingHistory,
    replay: session.replayState?.active ?? false,
    periodLabel: t(`${period.unit}Period`, { n: period.multiplier }) });
}

function updateSelection(selected: BarInfo | null): void {
  const pointer = input.pointer;
  readout.update(selected, indicators, selected?.index === core.count - 1 && partialLastBar,
    !measure.active && !measure.hasResult && !replay.choosing && !input.dragging && !editor.drawing && !editor.dragging ? pointer : null, width, height,
    selected ? oscillatorValuesAt(frame, selected.index) : null, selected ? averageValuesAt(frame, selected.index) : [],
    selected ? bollingerValuesAt(frame, selected.index) : null);
}

function renderOptions(latest: BarInfo | null): RenderOptions {
  return {
    indicators, latest, appearance, seriesStyle, pixelRatio, period: session.period, instrument, crosshairStyle,
    priceToY: (price: number) => core.priceToY(price, width - AXIS_WIDTH, height - TIME_HEIGHT),
    priceAtY: (y: number) => core.priceAtY(y, width - AXIS_WIDTH, height - TIME_HEIGHT),
    paneValueToY: (pane: number, value: number) => core.paneValueToY(pane, value, width - AXIS_WIDTH, height - TIME_HEIGHT),
    paneValueAtY: (pane: number, y: number) => core.paneValueAtY(pane, y, width - AXIS_WIDTH, height - TIME_HEIGHT),
  };
}

function paint(level: ChartInvalidation): void {
  if (!ctx || !surface || disposed) return;
  try {
    const start = performance.now();
    if (layout.flush()) { surface.invalidate(); level = 'full'; }
    const size = surface.commit();
    width = size.width; height = size.height; pixelRatio = size.dpr;
    if (size.resized) {
      if (measure.measuring) cancelChartGesture();
      touchControls.cancel(); core?.resizePlot(width - AXIS_WIDTH); level = 'full';
    }
    const touchChanged = touchControls.flush();
    if (touchChanged) level = 'full';
    axisControls.refresh(); timeControls.refresh(); syncAxisTitle();
    refreshMeasurement();
    if (!core?.count || width <= AXIS_WIDTH || height <= TIME_HEIGHT) {
      surface.clearOverlay(width, height);
      measureReadout.update(null, { active: false, measuring: false }, frame);
      ctx.fillStyle = appearance.backgroundColor; ctx.fillRect(0, 0, width, height); return;
    }
    const full = level === 'full' || !frame;
    if (full) {
      frame = core.frame(width - AXIS_WIDTH, height - TIME_HEIGHT);
      if (touchChanged) maybeLoadHistory();
      layout.updateFrame(frame); legends.updateFrame(frame); paneActions.updateFrame(frame, layout.maximizedPane);
      const pricePane = frame.panes?.find(pane => pane.id === 0);
      const priceVisible = !!pricePane;
      for (const control of [container.querySelector<HTMLElement>('.chart-overlay')!, element('price-scale-auto'), element('price-scale-mode')]) {
        if (control.hidden !== !priceVisible) control.hidden = !priceVisible;
      }
      const chartLabel = priceVisible ? 'chartAria' : 'auxiliaryChartAria';
      if (canvas.dataset.i18nAriaLabel !== chartLabel) canvas.dataset.i18nAriaLabel = chartLabel;
      if (canvas.getAttribute('aria-label') !== t(chartLabel)) canvas.setAttribute('aria-label', t(chartLabel));
      for (const [name, value] of [['top', pricePane?.top ?? 0], ['height', pricePane ? pricePane.bottom - pricePane.top : 0]] as const) {
        const css = `${value}px`, key = `--price-pane-${name}`;
        if (container.style.getPropertyValue(key) !== css) container.style.setProperty(key, css);
      }
    }
    if (!frame) return;
    syncScaleFeedback(element<HTMLButtonElement>('price-scale-mode'), frame, scalePreferences);
    const latest = core.inspect(core.count - 1);
    const pointer = input.pointer;
    const index = pointer ? core.hit(pointer.x, width - AXIS_WIDTH) : -1;
    const selected = pointer ? (index >= 0 ? core.inspect(index) : null) : latest;
    const options = renderOptions(latest);
    if (full) {
      drawChart(ctx, frame, width, height, options);
      const objects = editor.items;
      if (objects.length) drawAnnotations(ctx, frame, objects, core.projectDrawings(objects, width - AXIS_WIDTH, height - TIME_HEIGHT), editor.selected, appearance, instrument.priceScale);
    }
    surface.clearOverlay(width, height);
    const crosshair = resolveCrosshair(frame, replay.choosing || measure.active ? null : pointer, crosshairStyle, seriesStyle, pixelRatio);
    if (crosshair) drawCrosshair(overlay, frame, crosshair, options);
    if (replay.choosing && pointer) drawReplaySelection(overlay, frame, index);
    if (seriesSelected) drawSeriesSelection(overlay, frame, '#4f8cff', appearance.backgroundColor, seriesStyle, pixelRatio);
    const measured = measure.result();
    if (measured) drawMeasure(overlay, frame, measured);
    measureReadout.update(measured, { active: measure.active, measuring: measure.measuring }, frame);
    updateSelection(selected);
    setText(element('chart-status'), t(session.loading ? 'loadingHistory' :
      session.replayState?.active ? 'historicalReplay' :
      session.browsingHistory ? 'historicalSnapshot' :
      frame.meta[8] + frame.meta[9] >= frame.meta[10] - 0.000001 ? 'followingLatest' : 'exploringHistory'));
    if (full) {
      samples.push(performance.now() - start);
      if (samples.length > 90) samples.shift();
    }
    if (performance.now() - lastMetric > 500) {
      updateMetric();
      lastMetric = performance.now();
    }
  } catch (error) { reportError(error, 'errorRender'); }
}

async function loadHistory(): Promise<void> {
  if (core && !disposed) await session.load(core.count ? core.inspect(0)?.time : undefined);
}

function maybeLoadHistory(): void {
  requestAnimationFrame(() => {
    if (rangeController.status !== 'loading' && frame && frame.meta[8] < 25 && session.hasMore) void loadHistory();
  });
}

function updateReplayState(): void {
  replay.refresh();
}

function goLatest(): void {
  if (!core || disposed) return;
  rangeController.cancel(); cancelChartGesture();
  if (session.browsingHistory || !session.ready) { void session.open(session.period); return; }
  core.follow(); requestPaint();
}

const input = createChartInput({
  canvas, getCore: () => core, getFrame: () => frame, getEditor: () => editor,
  getSize: () => ({ width: width - AXIS_WIDTH, height: height - TIME_HEIGHT, pageHeight: height, pixelRatio }),
  getAppearance: () => appearance, getSeriesStyle: () => seriesStyle,
  isSeriesSelected: () => seriesSelected, isReplayChoosing: () => replay.choosing,
  touch: touchControls, measure, textBounds,
  selectSeries: setSeriesSelected, openSeriesSettings, openTextSettings,
  selectReplay: time => replay.select(time), startMeasurement,
  cancelRange: () => rangeController.cancel(), loadHistory: maybeLoadHistory, followLatest: goLatest,
  clearTooltip: () => { tooltip.hidden = true; }, syncAxisTitle,
  paint: level => scheduler.request(level),
});
historyButton.addEventListener('click', () => { void loadHistory(); });
latestButton.addEventListener('click', goLatest);
periodSelect.addEventListener('change', () => {
  replay.cancelSelection();
  rangeController.cancel();
  const period = getPeriod(periodSelect.value).id;
  try { localStorage.setItem('zigchart.period', period); } catch { /* Optional preference storage. */ }
  void session.open(period, session.historyBefore);
});
const sidebar = element('market-sidebar');
sidebar.hidden = matchMedia('(max-width: 760px)').matches;
function syncSidebar(): void {
  syncPanelFeedback(!sidebar.hidden);
}
element('sidebar-toggle').addEventListener('click', () => { sidebar.hidden = !sidebar.hidden; syncSidebar(); });
syncSidebar();
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.addEventListener('click', () => {
    replay.cancelSelection(); clearMeasurement(); editor.setTool(button.dataset.tool as DrawingTool); canvas.focus({ preventScroll: true });
  });
}
for (const [id, action] of [['edit-undo', 'undo'], ['edit-redo', 'redo'], ['drawing-delete', 'delete'], ['drawing-settings-delete', 'delete'], ['drawing-lock', 'lock']] as const) {
  element(id).addEventListener('click', () => editor.edit(action));
}
for (const id of ['drawing-color', 'drawing-width']) element(id).addEventListener('change', () => {
  editor.style(element<HTMLInputElement>('drawing-color').value, Number(element<HTMLSelectElement>('drawing-width').value));
});
element<HTMLSelectElement>('drawing-list').addEventListener('change', event => {
  const value = (event.target as HTMLSelectElement).value;
  clearMeasurement();
  editor.setTool('pointer');
  drawings.selected = drawings.items.some(d => d.id === value) ? value : null;
  drawingChanged(false);
});
document.addEventListener('keydown', event => {
  const target = event.target;
  if (document.querySelector('dialog[open]') || (target instanceof HTMLElement && target.closest('[role="listbox"],[role="combobox"]'))) return;
  if (target instanceof HTMLElement && (target.matches('input,select,textarea') || target.isContentEditable)) return;
  if (event.altKey && event.key.toLowerCase() === 'g') { event.preventDefault(); rangeControls.openDates(); return; }
  if (event.key === 'Escape') {
    replay.cancelSelection(); cancelChartGesture(); setSeriesSelected(false); drawings.selected = null; editor.setTool('pointer'); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); editor.edit(event.shiftKey ? 'redo' : 'undo');
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault(); editor.edit('redo');
  } else if (event.key === 'Delete' && drawings.selected) {
    event.preventDefault(); editor.edit('delete');
  }
});
const observer = new ResizeObserver(entries => {
  const entry = entries.find(item => item.target === container);
  if (entry && surface?.observeSize(entry.contentRect.width, entry.contentRect.height)) requestPaint();
});
if (surface) {
  observer.observe(container);
  window.addEventListener('resize', resize);
}
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  disposed = true;
  input.dispose();
  rangeController.cancel();
  rangeControls.dispose();
  replay.dispose();
  measure.cancel(); measureReadout.dispose();
  session.dispose();
  touchControls.cancel();
  layout.dispose(); paneActions.dispose(); selects.dispose(); library.dispose(); legends.dispose();
  appearancePanel.dispose(); drawingPanel.dispose(); fibonacciControls.dispose(); textControls.dispose(); marketSidebar.dispose();
  drawingTools.dispose();
  snapshots.dispose(); fullscreen.dispose();
  axisControls.dispose(); timeControls.dispose(); seriesControls.dispose(); crosshairPanel.dispose();
  observer.disconnect();
  window.removeEventListener('resize', resize);
  scheduler.dispose();
});

historyButton.disabled = true;
latestButton.disabled = true;
applyAppearance(false);
updateHostText();
if (!surface) {
  emptyState = 'coreError';
  reportError(new Error('Canvas 2D is unavailable in this browser.'), 'errorCanvas');
  updateHostText();
} else {
  resize();
  void ChartCore.create().then(async (ready) => {
    if (disposed) return;
    core = ready;
    core.configurePriceScale(scalePreferences.mode, scalePreferences.inverted);
    core.resizePlot(width - AXIS_WIDTH);
    core.setPaneWeights(layout.paneWeights);
    core.setPaneOrder(layout.paneOrder);
    syncCoreIndicators(indicators);
    const savedPeriod = preference('zigchart.period');
    await session.open(PERIODS.find(period => period.id === savedPeriod)?.id ?? '1m');
  }).catch((error: unknown) => {
    if (disposed) return;
    emptyState = 'coreError';
    reportError(error, 'errorCore');
    updateHostText();
  });
}
