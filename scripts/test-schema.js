// Tests for the JSON Schemas (scripts/build-schema.js): that they hold every block of the manifest, take every recipe, and
// refuse what the core and the composer refuse, so an editor and the library never disagree on the shape of a spec.
// Run: npm test
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const Ajv = require('ajv');
const { chartSchema, pageSchema, schemaFiles, baseUrl, FORMAT_PRESETS, SchemaError } = require('./build-schema.js');
const { compose, readPage, ComposeError, PAGE_KEYS, ENTRY_KEYS, ENTRY_API_KEYS } = require('./compose.js');

let passed = 0;
let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

const repo = path.join(__dirname, '..');
const distDir = path.join(repo, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
const recipesDir = path.join(repo, 'skills', 'blockcharts', 'recipes');
const recipes = fs
  .readdirSync(recipesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

// strict, as a program that checks specs with Ajv's defaults would compile them, and warnings are failures too
const warnings = [];
const ajv = new Ajv({
  strict: true,
  strictTypes: true,
  strictTuples: true,
  allErrors: true,
  logger: { log() {}, warn: (...a) => warnings.push(a.join(' ')), error: (...a) => warnings.push(a.join(' ')) },
});
const chart = chartSchema(manifest);
const page = pageSchema(manifest);
const checkChart = ajv.compile(chart);
const checkPage = ajv.compile(page);
const errorsOf = (check, value) => (check(value) ? [] : check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`));

/** The core and every block, unminified, in a sandbox: BC.validate and BC.formatter as a page with checks has them. */
function runtime() {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(distDir, manifest.core.file), 'utf8'), sandbox);
  for (const b of Object.values(manifest.blocks)) vm.runInContext(fs.readFileSync(path.join(distDir, b.file), 'utf8'), sandbox);
  return sandbox.BC;
}
const BC = runtime();
const SALES = [
  { region: 'North', month: '2024-01-01', total: 42 },
  { region: 'South', month: '2024-02-01', total: 58 },
];
BC.data('sales', SALES);
const bar = () => ({
  data: 'sales',
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  guides: [
    { type: 'axis', scale: 'x' },
    { type: 'axis', scale: 'y' },
  ],
  marks: [{ type: 'rect', x: 'region', y: 'total' }],
  interaction: [{ type: 'tooltip' }],
});

/** Every chart spec of a page: bare ones, those of entries and of facets. */
const specsOf = (p) => p.charts.filter((c) => c && c.section === undefined).map((c) => (c.spec ? c.spec : c));

test('schema: both compile in strict Ajv without a warning, and say which version and draft they are', () => {
  assert.deepStrictEqual(warnings, []);
  for (const s of [chart, page]) {
    assert.strictEqual(s.$schema, 'http://json-schema.org/draft-07/schema#');
    assert(s.$id.startsWith(baseUrl(manifest.core.version)), s.$id);
    assert(s.title.includes(manifest.core.version));
  }
  assert(chart.$id.endsWith('/chart.schema.json') && page.$id.endsWith('/page.schema.json'));
});

test('schema: every recipe is a valid page, and every chart in it a valid spec', () => {
  for (const f of recipes) {
    const p = JSON.parse(fs.readFileSync(path.join(recipesDir, f), 'utf8'));
    assert.deepStrictEqual(errorsOf(checkPage, p), [], f);
    specsOf(p).forEach((s, i) => assert.deepStrictEqual(errorsOf(checkChart, s), [], `${f} chart ${i}`));
  }
  assert.deepStrictEqual(errorsOf(checkChart, bar()), []);
});

test('schema: every block has a definition with its type, params and channels, and its role offers it', () => {
  for (const [name, b] of Object.entries(manifest.blocks)) {
    const role = name.slice(0, name.indexOf('.'));
    const type = name.slice(role.length + 1);
    if (role === 'lib') {
      assert(!chart.definitions[name], `${name}: a spec never names a lib block`);
      continue;
    }
    if (role === 'renderer') {
      assert(chart.properties.renderer.enum.includes(type), name);
      continue;
    }
    const def = chart.definitions[name];
    assert(def, `${name} has a definition`);
    assert.strictEqual(def.properties.type.const, type);
    assert.strictEqual(def.description, b.doc, `${name}: its doc is the editor's hover text`);
    assert(chart.definitions[role].properties.type.enum.includes(type), `${role} offers ${type}`);
    for (const p of Object.keys(b.params || {})) assert(def.properties[p], `${name}.${p}`);
    for (const c of Object.keys(b.channels || {})) assert(def.properties[c], `${name}.${c}`);
    for (const [p, d] of Object.entries(b.params || {}))
      if (d.doc && !(b.channels && b.channels[p])) assert(def.properties[p].description.includes(d.doc), `${name}.${p} has its doc`);
  }
  assert(!chart.definitions['lib.pointer'] && !chart.properties.renderer.enum.includes('pointer'));
});

