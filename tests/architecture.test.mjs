import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkArchitecture } from '../scripts/check-architecture.mjs';

const command = fileURLToPath(new URL('../scripts/check-architecture.mjs', import.meta.url));
function fixture(files, run) {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, 'zigchart-architecture-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(root, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    return run(root);
  } finally {
    assert.equal(dirname(resolve(root)), parent);
    assert.ok(basename(root).startsWith('zigchart-architecture-'));
    rmSync(root, { recursive: true, force: true });
  }
}

test('data contracts and type-only cycles preserve dependency direction', () => fixture({
  'data/contracts.ts': "import type { Period } from './periods'; export interface Bar { period: Period }",
  'data/periods.ts': "export type { Bar } from './contracts'; export type Period = '1m'; export const minute = 60000;",
  'data/session.ts': "import type { Bar } from './contracts'; import { minute } from './periods';",
  'features/series.ts': 'export const style = {};',
  'chart/render.ts': "import { style } from '../features/series';",
  'app/workspace.ts': "import '../data/session'; import '../chart/render';",
  'main.ts': "import './app/workspace';",
}, root => {
  assert.deepEqual(checkArchitecture(root), { fileCount: 7, problems: [] });
  const result = spawnSync(process.execPath, [command, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed for 7 TypeScript modules/);
}));

test('ownership checks include type-only imports, reexports and import types', () => fixture({
  'data/feed.ts': "import type { Bar } from '../chart/types'; export type { View } from '../app/workspace';",
  'data/session.ts': "type Mode = import('../features/mode').Mode;",
  'chart/types.ts': 'export interface Bar {}',
  'features/mode.ts': "export type Mode = 'normal'; import type { View } from '../app/workspace';",
  'app/workspace.ts': 'export interface View {}',
}, root => {
  const { problems } = checkArchitecture(root);
  assert.equal(problems.filter(value => value.startsWith('Data boundary:')).length, 3);
  assert.equal(problems.filter(value => value.startsWith('App boundary:')).length, 2);
  const result = spawnSync(process.execPath, [command, root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Data boundary: data\/feed.ts/);
  assert.match(result.stderr, /App boundary: features\/mode.ts/);
}));

test('runtime graph detects a reexport and dynamic-import cycle through index modules', () => fixture({
  'features/a.ts': "export { value } from '../chart';",
  'chart/index.ts': "export { value } from './value.js';",
  'chart/value.ts': "export const value = 1; export const load = () => import('../features/a.ts');",
}, root => {
  const { problems } = checkArchitecture(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Runtime cycle: .*chart\/index.ts.*chart\/value.ts.*features\/a.ts/);
}));

test('inline type imports retain runtime edges under verbatimModuleSyntax', () => fixture({
  'a.ts': "import { type Value } from './b'; export interface Other {}",
  'b.ts': "import './a'; export interface Value {}",
}, root => {
  assert.match(checkArchitecture(root).problems[0], /^Runtime cycle:/);
}));
