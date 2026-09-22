import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../web/src/chart/scheduler.ts';

function fixture() {
  const callbacks = new Map(), calls = [];
  let sequence = 0;
  const scheduler = createFrameScheduler(level => calls.push(level),
    callback => { const id = ++sequence; callbacks.set(id, callback); return id; },
    handle => callbacks.delete(handle));
  return { scheduler, calls, callbacks,
    flush() { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)); } };
}

test('hover bursts use one overlay frame without requesting a full redraw', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.scheduler.request('overlay');
  assert.equal(f.callbacks.size, 1);
  f.flush();
  assert.deepEqual(f.calls, ['overlay']);
});

test('resize or data invalidation wins over pending and later cursor work', () => {
  const f = fixture();
  f.scheduler.request('overlay'); f.scheduler.request('full'); f.scheduler.request('overlay');
  f.flush();
  assert.deepEqual(f.calls, ['full']);
  f.scheduler.request('overlay'); f.flush();
  assert.deepEqual(f.calls, ['full', 'overlay']);
});

test('disposal cancels pending work and prevents scheduling new frames', () => {
  const f = fixture();
  f.scheduler.request('full'); f.scheduler.dispose(); f.scheduler.request('overlay'); f.flush();
  assert.equal(f.callbacks.size, 0);
  assert.deepEqual(f.calls, []);
});