test('schema: the keys of a spec, a page and a chart entry are the ones the core and the composer read', () => {
  // SPEC_KEYS lives inside the core's closure: read it from the source
  const src = fs.readFileSync(path.join(repo, 'src', 'core.ts'), 'utf8');
  const block = src.match(/const SPEC_KEYS = CHECKS\s*\?\s*\[([\s\S]*?)\]/);
  assert(block, 'SPEC_KEYS found in src/core.ts');
  const specKeys = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(Object.keys(chart.properties).sort(), specKeys.slice().sort());
  assert.deepStrictEqual(Object.keys(page.properties).sort(), ['$schema'].concat(PAGE_KEYS).sort());
  assert.deepStrictEqual(
    Object.keys(page.definitions.entry.properties).sort(),
    ENTRY_KEYS.filter((k) => !ENTRY_API_KEYS.includes(k)).sort(),
  );
  // the spec in a page is the spec of chart.schema.json
  assert.deepStrictEqual(page.definitions.spec, (({ $schema, $id, title, description, definitions, ...spec }) => spec)(chart));
});

test('schema: the format presets are the ones BC.formatter knows', () => {
  for (const p of FORMAT_PRESETS) assert.strictEqual(typeof BC.formatter(p), 'function', p);
  let message = '';
  try {
    BC.formatter('no-such-preset');
  } catch (e) {
    message = e.message;
  }
  const listed = message.match(/presets: ([^;)]+)/);
  assert(listed, message);
  assert.deepStrictEqual(listed[1].split(', ').sort(), FORMAT_PRESETS.slice().sort());
});

