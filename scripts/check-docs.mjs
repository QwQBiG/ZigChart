import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDocs = [...new Set([
  'README.md', 'CONTRIBUTING.md', 'THIRD_PARTY.md',
  ...readdirSync(resolve(root, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name.replace(/\.zh-CN\.md$/, '.md')}`),
])];
const pairs = sourceDocs.map(english => [english, english.replace(/\.md$/, '.zh-CN.md')]);
const problems = [];

for (const pair of pairs) {
  for (const [index, file] of pair.entries()) {
    const path = resolve(root, file);
    if (!existsSync(path)) { problems.push(`Missing translation: ${file}`); continue; }
    const text = readFileSync(path, 'utf8');
    const counterpart = basename(pair[1 - index]);
    if (!text.includes(`](${counterpart})`)) problems.push(`Missing language link from ${file} to ${counterpart}`);
    if (text.includes('\r')) problems.push(`Use LF line endings: ${file}`);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(path), target))) problems.push(`Broken local link in ${file}: ${target}`);
    }
  }
}

// CI compares the complete change with its base, rather than individual commits.
// This verifies paired edits, not translation accuracy; reviewers check meaning.
const base = process.env.DOCS_BASE_REF;
let checkedChanges = false;
if (base && !/^0+$/.test(base)) {
  try {
    if (!/^[0-9a-f]{40}$/i.test(base)) throw new Error('DOCS_BASE_REF must be a commit SHA');
    const changed = new Set(execFileSync('git', ['diff', '--no-renames', '--name-only', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
    const changedDocs = [...changed].filter(file => /^docs\/[^/]+\.md$/.test(file)).map(file => file.replace(/\.zh-CN\.md$/, '.md'));
    for (const english of new Set(changedDocs)) {
      if (!sourceDocs.includes(english)) pairs.push([english, english.replace(/\.md$/, '.zh-CN.md')]);
    }
    for (const [english, chinese] of pairs) {
      if (changed.has(english) !== changed.has(chinese)) problems.push(`Update both language versions in the same change: ${english}, ${chinese}`);
    }
    checkedChanges = true;
  } catch (error) { problems.push(`Cannot compare documentation changes: ${error.message}`); }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Documentation checks passed for ${pairs.length} English/Chinese pairs${checkedChanges ? ' and paired changes' : ''}.`);
}
