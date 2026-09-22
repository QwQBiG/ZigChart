import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = readFileSync(new URL('../.zig-version', import.meta.url), 'utf8').trim();
const local = resolve('.tools', `zig-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'zig.exe' : 'zig');
const binary = process.env.ZIG_BIN || (existsSync(local) ? local : 'zig');
try {
  const actual = execFileSync(binary, ['version'], { encoding: 'utf8' }).trim();
  if (actual !== version) throw new Error(`Expected Zig ${version}; found ${actual}`);
  const common = ['--cache-dir', '.zig-cache', '--global-cache-dir', '.zig-cache/global'];
  const command = process.argv[2];
  let args;
  if (command === 'build') {
    mkdirSync('web/public', { recursive: true });
    args = ['build-exe', 'core/wasm.zig', '-target', 'wasm32-freestanding', '-fno-entry', '-rdynamic', '-fstrip', '-O', 'ReleaseFast', '-femit-bin=web/public/core.wasm', ...common];
  } else if (command === 'test') {
    args = ['test', 'core/engine.zig', ...common];
  } else {
    throw new Error('Usage: node scripts/zig.mjs build|test');
  }
  execFileSync(binary, args, { stdio: 'inherit' });
} catch (error) {
  console.error(error.message);
  console.error('Install the pinned compiler with npm run setup:zig, or set ZIG_BIN to its executable.');
  process.exitCode = 1;
}
