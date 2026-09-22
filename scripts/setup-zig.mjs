import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = '0.15.2';
// SHA-256 values from https://ziglang.org/download/index.json for this release.
const releases = {
  'win32-x64': ['x86_64-windows', 'zip', '3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c'],
  'win32-arm64': ['aarch64-windows', 'zip', 'b926465f8872bf983422257cd9ec248bb2b270996fbe8d57872cca13b56fc370'],
  'linux-x64': ['x86_64-linux', 'tar.xz', '02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239'],
  'linux-arm64': ['aarch64-linux', 'tar.xz', '958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f'],
  'darwin-x64': ['x86_64-macos', 'tar.xz', '375b6909fc1495d16fc2c7db9538f707456bfc3373b14ee83fdd3e22b3d43f7f'],
  'darwin-arm64': ['aarch64-macos', 'tar.xz', '3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b'],
};

try {
  const key = `${process.platform}-${process.arch}`;
  if (!releases[key]) throw new Error(`Unsupported platform ${key}; install Zig ${version} and set ZIG_BIN.`);
  const target = resolve('.tools', `zig-${key}`);
  const binary = resolve(target, process.platform === 'win32' ? 'zig.exe' : 'zig');
  if (existsSync(binary)) {
    if (execFileSync(binary, ['version'], { encoding: 'utf8' }).trim() !== version) throw new Error('Local compiler version mismatch');
    console.log(`Zig ${version} is ready at ${binary}`);
  } else {
    const [platform, extension, checksum] = releases[key];
    const folder = `zig-${platform}-${version}`;
    const archive = `${folder}.${extension}`;
    mkdirSync('.tools', { recursive: true });
    const response = await fetch(`https://ziglang.org/download/${version}/${archive}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Compiler download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Compiler checksum mismatch');
    writeFileSync(resolve('.tools', archive), bytes);
    // tar is included in supported Windows, Linux and macOS development systems.
    execFileSync('tar', ['-xf', resolve('.tools', archive), '-C', resolve('.tools')], { stdio: 'inherit' });
    if (existsSync(target)) throw new Error(`Incomplete installation at ${target}; inspect it before retrying.`);
    renameSync(resolve('.tools', folder), target);
    if (execFileSync(binary, ['version'], { encoding: 'utf8' }).trim() !== version) throw new Error('Extracted compiler version mismatch');
    console.log(`Verified Zig ${version} installed at ${binary}`);
  }
} catch (error) {
  console.error(`Zig setup failed: ${error.message}`);
  process.exitCode = 1;
}
