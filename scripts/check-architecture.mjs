import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRoot = fileURLToPath(new URL('../web/src/', import.meta.url));
const sourceExtension = /\.(?:ts|tsx|mts|cts)$/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : sourceExtension.test(path) ? [path] : [];
  }).sort();
}

function references(source) {
  const result = [];
  const add = (specifier, runtime) => {
    if (specifier && ts.isStringLiteralLike(specifier)) result.push({ specifier: specifier.text, runtime });
  };
  function visit(node) {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier, !node.importClause?.isTypeOnly);
    else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, !node.isTypeOnly);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, !node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, false);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0], true);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function resolveSource(path, files) {
  const candidates = [path];
  if (!extname(path)) candidates.push(`${path}.ts`, `${path}.tsx`, resolve(path, 'index.ts'));
  const replacements = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
  for (const extension of replacements[extname(path)] ?? []) {
    candidates.push(path.slice(0, -extname(path).length) + extension);
  }
  return candidates.find(candidate => files.has(candidate));
}

/** Check explicit module edges. Type-only edges obey ownership but cannot form runtime cycles. */
export function checkArchitecture(sourceRoot = defaultRoot) {
  const root = resolve(sourceRoot), files = new Set(sourceFiles(root));
  if (!files.size) throw new Error('No TypeScript source modules found');
  const label = path => relative(root, path).replaceAll('\\', '/');
  const problems = [], graph = new Map([...files].map(path => [path, new Set()]));
  for (const file of files) {
    const name = label(file), dataModule = name.startsWith('data/');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const { specifier, runtime } of references(source)) {
      if (!specifier.startsWith('.')) {
        if (dataModule) problems.push(`Data boundary: ${name} imports outside data/: ${specifier}`);
        continue;
      }
      const path = resolve(dirname(file), specifier), target = resolveSource(path, files);
      const targetName = label(target ?? path);
      if (dataModule && !targetName.startsWith('data/')) {
        problems.push(`Data boundary: ${name} imports outside data/: ${specifier}`);
      }
      // main.ts is the browser entrypoint; reusable modules cannot depend on application assembly.
      if (name !== 'main.ts' && !name.startsWith('app/') && targetName.startsWith('app/')) {
        problems.push(`App boundary: ${name} imports app/: ${specifier}`);
      }
      if (runtime && !source.isDeclarationFile && target) graph.get(file).add(target);
    }
  }
  const visited = new Set(), active = new Set(), stack = [];
  function visit(file) {
    if (active.has(file)) {
      problems.push(`Runtime cycle: ${[...stack.slice(stack.indexOf(file)), file].map(label).join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file); active.add(file); stack.push(file);
    for (const dependency of graph.get(file)) visit(dependency);
    stack.pop(); active.delete(file);
  }
  for (const file of files) visit(file);
  return { fileCount: files.size, problems: [...new Set(problems)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/check-architecture.mjs [source-directory]');
    const { fileCount, problems } = checkArchitecture(process.argv[2]);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exitCode = 1;
    } else console.log(`Architecture checks passed for ${fileCount} TypeScript modules.`);
  } catch (error) {
    console.error(`Architecture check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