test('schema: "$schema" is read past by the core, the composer and both schemas', () => {
  const url = baseUrl(manifest.core.version) + 'chart.schema.json';
  const spec = { $schema: url, ...bar() };
  assert.deepStrictEqual(errorsOf(checkChart, spec), []);
  assert.deepStrictEqual(Array.from(BC.validate(spec)), []);
  const p = {
    $schema: baseUrl(manifest.core.version) + 'page.schema.json',
    data: { sales: SALES },
    charts: [{ spec: bar(), title: 'Sales by region' }],
  };
  assert.deepStrictEqual(errorsOf(checkPage, p), []);
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bc-schema-'));
  try {
    const file = path.join(dir, 'page.json');
    fs.writeFileSync(file, JSON.stringify(p));
    const r = compose({ ...readPage(file), distDir });
    assert.deepStrictEqual(r.diagnostics, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // the key is taken on a page and a spec only: a stray one deeper is still a mistake
  assert.notDeepStrictEqual(errorsOf(checkChart, { ...bar(), marks: [{ type: 'rect', x: 'region', y: 'total', $schema: url }] }), []);
});

/** A param of some block with this kind (found in the manifest, so the test follows the blocks). */
function paramOfKind(kind, role) {
  for (const [name, b] of Object.entries(manifest.blocks))
    if (!role || name.startsWith(role + '.'))
      for (const [p, d] of Object.entries(b.params || {}))
        if (d.kind === kind && !(b.channels && b.channels[p])) return { name, type: name.slice(name.indexOf('.') + 1), param: p, def: d };
  throw new Error(`no ${role || ''} param of kind ${kind}`);
}

test('schema: a broken spec is refused by the schema and reported by BC.validate, at the same place', () => {
  const color = paramOfKind('color', 'mark');
  const choice = paramOfKind('enum', 'mark');
  const format = paramOfKind('format', 'guide');
  const withMark = (extra) => ({ ...bar(), marks: [{ type: 'rect', x: 'region', y: 'total', ...extra }] });
  const cases = [
    ['a misspelled key of the spec', { ...bar(), interactions: [] }, 'interactions'],
    ['a mark that does not exist', { ...bar(), marks: [{ type: 'bar', x: 'region', y: 'total' }] }, 'marks[0].type'],
    ['a mark without a type', { ...bar(), marks: [{ x: 'region', y: 'total' }] }, 'marks[0].type'],
    ['a misspelled param', withMark({ colour: 'red' }), 'marks[0].colour'],
    ['a channel that is a number', withMark({ x: 5 }), 'marks[0].x'],
    ['a channel object with neither field nor value', withMark({ x: { scale: 'x' } }), 'marks[0].x'],
    ['a side an axis does not take', { ...bar(), guides: [{ type: 'axis', scale: 'x', position: 'middle' }] }, 'guides[0].position'],
    ['a required param left out', { ...bar(), transforms: [{ type: 'fold' }] }, 'transforms[0].fields'],
    ['a size of one number', { ...bar(), size: [640] }, 'size'],
    ['a negative padding', { ...bar(), padding: -1 }, 'padding'],
    ['a scale without a type', { ...bar(), scales: { x: { type: 'band' }, y: {} } }, 'scales.y.type'],
    ['a renderer that does not exist', { ...bar(), renderer: 'webgl' }, 'renderer'],
    ['marks that are not a list', { ...bar(), marks: { type: 'rect' } }, 'marks'],
    ['a title that is not text', { ...bar(), title: 7 }, 'title'],
    [
      `a color that loads a URL (${color.name}.${color.param})`,
      { ...bar(), marks: [{ ...minimal(color.name), [color.param]: 'url(https://example.com/x.svg)' }] },
      `marks[0].${color.param}`,
    ],
    [
      `a value an enum does not have (${choice.name}.${choice.param})`,
      { ...bar(), marks: [{ ...minimal(choice.name), [choice.param]: 'no-such-value' }] },
      `marks[0].${choice.param}`,
    ],
    [
      `a format that is no preset (${format.name}.${format.param})`,
      { ...bar(), guides: [{ type: format.type, scale: 'y', [format.param]: 'no-such-format' }] },
      `guides[0].${format.param}`,
    ],
  ];
  for (const [what, spec, at] of cases) {
    assert.notDeepStrictEqual(errorsOf(checkChart, spec), [], `the schema refuses ${what}`);
    const said = Array.from(BC.validate(spec));
    assert(
      said.some((d) => d.path === at || d.path.startsWith(at + '.')),
      `BC.validate reports ${what} at ${at}: ${JSON.stringify(said)}`,
    );
  }
});

/** The channels a mark cannot do without, as fields of the sales data: enough for the schema and the core to take it. */
function minimal(name) {
  const b = manifest.blocks[name];
  const out = { type: name.slice(name.indexOf('.') + 1) };
  for (const [c, d] of Object.entries(b.channels || {})) if (d.required && d.default === undefined) out[c] = c === 'x' ? 'region' : 'total';
  return out;
}

test('schema: a broken page is refused by the schema and by the composer', () => {
  const ok = () => ({ title: 'Sales', data: { sales: SALES }, charts: [bar()] });
  const cases = [
    ['a misspelled key of the page', { ...ok(), titel: 'x' }],
    ['a grid of 13 columns', { ...ok(), layout: { columns: 13 } }],
    ['three phone columns', { ...ok(), layout: { phoneColumns: 3 } }],
    ['compress as a word', { ...ok(), compress: 'yes' }],
    ['no charts', { ...ok(), charts: [] }],
    ['a section with a chart in it', { ...ok(), charts: [{ section: 'Sales', spec: bar() }, bar()] }],
    ['an empty section heading', { ...ok(), charts: [{ section: '' }, bar()] }],
    ['a span of 0', { ...ok(), charts: [{ spec: bar(), span: 0 }] }],
    ['a misspelled key of an entry', { ...ok(), charts: [{ spec: bar(), titel: 'x' }] }],
    ['raw HTML in a page.json', { ...ok(), charts: [{ spec: bar(), noteHtml: '<b>x</b>' }] }],
    ['a facet with a key it does not know', { ...ok(), charts: [{ spec: bar(), facet: { field: 'region', cols: 2 } }] }],
    ['a facet of 7 columns', { ...ok(), charts: [{ spec: bar(), facet: { field: 'region', columns: 7 } }] }],
    ['a language that is no tag', { ...ok(), lang: 'english!' }],
    ['a CSV delimiter of two characters', { ...ok(), data: { sales: { csv: 'a;b\n1;2', delimiter: ';;' } } }],
    ['a CSV type that is not number or string', { ...ok(), data: { sales: { csv: 'a,b\n1,2', types: { a: 'date' } } } }],
    ['a dataset with both csv and csvFile', { ...ok(), data: { sales: { csv: 'a\n1', csvFile: 'x.csv' } } }],
    ['a broken spec inside', { ...ok(), charts: [{ ...bar(), size: [640] }] }],
  ];
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bc-schema-'));
  try {
    for (const [what, p] of cases) {
      assert.notDeepStrictEqual(errorsOf(checkPage, p), [], `the schema refuses ${what}`);
      const file = path.join(dir, 'page.json');
      fs.writeFileSync(file, JSON.stringify(p));
      let refused = null;
      try {
        const r = compose({ ...readPage(file), distDir, baseDir: dir });
        if (r.diagnostics.length) refused = r.diagnostics;
      } catch (e) {
        if (!(e instanceof ComposeError)) throw e;
        refused = e.message;
      }
      assert(refused, `the composer refuses ${what}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('schema: the same manifest gives the same bytes, and a param of a kind it does not know stops the build', () => {
  assert.deepStrictEqual(schemaFiles(manifest), schemaFiles(JSON.parse(JSON.stringify(manifest))));
  const odd = JSON.parse(JSON.stringify(manifest));
  odd.blocks['mark.rect'].params.width = { kind: 'pixels' };
  assert.throws(
    () => schemaFiles(odd),
    (e) => e instanceof SchemaError && /mark\.rect\.width.*"pixels"/.test(e.message),
  );
  const noValues = JSON.parse(JSON.stringify(manifest));
  noValues.blocks['mark.rect'].params.width = { kind: 'enum' };
  assert.throws(() => schemaFiles(noValues), SchemaError);
});

let running = null;
process.on('exit', () => {
  if (running === null) return;
  console.log(`\nFAIL ${running}: never finished (it threw outside its promise, or waits on one that never settles)`);
  process.exitCode = 1;
});

(async () => {
  for (const [name, fn] of queue) {
    running = name;
    try {
      await fn();
      passed++;
      console.log('ok  ', name);
    } catch (e) {
      failed++;
      console.log('FAIL', name);
      console.error(e);
      process.exitCode = 1;
    }
  }
  running = null;
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
