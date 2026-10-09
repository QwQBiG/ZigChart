import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInspectionSummary } from '../web/src/features/inspection/presentation.ts';
import { createIndicatorState } from '../web/src/features/analysis/model.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

function fixture(paneId = 0) {
  const instrument = { symbol: 'DEMO/USD', name: 'Synthetic', priceScale: 100, volumeScale: 1000, intervalMs: 60_000 };
  const bar = { index: 42, time: Date.UTC(2026, 0, 2, 3, 4), open: 100, high: 150, low: 50, close: 125,
    volume: 12345, ma: 99999, ema: 99999 };
  const rows = new Float64Array(17).fill(NaN); rows.set([42, bar.time, 100, 150, 50, 125, 12345, 112, 130]);
  const frame = { rows, meta: new Float64Array(13), averages: new Float64Array(12).fill(NaN),
    oscillators: new Float64Array([NaN, -120, 50, -170, NaN, 10, 20, 30]),
    bollinger: new Float64Array([NaN, 180, 40, NaN, 10, 20]),
    donchian: new Float64Array([100, 150, 50, 10, 20, 30]) };
  return { instrument, selection: { bar, frame, paneId, x: 10, y: 20, value: null }, indicators: createIndicatorState() };
}

test('price inspection describes scaled OHLCV, UTC and only enabled copied study values', () => {
  setLocale('en');
  const { instrument, selection, indicators } = fixture();
  indicators.ma = { ...indicators.ma, enabled: true, source: 'open', period: 3 };
  indicators.bb.enabled = indicators.dc.enabled = indicators.rsi.enabled = true;
  indicators.averages = [{ ...indicators.ema, enabled: true, id: 'average-4', kind: 'ema', source: 'hl2' }];
  selection.frame.averages[6] = 127;
  const summary = formatInspectionSummary(selection, instrument, '1 minute', indicators, true);
  assert.match(summary, /^DEMO\/USD; 1 minute; Price pane;/);
  assert.match(summary, /03:04:00 UTC; Open 1\.00; High 1\.50; Low 0\.50; Close 1\.25; Volume 12\.345; Partial candle/);
  assert.match(summary, /MA 3 · Open 1\.12/);
  assert.match(summary, /EMA 20 · HL2 · #4 1\.27/);
  assert.match(summary, /BB Basis Warming up; BB Upper 1\.80; BB Lower 0\.40/);
  assert.match(summary, /DC Middle 1\.00; DC Upper 1\.50; DC Lower 0\.50/);
  assert.doesNotMatch(summary, /999|RSI 14|EMA 20 · Close/);
});

test('oscillator panes use copied values with their own units and preserve warm-up versus zero', () => {
  setLocale('en');
  const { instrument, selection, indicators } = fixture(2);
  indicators.ma.enabled = indicators.rsi.enabled = indicators.macd.enabled = true;
  let summary = formatInspectionSummary(selection, instrument, '1 hour', indicators, false);
  assert.match(summary, /RSI pane;.*Complete candle; RSI 14 Warming up$/);
  assert.doesNotMatch(summary, /MACD |MA 20/);
  selection.frame.oscillators[0] = 0;
  summary = formatInspectionSummary(selection, instrument, '1 hour', indicators, false);
  assert.match(summary, /RSI 14 0\.00$/);
  selection.paneId = 3;
  summary = formatInspectionSummary(selection, instrument, '1 hour', indicators, false);
  assert.match(summary, /MACD pane;/);
  assert.match(summary, /MACD -1\.20; Signal 0\.50; Histogram -1\.70$/);
  assert.doesNotMatch(summary, /RSI 14/);
});

test('Chinese labels retain source identity and exact volume while missing frame values stay unavailable', () => {
  setLocale('zh-CN');
  const { instrument, selection, indicators } = fixture();
  indicators.ma = { ...indicators.ma, enabled: true, source: 'low' };
  selection.frame.rows = new Float64Array();
  const summary = formatInspectionSummary(selection, instrument, '1 分钟', indicators, false);
  assert.match(summary, /^DEMO\/USD; 1 分钟; 价格主图;/);
  assert.match(summary, /UTC; 开盘 1\.00/);
  assert.match(summary, /成交量 12\.345; 已完成 K 线; MA 20 · 最低 预热中$/);
  selection.paneId = 1;
  const volume = formatInspectionSummary(selection, instrument, '1 分钟', indicators, false);
  assert.match(volume, /成交量副图;/);
  assert.doesNotMatch(volume, /MA 20/);
  setLocale('en');
});
