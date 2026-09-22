import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCALES, readScales, parseScales } from '../web/src/features/scales/model.ts';
import { formatAxisPrice } from '../web/src/chart/price-axis.ts';
import { setLocale } from '../web/src/ui/i18n.ts';
import { hitMainSeries } from '../web/src/features/series/selection.ts';
import { DEFAULT_APPEARANCE } from '../web/src/features/appearance/model.ts';
import { DEFAULT_SERIES_STYLE } from '../web/src/features/series/model.ts';

test('scale preferences validate independent fields and reject unknown versions', () => {
  for (const value of [null, '{', '[]', '{"version":2}']) assert.deepEqual(readScales(value), DEFAULT_SCALES);
  assert.deepEqual(parseScales({version:1,mode:'logarithmic',inverted:true}), {version:1,mode:'logarithmic',inverted:true});
  assert.deepEqual(parseScales({version:1,mode:'unsupported',inverted:true}), {...DEFAULT_SCALES,inverted:true});
  assert.deepEqual(parseScales({version:1,mode:'indexed',inverted:'false'}), {...DEFAULT_SCALES,mode:'indexed'});
});

test('relative labels respect the reference, tick precision, and zero-reference fallback', () => {
  setLocale('en');
  const frame = {rows:new Float64Array(),meta:new Float64Array(13),
    priceAxis:{requestedMode:2,effectiveMode:2,inverted:false,base:10000},
    priceTicks:new Float64Array([10000,50,0,10001,40,.01])};
  assert.equal(formatAxisPrice(10500,frame,100),'5.00%');
  frame.priceAxis.base = -10000;
  assert.equal(formatAxisPrice(-9500,frame,100),'5.00%');
  frame.priceAxis.effectiveMode = 3;
  assert.equal(formatAxisPrice(-9500,frame,100),'105.00');
  frame.priceAxis = {...frame.priceAxis,effectiveMode:0,base:0};
  assert.equal(formatAxisPrice(12345,frame,100),'123.45');
  frame.priceAxis = {...frame.priceAxis,effectiveMode:2,base:1e12};
  frame.priceTicks = new Float64Array([1e12,50,0,1e12+1,40,1e-10]);
  assert.notEqual(formatAxisPrice(1e12,frame,100),formatAxisPrice(1e12+1,frame,100));
});

test('inverted candle wicks remain selectable when price extrema swap screen order', () => {
  const meta = new Float64Array(13); meta[3]=10;meta[4]=150;meta[7]=8;meta[11]=200;
  const rows = new Float64Array([0,0,100,140,80,120,0,0,0,20,60,120,20,90,0,0,0]);
  const appearance = {...DEFAULT_APPEARANCE,showBody:false,showBorder:false};
  assert.equal(hitMainSeries({rows,meta},{x:20.5,y:110},appearance,DEFAULT_SERIES_STYLE),0);
  assert.equal(hitMainSeries({rows,meta},{x:20.5,y:130},appearance,DEFAULT_SERIES_STYLE),null);
});
