import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseLocale, getLocale, messages, setLocale, t, translateDocument } from '../web/src/ui/i18n.ts';

afterEach(() => setLocale('en'));
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('explicit supported preference overrides browser language order', () => {
  assert.equal(chooseLocale('en', ['zh-CN', 'en-US']), 'en');
  assert.equal(chooseLocale('zh-CN', ['en-US', 'zh-CN']), 'zh-CN');
  assert.equal(chooseLocale('zh-CN', []), 'zh-CN');
});

test('locale detection uses the first supported language and safely falls back', () => {
  const cases = [
    [null, ['fr-FR', 'zh-TW', 'en-US'], 'zh-CN'],
    [null, ['en-GB', 'zh-CN'], 'en'],
    [null, ['ZH-hans-cn', 'en'], 'zh-CN'],
    [null, ['zh'], 'zh-CN'],
    ['obsolete', ['EN-au'], 'en'],
    ['en-GB', ['zh-CN'], 'zh-CN'],
    ['', ['fr-FR', 'de-DE'], 'en'],
    [null, [], 'en'],
    [null, ['english', 'zhongwen'], 'en'],
  ];
  for (const [saved, languages, expected] of cases) {
    assert.equal(chooseLocale(saved, languages), expected, JSON.stringify({ saved, languages }));
  }
});

test('language selection is explicit and preference detection does not change active text', () => {
  setLocale('zh-CN');
  assert.equal(t('volume'), '成交量');
  assert.equal(chooseLocale('en', ['zh-CN']), 'en');
  assert.equal(getLocale(), 'zh-CN');
  assert.equal(t('volume'), '成交量');
  setLocale('en');
  assert.equal(t('volume'), 'Volume');
});

test('every translation is nonempty and both languages preserve interpolation fields', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages['zh-CN']).sort());
  assert.ok(Object.keys(messages.en).length > 0);
  for (const key of Object.keys(messages.en)) {
    for (const locale of ['en', 'zh-CN']) {
      assert.equal(typeof messages[locale][key], 'string', `${locale}: ${key}`);
      assert.ok(messages[locale][key].trim(), `${locale}: ${key}`);
    }
    assert.deepEqual(placeholders(messages.en[key]), placeholders(messages['zh-CN'][key]), key);
  }
});

test('static HTML and literal runtime translation keys all exist in both languages', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const staticKeys = [...html.matchAll(/\bdata-i18n(?:-title|-aria-label)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(staticKeys.length > 0, 'HTML must declare translatable content');
  const sources = await Promise.all(['app/workspace.ts', 'chart/render.ts', 'ui/workspace-layout.ts'].map(name =>
    readFile(new URL(`../web/src/${name}`, import.meta.url), 'utf8')));
  const runtimeKeys = sources.flatMap(source => [...source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]));
  for (const key of new Set([...staticKeys, ...runtimeKeys])) {
    for (const locale of ['en', 'zh-CN']) assert.ok(Object.hasOwn(messages[locale], key), `${locale}: ${key}`);
  }
});

test('repeated locale switches replace all interpolation fields without retaining previous values', () => {
  const parameterized = Object.keys(messages.en).filter(key => placeholders(messages.en[key]).length);
  assert.ok(parameterized.length > 0, 'Dynamic status text must use translation parameters');
  for (const locale of ['en', 'zh-CN', 'en', 'zh-CN']) {
    setLocale(locale);
    assert.equal(getLocale(), locale);
    for (const key of parameterized) {
      const names = [...new Set(placeholders(messages[locale][key]))];
      const parameters = Object.fromEntries(names.map((name, index) => [name, index ? `${locale}-${name}` : 0]));
      const rendered = t(key, parameters);
      assert.deepEqual(placeholders(rendered), [], `${locale}: ${key}`);
      for (const value of Object.values(parameters)) assert.ok(rendered.includes(String(value)), `${locale}: ${key}`);
      assert.equal(t(key), messages[locale][key], 'Omitted parameters must not reuse an earlier substitution');
    }
  }
});

test('document translation updates accessible labels and metadata while preserving runtime state', () => {
  const makeNode = (attributes = {}) => ({
    attributes: new Map(Object.entries(attributes)),
    textContent: 'initial',
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    setAttribute(name, value) { this.attributes.set(name, value); },
  });
  const heading = makeNode({ 'data-i18n': 'headline' });
  const button = makeNode({ 'data-i18n-title': 'historyTitle', 'data-i18n-aria-label': 'selectedCandle' });
  button.disabled = true;
  const runtime = makeNode();
  runtime.textContent = '42,000.00';
  const unknown = makeNode({ 'data-i18n': 'unregistered-key' });
  const nodes = [heading, button, runtime, unknown];
  const meta = makeNode();
  const select = { value: 'en' };
  const doc = {
    documentElement: { lang: 'en' },
    title: 'initial',
    querySelectorAll(selector) {
      return nodes.filter(node => node.attributes.has(selector.slice(1, -1)));
    },
    querySelector(selector) {
      if (selector === 'meta[name="description"]') return meta;
      if (selector === '#language-select') return select;
      return null;
    },
  };
  for (const locale of ['zh-CN', 'en', 'zh-CN']) {
    setLocale(locale);
    translateDocument(doc);
    assert.equal(heading.textContent, t('headline'));
    assert.equal(button.getAttribute('title'), t('historyTitle'));
    assert.equal(button.getAttribute('aria-label'), t('selectedCandle'));
    assert.equal(doc.documentElement.lang, locale);
    assert.equal(doc.title, t('title'));
    assert.equal(meta.getAttribute('content'), t('description'));
    assert.equal(select.value, locale);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'initial');
    assert.equal(runtime.textContent, '42,000.00');
    assert.equal(unknown.textContent, 'initial');
  }
  doc.querySelector = () => null;
  assert.doesNotThrow(() => translateDocument(doc), 'Optional metadata and language control may be absent');
});
