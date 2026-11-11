// Tests for the manifest builder and the page composer. Run: npm test  (or node scripts/test-compose.js after a build)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');
const { buildManifest } = require('./build-manifest.js');
const { compose, ComposeError, DARK_PALETTE } = require('./compose.js');

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}

// ── manifest, on synthetic dist folders ──
const CORE = "(function(){ const VERSION = '9.9.9'; })();";
const block = (role, type, extra) =>
  `"use strict";\n(function () { BC.define({ role: '${role}', type: '${type}', version: 1${extra || ''} }); })();\n`;

function fixture(files, core) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-manifest-'));
  fs.mkdirSync(path.join(dir, 'blocks'));
  fs.writeFileSync(path.join(dir, 'core.js'), core === undefined ? CORE : core);
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'blocks', name), src);
  return dir;
}
const problems = (files, core) => {
  try {
    buildManifest(fixture(files, core));
  } catch (e) {
    return e.message;
  }
  return null;
};

test('manifest: closure is transitive, includes the block itself, ordered by role', () => {
  const m = buildManifest(
    fixture({
      'mark.m.js': block(
        'mark',
        'm',
        ", requires: ['scale.s'], channels: { x: { required: true } }, params: { p: { kind: 'number' } }, doc: 'd'",
      ),
      'scale.s.js': block('scale', 's', ", output: 'position', input: 'number', requires: ['transform.t']"),
      'transform.t.js': block('transform', 't'),
      'guide.g.js': block('guide', 'g'),
    }),
  );
  assert.deepStrictEqual(m.blocks['mark.m'].closure, ['scale.s', 'transform.t', 'mark.m']);
  assert.deepStrictEqual(m.blocks['scale.s'].closure, ['scale.s', 'transform.t']);
  assert.deepStrictEqual(m.blocks['guide.g'].closure, ['guide.g']);
  assert.deepStrictEqual(Object.keys(m.blocks), ['scale.s', 'transform.t', 'mark.m', 'guide.g'], 'blocks are listed by role');
  assert.deepStrictEqual(m.blocks['mark.m'].requires, ['scale.s']);
  assert.deepStrictEqual(m.blocks['mark.m'].channels, { x: { required: true } });
  assert.deepStrictEqual(m.blocks['mark.m'].params, { p: { kind: 'number' } });
  assert.strictEqual(m.blocks['mark.m'].doc, 'd');
  assert.strictEqual(m.core.version, '9.9.9');
  assert(m.blocks['mark.m'].bytes > 0 && m.core.bytes === Buffer.byteLength(CORE));
  assert.strictEqual(m.blocks['mark.m'].file, 'blocks/mark.m.js');
  assert.doesNotThrow(() => JSON.stringify(m));
});

test('manifest: diamond dependencies are listed once', () => {
  const m = buildManifest(
    fixture({
      'mark.top.js': block('mark', 'top', ", requires: ['scale.a', 'scale.b']"),
      'scale.a.js': block('scale', 'a', ", output: 'position', input: 'number', requires: ['scale.base']"),
      'scale.b.js': block('scale', 'b', ", output: 'position', input: 'number', requires: ['scale.base']"),
      'scale.base.js': block('scale', 'base', ", output: 'position', input: 'number'"),
    }),
  );
  assert.deepStrictEqual(m.blocks['mark.top'].closure, ['scale.a', 'scale.b', 'scale.base', 'mark.top']);
});

test('manifest: every kind of broken input is a clear error, all reported together', () => {
  assert.match(
    problems({
      'scale.a.js': block('scale', 'a', ", output: 'position', input: 'number', requires: ['scale.b']"),
      'scale.b.js': block('scale', 'b', ", output: 'position', input: 'number', requires: ['scale.a']"),
    }),
    /dependency cycle: scale\.a -> scale\.b -> scale\.a/,
  );
  assert.match(
    problems({ 'mark.m.js': block('mark', 'm', ", requires: ['scale.ghost']") }),
    /mark\.m requires scale\.ghost, which no block file provides/,
  );
  assert.match(problems({ 'mark.other.js': block('mark', 'm') }), /mark\.other\.js defines mark\.m; the file must be named mark\.m\.js/);
  assert.match(
    problems({ 'mark.m.js': 'BC.define({role:"mark",type:"m",version:1});BC.define({role:"mark",type:"n",version:1});' }),
    /exactly once \(it called it 2 times\)/,
  );
  assert.match(problems({ 'mark.m.js': '/* nothing */' }), /exactly once \(it called it 0 times\)/);
  assert.match(problems({ 'mark.m.js': block('mark', 'm', ", note: '</script><script>alert(1)'") }), /contains "<\/script"/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"mark",type:"m",version:1}); // <!-- oops' }), /contains "<\/script" or "<!--"/);
  assert.match(problems({ 'mark.m.js': 'this is not javascript (' }), /failed to run against the stub BC/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"widget",type:"m",version:1});' }), /invalid role\/type/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"mark",type:"m",version:0});' }), /version must be a positive integer/);
  assert.match(problems({ 'mark.m.js': 'while(true){}' }), /failed to run/, 'a block that never returns is cut off');
  assert.match(problems({ 'mark.m.js': block('mark', 'm') }, '// no version'), /cannot find `const VERSION/);
  assert.match(problems({}, '/* </script> */ const VERSION = "x";'), /core\.js/);
  // what scales declare and channels accept is what blocks meet by: saying nothing, or naming scale types, is an error
  assert.match(
    problems({ 'scale.s.js': block('scale', 's') }),
    /scale\.s must declare its output \(position, color, size\) and its input \(number, date, category\)/,
  );
  assert.match(problems({ 'scale.s.js': block('scale', 's', ", output: 'shape', input: 'number'") }), /scale\.s must declare its output/);
  assert.match(problems({ 'scale.s.js': block('scale', 's', ", output: 'color', input: 'text'") }), /scale\.s must declare its output/);
  assert.match(
    problems({ 'mark.m.js': block('mark', 'm', ", channels: { x: { scales: ['linear'] } }") }),
    /channel "x" of mark\.m names scale types; say what it accepts with accepts: \{ output, input \}/,
  );
  for (const bad of ["{ output: 'place' }", "{ output: 'position', input: 'number' }", "{ output: 'position', input: ['numbers'] }"])
    assert.match(
      problems({ 'mark.m.js': block('mark', 'm', `, channels: { x: { accepts: ${bad} } }`) }),
      /channel "x" of mark\.m: accepts must be \{ output: one of position, color, size, input: a list of number, date, category \}/,
      bad,
    );
  const scaleOk = buildManifest(fixture({ 'scale.s.js': block('scale', 's', ", output: 'color', input: 'category'") }));
  assert.deepStrictEqual([scaleOk.blocks['scale.s'].output, scaleOk.blocks['scale.s'].input], ['color', 'category'], 'in the manifest');
  const many = problems({ 'a.js': '', 'mark.m.js': block('mark', 'm', ", requires: ['scale.ghost']") });
  assert(/2 problem\(s\)/.test(many), many);
  assert.throws(() => buildManifest(path.join(os.tmpdir(), 'bc-does-not-exist')), /run the TypeScript build first/);
});

test('manifest: the real build is consistent', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/manifest.json'), 'utf8'));
  const files = fs.readdirSync(path.join(__dirname, '../dist/blocks')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(Object.keys(m.blocks).length, files.length, 'every block file has an entry');
  for (const [name, e] of Object.entries(m.blocks)) {
    assert(e.closure.includes(name), name);
    assert(
      e.requires.every((r) => m.blocks[r]),
      `${name}: requires exist`,
    );
    assert.strictEqual(e.file, `blocks/${name}.js`);
    assert.strictEqual(e.bytes, fs.statSync(path.join(__dirname, '../dist', e.file)).size, `${name}: bytes match the file`);
  }
  assert.deepStrictEqual(
    m,
    JSON.parse(JSON.stringify(buildManifest(path.join(__dirname, '../dist')))),
    'manifest.json is up to date with the blocks',
  );
});

// ── composer, on the real blocks ──
const DATA = {
  cats: [
    { k: 'a', v: 3 },
    { k: 'b', v: 6 },
  ],
  pts: [
    { x: 1, y: 2, g: 'A' },
    { x: 2, y: 3, g: 'B' },
  ],
};
const bars = () => ({
  data: 'cats',
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  guides: [
    { type: 'axis', scale: 'x' },
    { type: 'axis', scale: 'y' },
  ],
  marks: [{ type: 'rect', x: 'k', y: 'v' }],
});
const scatter = () => ({
  data: 'pts',
  scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'color' } },
  guides: [
    { type: 'axis', scale: 'x' },
    { type: 'axis', scale: 'y' },
    { type: 'legend', scale: 'color' },
  ],
  marks: [{ type: 'point', x: 'x', y: 'y', color: 'g' }],
  interaction: [{ type: 'tooltip' }],
});
const failsWith = (fn, re) => assert.throws(fn, (e) => e instanceof ComposeError && re.test(e.message), `expected ComposeError ${re}`);

test('compose: only the blocks the charts need are inlined, in a fixed order', () => {
  const r = compose({ data: DATA, charts: [bars()] });
  assert.deepStrictEqual(r.blocks, ['lib.ticks', 'scale.band', 'scale.linear', 'mark.rect', 'guide.axis', 'renderer.svg']);
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/manifest.json'), 'utf8'));
  const everything = Object.values(m.blocks).reduce((n, b) => n + b.bytes, m.core.bytes);
  assert(r.bytes < everything * 0.7, `${r.bytes} vs ${everything}`);
  assert(!r.html.includes('mark.line') && !r.html.includes("type: 'zoom'"), 'no unused block code');
  const two = compose({ data: DATA, charts: [bars(), scatter()] });
  assert.deepStrictEqual(
    two.blocks,
    [
      'lib.pointer',
      'lib.ticks',
      'scale.band',
      'scale.color',
      'scale.linear',
      'mark.point',
      'mark.rect',
      'guide.axis',
      'guide.legend',
      'interaction.tooltip',
      'renderer.svg',
    ],
    'union over both charts',
  );
  assert.strictEqual(
    compose({ data: DATA, charts: [bars()], include: ['mark.line', 'interaction.zoom'] }).blocks.includes('interaction.zoom'),
    true,
    'include adds blocks for hand-written scripts',
  );
});

test('compose: the same input gives byte-identical output', () => {
  const a = compose({ title: 'T', data: DATA, charts: [bars(), scatter()], css: 'body{margin:0}' });
  const b = compose({ title: 'T', data: DATA, charts: [scatter(), bars()].reverse(), css: 'body{margin:0}' });
  assert.strictEqual(a.html, b.html);
});

test('compose: nothing in data, specs, titles or css can break out of its tag', () => {
  const evil = '</script><script>alert(1)</script><!--   & "quoted" ';
  const data = {
    cats: [
      { k: evil, v: 3 },
      { k: 'b', v: 6 },
    ],
  };
  const spec = { ...bars(), title: evil };
  const r = compose({
    title: evil,
    data,
    charts: [{ spec, title: evil, note: evil, noteHtml: '<code>ok</code>' }],
    css: '</style><script>alert(2)</script>',
    before: '<!-- mine -->',
  });
  const html = r.html;
  assert(!html.includes('</style><script>'), 'a stylesheet cannot close its own tag early');
  assert.strictEqual(html.match(/<\/style>/g).length, 1, 'exactly one real </style>');
  assert(!html.includes(evil), 'the raw payload appears nowhere');
  // every <script> that is opened is closed exactly once, and nothing else closes one
  assert.strictEqual(html.match(/<script/g).length, html.match(/<\/script>/g).length);
  const dataJson = html.match(/<script type="application\/json" id="bc-data">(.*?)<\/script>/s)[1];
  assert.deepStrictEqual(JSON.parse(dataJson), data, 'data survives the round trip');
  const specJson = html.match(/<script type="application\/json" data-bc-chart>(.*?)<\/script>/s)[1];
  assert.deepStrictEqual(JSON.parse(specJson), spec, 'spec survives the round trip');
  assert(html.includes('<title>&lt;/script&gt;&lt;script&gt;alert(1)'), 'title is escaped text');
  assert(html.includes('<code>ok</code>'), 'noteHtml is passed through as the caller asked');
});

test('compose: unknown blocks, bad specs and bad input are ComposeErrors with the reason', () => {
  failsWith(
    () => compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'hexbin', x: 'k', y: 'v' }] }] }),
    /no such block: mark\.hexbin\. Available: .*mark\.rect/,
  );
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), renderer: 'webgl' }] }), /no such block: renderer\.webgl/);
  failsWith(
    () => compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }] }),
    /charts\[0\]\.marks\[0\]\.y: unknown field "ghost"/,
  );
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), data: 'nope' }] }), /dataset "nope" is not in the data lake/);
  failsWith(() => compose({ data: DATA, charts: [bars(), { ...scatter(), scales: { x: { type: 'linear' } } }] }), /charts\[1\]/);
  failsWith(() => compose({ data: { cats: 5 }, charts: [bars()] }), /data "cats": .*array of rows/);
  failsWith(() => compose({ data: [], charts: [bars()] }), /data must be an object/);
  failsWith(() => compose({ data: DATA, charts: [] }), /non-empty array/);
  failsWith(() => compose({ data: DATA }), /non-empty array/);
  failsWith(() => compose({ data: DATA, charts: [null] }), /charts\[0\] is not a chart spec/);
  failsWith(() => compose({ data: DATA, charts: [bars()], distDir: path.join(os.tmpdir(), 'bc-nowhere') }), /manifest\.json not found/);
  try {
    compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }] });
    assert.fail('should throw');
  } catch (e) {
    assert(
      e.diagnostics.some((d) => d.level === 'error' && d.path === 'charts[0].marks[0].y'),
      'diagnostics are attached',
    );
  }
  assert.doesNotThrow(
    () => compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }], allowErrors: true }),
    'allowErrors ships the page anyway',
  );
});

test('compose: a chart id is a plain name, used once, and never the id of the data', () => {
  failsWith(
    () =>
      compose({
        data: DATA,
        charts: [
          { ...bars(), id: 'sales' },
          { ...scatter(), id: 'sales' },
        ],
      }),
    /charts\[1\]\.id "sales" is also the id of charts\[0\]/,
  );
  failsWith(
    () => compose({ data: DATA, charts: [{ ...bars(), id: 'bc-data' }] }),
    /charts\[0\]\.id "bc-data" is the id of the page's data/,
  );
  for (const bad of ['', '1st', 'a b', 'x"><script>', 5])
    failsWith(() => compose({ data: DATA, charts: [{ ...bars(), id: bad }] }), /charts\[0\]\.id must be a name/);
  const r = compose({
    data: DATA,
    charts: [
      { ...bars(), id: 'sales-2024' },
      { ...scatter(), id: 'Mix_1' },
    ],
  });
  assert.strictEqual(runPage(r.html).handles.length, 2);
});

test('compose: warnings do not stop the page, unused data is reported', () => {
  const r = compose({
    data: { ...DATA, spare: [{ a: 1 }] },
    charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'v', shade: 'red' }] }],
  });
  assert(r.diagnostics.some((d) => d.level === 'warn' && d.path === 'charts[0].marks[0].shade'));
  assert.deepStrictEqual(r.unusedData.sort(), ['pts', 'spare']);
});

test('compose: the text set on each palette color is the one with more contrast, in both themes', () => {
  const lum = (hex) => {
    const part = (i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * part(0) + 0.7152 * part(2) + 0.0722 * part(4);
  };
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const css = compose({ data: DATA, charts: [bars()] }).html.match(/<style>[\s\S]*?<\/style>/)[0];
  const colors = [...css.matchAll(/--bc-c(\d+):#([0-9a-f]{6})/g)];
  const inks = [...css.matchAll(/--bc-on-c(\d+):#(fff|111)/g)];
  assert.strictEqual(colors.length, 24, 'twelve colors, two themes');
  assert.strictEqual(inks.length, 24);
  colors.forEach(([, n, hex], i) => {
    assert.strictEqual(inks[i][1], n);
    const light = contrast(lum(hex), 1);
    const dark = contrast(lum(hex), lum('111111'));
    assert.strictEqual(inks[i][2], dark >= light ? '111' : 'fff', `--bc-c${n}: #${hex}`);
  });
});

test('compose: the light colors of a page are the ones the core falls back on, and the dark ones as many', () => {
  const dist = path.join(__dirname, '../dist/min');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dist, 'core.js'), 'utf8'), sandbox);
  const palette = Array.from(sandbox.BC.palette);
  assert.strictEqual(palette.length, 12);
  palette.forEach((c, i) => assert.strictEqual(sandbox.BC.color(i), `var(--bc-c${i}, ${c})`));
  assert.strictEqual(DARK_PALETTE.length, palette.length, 'a dark color for every light one');
  const css = compose({ data: DATA, charts: [bars()], distDir: dist }).html.match(/<style>[\s\S]*?<\/style>/)[0];
  const light = css.slice(0, css.indexOf('prefers-color-scheme:dark'));
  const dark = css.slice(css.indexOf('prefers-color-scheme:dark'));
  assert.deepStrictEqual(
    [...light.matchAll(/--bc-c\d+:(#[0-9a-f]{6})/g)].map((m) => m[1]),
    palette,
  );
  assert.deepStrictEqual(
    [...dark.matchAll(/--bc-c\d+:(#[0-9a-f]{6})/g)].map((m) => m[1]),
    DARK_PALETTE,
  );
});

test('compose: unused datasets stay off the page, unless a script of the page may read them', () => {
  const charts = [bars()];
  const lean = compose({ data: { ...DATA, spare: [{ secret: 'left-behind' }] }, charts });
  assert(!lean.html.includes('left-behind'));
  const kept = compose({ data: { ...DATA, spare: [{ secret: 'left-behind' }] }, charts, after: '<script>/* mine */</script>' });
  assert(kept.html.includes('left-behind'));
});

test('compose: a facet on a field a transform makes, with the filter right after that transform', () => {
  const rows = [
    { d: '2023-01-01', v: 1 },
    { d: '2023-06-01', v: 2 },
    { d: '2024-01-01', v: 3 },
  ];
  const spec = () => ({
    data: 'd',
    transforms: [
      { type: 'calculate', a: 'v', op: '*', value: 2, as: 'year' },
      { type: 'sort', field: 'v' },
    ],
    scales: { x: { type: 'band' }, y: { type: 'linear' } },
    marks: [{ type: 'rect', x: 'd', y: 'v' }],
  });
  const specs = (html) => [...html.matchAll(/data-bc-chart>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
  const made = specs(compose({ data: { d: rows }, charts: [{ spec: spec(), facet: { field: 'year' } }] }).html);
  assert.strictEqual(made.length, 3);
  assert.deepStrictEqual(made[1].transforms[1], { type: 'filter', field: 'year', value: 4 });
  assert.strictEqual(made[0].transforms[2].type, 'sort');
  assert.throws(
    () => compose({ data: { d: rows }, charts: [{ spec: spec(), facet: { field: 'nope' } }] }),
    /"nope" is not a column of "d", and no transform of the chart makes it/,
  );
  assert.throws(
    () => compose({ data: { d: rows }, charts: [{ spec: spec(), facet: { field: 'year', values: [1999] } }] }),
    /1999 is not a value of "year"/,
  );
  const plain = { ...spec(), transforms: undefined };
  assert.throws(() => compose({ data: { d: rows }, charts: [{ spec: plain, facet: { field: 'nope' } }] }), /"nope" is not a column/);
});

const { runPage, countTags } = require('./run-page.js');

test('compose: the produced page mounts and draws when its scripts run', () => {
  const r = compose({ title: 'Run', data: DATA, charts: [{ spec: bars(), title: 'Bars' }, scatter()] });
  const { handles, body } = runPage(r.html);
  assert.strictEqual(handles.length, 2);
  assert(
    handles.every((h) => h.diagnostics.length === 0),
    JSON.stringify(handles.map((h) => h.diagnostics)),
  );
  assert.strictEqual(countTags(handles[0].host.children[0], 'rect'), 2, 'two bars');
  assert.strictEqual(countTags(handles[1].host.children[0], 'circle'), 2);
  assert.strictEqual(body.children.filter((c) => c.className === 'bc-chart').length, 2, 'a host div was inserted for each chart');
});

// ── compression ──
const BIG = Array.from({ length: 400 }, (_, i) => ({ a: i, b: Math.round(Math.sin(i / 7) * 1000), name: 'series ' + (i % 5) }));
const bigSpec = () => ({
  data: 'big',
  scales: { x: { type: 'linear' }, y: { type: 'linear' } },
  marks: [{ type: 'point', x: 'a', y: 'b' }],
});
const storedData = (html) => JSON.parse(html.match(/<script type="application\/json" id="bc-data">(.*?)<\/script>/s)[1]);

test('compose: big datasets are stored as base64(gzip), small ones stay readable, and it is optional', () => {
  const r = compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()] });
  assert.deepStrictEqual(r.compressed, ['big']);
  const stored = storedData(r.html);
  assert.deepStrictEqual(stored.cats, DATA.cats, 'a small dataset is untouched');
  assert.deepStrictEqual(Object.keys(stored.big), ['encoding', 'data']);
  assert.strictEqual(stored.big.encoding, 'gzip+base64');
  assert.deepStrictEqual(
    JSON.parse(zlib.gunzipSync(Buffer.from(stored.big.data, 'base64')).toString('utf8')),
    BIG,
    'exactly the original rows',
  );
  const plainPage = compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()], compress: false });
  // smaller by what gzip saves on the data, less the decoder the compressed page carries (about 3 KB)
  assert(r.html.length < plainPage.html.length - 6000, `the page is much smaller: ${r.html.length} vs ${plainPage.html.length}`);
  assert.strictEqual(r.core, 'core.composed.js', 'with the decoder');
  assert.strictEqual(plainPage.core, 'core.composed-plain.js', 'without it');
  assert.deepStrictEqual(plainPage.compressed, []);
  assert.deepStrictEqual(compose({ data: DATA, charts: [bars()], compress: true }).compressed, ['cats'], 'true = everything on the page');
  assert.strictEqual(compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()] }).html, r.html, 'deterministic');
  failsWith(() => compose({ data: DATA, charts: [bars()], compress: 'yes' }), /compress must be/);
});

test('compose: data larger than a page unpacks is never compressed: "auto" stores it as it is, true is an error', () => {
  // 1,200 rows of 61,000 characters: 70 MB of JSON, past the 64 MB a page unpacks (and gzip makes it tiny)
  const long = 'x'.repeat(61000);
  const huge = Array.from({ length: 1200 }, (_, i) => ({ k: 'k' + (i % 7), v: i, note: long }));
  const spec = { ...bars(), data: 'huge' };
  const r = compose({ data: { huge }, charts: [spec] });
  assert.deepStrictEqual(r.compressed, [], 'auto: left as it is, so the page can read it');
  assert.strictEqual(r.core, 'core.composed-plain.js');
  assert(r.html.length > 64 * 1024 * 1024);
  failsWith(
    () => compose({ data: { huge }, charts: [spec], compress: true }),
    /data "huge" is 70 MB as JSON, and a page unpacks no more than 64 MB of compressed data/,
  );
});

test('compose: "auto" leaves data that does not compress well alone', () => {
  let seed = 1;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const noise = Array.from({ length: 300 }, () => ({
    k: Array.from({ length: 40 }, () => alphabet[(seed = (seed * 16807) % 2147483647) % 64]).join(''),
  }));
  const r = compose({
    data: { noise },
    charts: [{ data: 'noise', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'k', y: 'k' }] }],
    allowErrors: true,
  });
  assert.deepStrictEqual(r.compressed, [], 'random text gains too little from gzip+base64 to be worth the decode step');
  assert.deepStrictEqual(storedData(r.html).noise, noise);
});

test('compose: specs are still checked against the real data of a compressed dataset', () => {
  const typo = { ...bigSpec(), marks: [{ type: 'point', x: 'a', y: 'bb' }] };
  failsWith(() => compose({ data: { big: BIG }, charts: [typo] }), /charts\[0\]\.marks\[0\]\.y: unknown field "bb"/);
});

test('compose: an already-encoded dataset is passed through untouched and validated by its content', () => {
  const raw = zlib.gzipSync(Buffer.from(JSON.stringify(BIG))).toString('base64');
  const wrapped = { encoding: 'gzip+base64', data: raw.replace(/(.{60})/g, '$1\n') };
  assert(/s/.test(raw), 'the sample contains the letter s, which a sloppy whitespace strip would eat');
  const r = compose({ data: { big: wrapped }, charts: [bigSpec()] });
  assert.deepStrictEqual(storedData(r.html).big, wrapped, 'the page carries the caller envelope as given');
  assert.deepStrictEqual(r.compressed, []);
  failsWith(
    () => compose({ data: { big: wrapped }, charts: [{ ...bigSpec(), marks: [{ type: 'point', x: 'a', y: 'nope' }] }] }),
    /unknown field "nope"/,
  );
  failsWith(() => compose({ data: { big: { encoding: 'gzip+base64', data: 'not gzip' } }, charts: [bigSpec()] }), /data "big":/);
  failsWith(
    () => compose({ data: { big: { encoding: 'rot13', data: 'x' } }, charts: [bigSpec()] }),
    /data "big": unknown encoding "rot13"/,
  );
  failsWith(() => compose({ data: { big: { encoding: 'base64' } }, charts: [bigSpec()] }), /needs a "data" string/);
});

test('compose: encoded data the browser would refuse is refused here too: base64url, stray characters, a gzip bomb', () => {
  // Node's Buffer.from reads base64url and skips what it does not know; the page's atob() does neither
  const std = zlib.gzipSync(Buffer.from(JSON.stringify(BIG))).toString('base64');
  assert(/[+/]/.test(std), 'the sample has the two characters base64url replaces');
  const url = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  failsWith(
    () => compose({ data: { big: { encoding: 'gzip+base64', data: url } }, charts: [bigSpec()] }),
    /data "big": .*not valid base64/,
  );
  const stray = std.slice(0, 40) + '!' + std.slice(40);
  failsWith(() => compose({ data: { big: { encoding: 'gzip+base64', data: stray } }, charts: [bigSpec()] }), /not valid base64/);
  const column = { dtype: 'float64', encoding: 'base64', data: url };
  failsWith(
    () => compose({ data: { big: { columns: { a: column, b: column } } }, charts: [bigSpec()] }),
    /data "big": column "a": the data is not valid base64/,
  );
  // 70 MB of zeros is 70 KB of gzip; the page would refuse to unpack it (64 MB), so the composer does not pass it
  const bomb = zlib.gzipSync(Buffer.alloc(70 * 1024 * 1024)).toString('base64');
  failsWith(
    () => compose({ data: { big: { encoding: 'gzip+base64', data: bomb } }, charts: [bigSpec()] }),
    /data "big": the decoded data is larger than 64 MB/,
  );
  failsWith(
    () => compose({ data: { big: { columns: { a: { dtype: 'uint8', encoding: 'gzip+base64', data: bomb } } } }, charts: [bigSpec()] }),
    /data "big": column "a": the decoded data is larger than 64 MB/,
  );
});

test('compose: the page with compressed data decodes it the way a browser does, and draws', async () => {
  const r = compose({ data: { big: BIG }, charts: [bigSpec()], compress: true });
  assert.deepStrictEqual(r.compressed, ['big']);
  const { handles, BC, errors } = runPage(r.html);
  assert.strictEqual(handles[0].host.children[0].attrs.class, 'bc-loading', 'while it decodes');
  await handles[0].ready;
  await BC.ready();
  assert.strictEqual(countTags(handles[0].host.children[0], 'circle'), 400);
  assert.strictEqual(handles[0].diagnostics.length, 0, JSON.stringify(handles[0].diagnostics));
  assert.deepStrictEqual(errors, []);
});

// ── the core a page carries ──
test('compose: a page carries the core without checks, and the decoder only when a dataset is encoded', async () => {
  const plainPage = compose({ data: DATA, charts: [bars(), scatter()] });
  assert.strictEqual(plainPage.core, 'core.composed-plain.js');
  const run = runPage(plainPage.html);
  for (const h of run.handles) await h.ready;
  assert.strictEqual(countTags(run.handles[0].host.children[0], 'rect') > 0, true, 'it draws');
  assert.strictEqual(run.BC.validate, undefined);
  assert.strictEqual(run.BC.needs, undefined);
  assert.deepStrictEqual(run.errors, []);
  // the plain core cannot decode, and says so instead of drawing nothing
  assert.throws(
    () => run.BC.data('late', { encoding: 'base64', data: 'e30=' }),
    /composed without the code that decodes data: compose it again/,
  );

  const encoded = { encoding: 'base64', data: Buffer.from(JSON.stringify(DATA.cats)).toString('base64') };
  assert.strictEqual(compose({ data: { cats: encoded }, charts: [bars()] }).core, 'core.composed.js', 'an encoded dataset given as it is');
  const binary = {
    columns: {
      k: ['a', 'b'],
      v: { dtype: 'float64', encoding: 'base64', data: Buffer.from(new Float64Array([3, 6]).buffer).toString('base64') },
    },
  };
  const withBinary = compose({ data: { cats: binary }, charts: [bars()] });
  assert.strictEqual(withBinary.core, 'core.composed.js', 'a binary column');
  const runBinary = runPage(withBinary.html);
  await runBinary.handles[0].ready;
  await runBinary.BC.ready();
  assert.strictEqual(countTags(runBinary.handles[0].host.children[0], 'rect'), 2);

  // a page composed with errors keeps the checks, so it shows them
  const broken = compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'nope' }] }], allowErrors: true });
  assert.strictEqual(broken.core, 'core.js');
  const runBroken = runPage(broken.html);
  assert(
    runBroken.handles[0].diagnostics.some((d) => /nope/.test(d.message)),
    'the page itself reports the error',
  );
});

test('compose: a page whose data cannot be decoded in this browser says why, though its core has no checks', async () => {
  const r = compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()] });
  assert.strictEqual(r.core, 'core.composed.js', 'the lean core with the decoder');
  const run = runPage(r.html, undefined, { DecompressionStream: undefined });
  for (const h of run.handles) await h.ready;
  const h = run.handles[1];
  assert(
    h.diagnostics.some((d) => d.level === 'error' && d.path === 'data' && /no DecompressionStream/.test(d.message)),
    JSON.stringify(h.diagnostics),
  );
  assert(
    !run.errors.some((e) => /Cannot read properties/.test(e)),
    'no TypeError from drawing a dataset that is not there: ' + run.errors.join('\n'),
  );
  assert(countTags(run.handles[0].host.children[0], 'rect') > 0, 'the chart on plain data still draws');
});

test('compose: "auto" does not compress when the decoder would cost more than gzip saves', () => {
  // a little over the 2 KB threshold, and about half of it saved: less than the decoder
  const rows = Array.from({ length: 90 }, (_, i) => ({ k: 'item ' + i, v: (i * 7919) % 1000 }));
  const spec = { data: 'rows', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'k', y: 'v' }] };
  const r = compose({ data: { rows }, charts: [spec] });
  assert.deepStrictEqual(r.compressed, [], 'not worth it');
  assert.strictEqual(r.core, 'core.composed-plain.js');
  assert.deepStrictEqual(storedData(r.html).rows, rows);
  assert.deepStrictEqual(compose({ data: { rows }, charts: [spec], compress: true }).compressed, ['rows'], 'true still means always');
  // once something has to be decoded anyway, the decoder is already paid for
  const encoded = { encoding: 'base64', data: Buffer.from(JSON.stringify(DATA.cats)).toString('base64') };
  assert.deepStrictEqual(compose({ data: { rows, cats: encoded }, charts: [spec, bars()] }).compressed, ['rows']);
});

// ── functions and other things JSON cannot carry ──
test('compose: a function (or anything else JSON would drop or change) in a spec is refused with its path', () => {
  const withFn = { ...scatter(), interaction: [{ type: 'tooltip' }, { type: 'tooltip', content: (d) => d.row }] };
  failsWith(
    () => compose({ data: DATA, charts: [bars(), withFn] }),
    /^charts\[1\]\.interaction\[1\]\.content is a function; a JSON spec cannot carry code\. Register it with BC\.defineFn/,
  );
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), title: NaN }] }), /charts\[0\]\.title is NaN, which JSON turns into null/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), size: [640, Infinity] }] }), /charts\[0\]\.size\[1\] is Infinity/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), title: Symbol('x') }] }), /is a symbol/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), title: 10n }] }), /is a bigint/);
  const loop = bars();
  loop.self = loop;
  failsWith(() => compose({ data: DATA, charts: [loop] }), /charts\[0\]\.self is a circular reference/);
  // a spec nested thousands deep is said to be, not a stack overflow
  let deep = {};
  for (let i = 0; i < 5000; i++) deep = { a: deep };
  failsWith(
    () => compose({ data: DATA, charts: [{ ...bars(), title: deep }] }),
    /charts\[0\]\.title(\.a)+ is nested more than 100 levels deep/,
  );
  assert.doesNotThrow(
    () => compose({ data: DATA, charts: [{ ...bars(), notes: JSON.parse('{"a":'.repeat(20) + '1' + '}'.repeat(20)) }] }),
    'twenty levels is not too deep',
  );
  assert.doesNotThrow(
    () => compose({ data: DATA, charts: [{ ...bars(), title: undefined }] }),
    'undefined properties are simply dropped, as JSON does',
  );
  const shared = { type: 'axis', scale: 'x' };
  assert.doesNotThrow(
    () => compose({ data: DATA, charts: [{ ...bars(), guides: [shared, shared] }] }),
    'the same object twice is not a cycle',
  );
});

test('compose: a tooltip function registered by name in an "after" script is found by the page', () => {
  const r = compose({
    data: DATA,
    charts: [{ ...scatter(), interaction: [{ type: 'tooltip', content: 'myTip' }] }],
    after: '<script>BC.defineFn("myTip", function (d) { return "row " + d.row; });</script>',
  });
  const { BC, handles, errors } = runPage(r.html);
  assert.strictEqual(typeof BC.getFn('myTip'), 'function', 'the page script registered it');
  assert.strictEqual(handles[0].diagnostics.length, 0, 'a name in the spec is not an error: ' + JSON.stringify(handles[0].diagnostics));
  assert.deepStrictEqual(errors, []);
});

test('compose: phoneColumns pairs the tiles that draw at any width, next to each other; the rest take the row', () => {
  const data = { d: [{ k: 'a', v: 1 }] };
  const tile = { data: 'd', scales: {}, marks: [], guides: [{ type: 'kpi', field: 'v' }] };
  const spark = {
    data: 'd',
    scales: { x: { type: 'band' }, y: { type: 'linear' } },
    marks: [{ type: 'line', x: 'k', y: 'v' }],
    guides: [{ type: 'kpi', field: 'v' }],
  };
  const legend = {
    data: 'd',
    scales: { c: { type: 'color' } },
    marks: [{ type: 'arc', value: 'v', color: { field: 'k', scale: 'c' } }],
    guides: [{ type: 'legend', scale: 'c' }],
  };
  const labelled = { ...spark, marks: [{ type: 'line', x: 'k', y: 'v', label: 'name' }] };
  const classes = (charts, layout = { columns: 4, phoneColumns: 2 }) =>
    [...compose({ data, layout, charts }).html.matchAll(/<section class="bc-section([^"]*)"/g)].map((m) => m[1].trim());
  const one = (spec, title) => ({ spec, span: 1, title });

  assert.deepStrictEqual(
    classes([one(tile), one(spark), one(tile), { spec: tile, span: 3 }, one(legend), one(labelled), one(tile), one(tile)]),
    ['bc-tile bc-pair', 'bc-tile bc-pair', 'bc-tile', '', 'bc-tile', 'bc-tile', 'bc-tile bc-pair', 'bc-tile bc-pair'],
    'pairs of narrow tiles; the third of a run, a wide card, a legend, end labels each take the row on a phone',
  );
  assert.deepStrictEqual(
    classes([one(tile), { section: 'Next' }, one(tile), one(tile)]),
    ['bc-tile', 'bc-tile bc-pair', 'bc-tile bc-pair'],
    'a heading ends a run',
  );
  assert.deepStrictEqual(classes([one(tile), one(tile)], { columns: 4 }), ['bc-tile', 'bc-tile'], 'without phoneColumns 2, no pairs');
  const facet = { spec: spark, span: 1, facet: { field: 'k' } };
  assert.deepStrictEqual(classes([facet, one(tile)]), ['bc-tile', 'bc-tile'], 'a facet is never a pair');

  const { html } = compose({ data, layout: { columns: 4, phoneColumns: 2 }, charts: [one(tile), one(tile)] });
  assert(html.includes('--bc-phone-cols:2'));
  assert(/@media \(max-width:720px\)\{[^@]*\.bc-section\.bc-pair\{grid-column:auto!important/.test(html), 'a pair shares a row');
  assert(
    /\.bc-tile\{display:flex;flex-direction:column\}\.bc-tile>\.bc-chart[^{]*\{margin:auto 0\}/.test(html),
    'a stretched tile centers',
  );
  assert.throws(() => compose({ data, charts: [{ title: 'Note', note: 'Text' }] }), /text alone is/);
});

test('compose: a dashboard grid — columns, spans, a heading and a subtitle; bad layouts are refused', () => {
  const page = compose({
    title: 'Q3 <review>',
    subtitle: 'Sales & margin',
    layout: { columns: 4 },
    data: DATA,
    charts: [{ spec: bars(), span: 1 }, { spec: bars(), span: 3, title: 'Wide' }, bars()],
  });
  const h = page.html;
  assert(
    h.includes('<main class="bc-page bc-wide">') && h.includes('<div class="bc-grid" style="--bc-cols:4">'),
    'a wide page with a 4-column grid',
  );
  assert(h.includes('<h1>Q3 &lt;review&gt;</h1><p>Sales &amp; margin</p>'), 'the heading and subtitle, escaped');
  const spans = [...h.matchAll(/<section class="bc-section(?: bc-tile)?" style="grid-column:span (\d+)">/g)].map((m) => +m[1]);
  assert.deepStrictEqual(spans, [1, 3, 4], 'spans as given; a chart without one takes the full row');
  assert(h.indexOf('<h1>') < h.indexOf('<div class="bc-grid"'), 'the heading comes before the grid');

  const single = compose({ data: DATA, charts: [bars()] }).html;
  assert(
    single.includes('<main class="bc-page">') && !single.includes('style="--bc-cols') && !single.includes('style="grid-column'),
    'one column: a narrow page, cards without spans',
  );
  assert(single.includes('<section class="bc-section">'), 'even a chart with no title sits in a card');
  assert(!single.includes('<header'), 'no heading without a title');

  for (const [layout, re] of [
    [{ columns: 2, phoneColumns: 3 }, /layout.phoneColumns/],
    [{ columns: 0 }, /layout.columns/],
    [{ columns: 13 }, /layout.columns/],
    [{ columns: 2.5 }, /layout.columns/],
    [[], /layout must be an object/],
    ['4', /layout must be an object/],
  ]) {
    assert.throws(
      () => compose({ data: DATA, charts: [bars()], layout }),
      (e) => e instanceof ComposeError && re.test(e.message),
      JSON.stringify(layout),
    );
  }
  for (const span of [0, 5, 1.5, '2']) {
    assert.throws(
      () => compose({ data: DATA, charts: [{ spec: bars(), span }], layout: { columns: 4 } }),
      (e) => e instanceof ComposeError && /charts\[0\]\.span/.test(e.message),
      String(span),
    );
  }
  assert.throws(() => compose({ data: DATA, charts: [{ spec: bars(), span: 2 }] }), /from 1 to 1/, 'a span needs a grid to span');
});

test('compose: sections head groups of cards, and paths still name the entry of the list', () => {
  const page = compose({
    data: DATA,
    layout: { columns: 4 },
    charts: [
      { section: 'Sales <all>', note: 'Q3 & Q4' },
      { title: 'One', spec: bars(), span: 2 },
      { section: 'Costs' },
      { title: 'Two', spec: bars() },
    ],
  });
  const h = page.html;
  assert(h.includes('<div class="bc-group"><h2>Sales &lt;all&gt;</h2><p>Q3 &amp; Q4</p></div>'), 'the heading, escaped');
  assert(h.indexOf('Sales &lt;all&gt;') < h.indexOf('>One<') && h.indexOf('>One<') < h.indexOf('>Costs<'), 'in the order given');
  assert(h.includes('<h3>One</h3>') && !h.includes('<h2>One</h2>'), 'card titles go one level down');
  assert(compose({ data: DATA, charts: [{ title: 'One', spec: bars() }] }).html.includes('<h2>One</h2>'), 'without sections they stay h2');
  assert.strictEqual([...h.matchAll(/<script type="application\/json" data-bc-chart>/g)].length, 2);

  const broken = bars();
  broken.marks = [{ type: 'rect', x: 'nope', y: 'revenue' }];
  assert.throws(
    () => compose({ data: DATA, charts: [{ section: 'A' }, bars(), broken] }),
    (e) =>
      e instanceof ComposeError && e.diagnostics.length > 0 && e.diagnostics.every((d) => d.chart === 2 && d.path.startsWith('charts[2].')),
    'the path is the place in the list the author wrote',
  );
  for (const [charts, re] of [
    [[{ section: '' }, bars()], /section must be the text/],
    [[{ section: 5 }, bars()], /section must be the text/],
    [[{ section: 'A', spec: bars() }], /both "section" and "spec"/],
    [[{ section: 'A', span: 2 }, bars()], /not "span"/],
    [[{ section: 'A', note: 1 }, bars()], /note must be text/],
    [[{ section: 'A' }], /at least one chart/],
  ])
    assert.throws(
      () => compose({ data: DATA, charts }),
      (e) => e instanceof ComposeError && re.test(e.message),
      String(re),
    );
});

test('compose: lang sets the page, a section and a chart, and the language of their numbers', () => {
  const h = compose({
    data: DATA,
    lang: 'ko',
    charts: [
      bars(),
      { section: '石油', lang: 'zh-CN' },
      bars(),
      { spec: bars(), lang: 'ja' },
      { spec: { ...bars(), locale: 'de' } },
      { section: 'B' },
      bars(),
    ],
  }).html;
  assert(h.includes('<html lang="ko">'));
  assert(h.includes('<div class="bc-group" lang="zh-CN">'));
  assert.strictEqual([...h.matchAll(/<section class="bc-section" lang="zh-CN"/g)].length, 2, 'a section lasts until the next');
  assert.strictEqual([...h.matchAll(/<section class="bc-section" lang="ja"/g)].length, 1);
  const locales = [...h.matchAll(/data-bc-chart>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]).locale);
  assert.deepStrictEqual(locales, ['ko', 'zh-CN', 'ja', 'de', 'ko'], 'a locale the spec sets itself stays');
  assert(compose({ data: DATA, charts: [bars()] }).html.includes('<html lang="en">'), 'without one, as before');
  for (const lang of ['"><script>', 'k', 5, '']) {
    assert.throws(() => compose({ data: DATA, lang, charts: [bars()] }), /language tag/, String(lang));
    assert.throws(() => compose({ data: DATA, charts: [{ section: 'a', lang }, bars()] }), /language tag/, String(lang));
  }
});

test('compose: a facet reads what the blocks declare, so a scale, a legend and a filter of other names are faceted the same', () => {
  // the built blocks and four more, under names the composer has never seen, that hand everything to a block it has
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-facet-'));
  for (const f of ['core.js', 'blocks']) fs.cpSync(path.join(__dirname, '../dist', f), path.join(dir, f), { recursive: true });
  const like = (role, type, base, extra) =>
    fs.writeFileSync(
      path.join(dir, 'blocks', `${role}.${type}.js`),
      `"use strict";(function(){const b=()=>BC.get('${base}');BC.define({role:'${role}',type:'${type}',version:1,` +
        `requires:['${base}'],doc:'test',${extra}});})();`,
    );
  // channels take scales by what the scales declare, so the dot takes the scales of new names as a point would
  like(
    'mark',
    'dot',
    'mark.point',
    "channels:{x:{required:true,accepts:{output:'position'}},y:{required:true,accepts:{output:'position'}},color:{accepts:{output:'color'}}},params:{},render:(s,c,i)=>b().render(s,c,i)",
  );
  like('scale', 'hue', 'scale.color', "output:'color',input:'category',merge:'union',params:{},create:(s,c)=>b().create(s,c)");
  like('scale', 'tall', 'scale.linear', "output:'position',input:'number',params:{zero:{kind:'boolean'}},create:(s,c)=>b().create(s,c)");
  like('guide', 'key', 'guide.legend', 'shownOnce:true,params:{},measure:(s,c)=>b().measure(s,c),render:(s,c,o)=>b().render(s,c,o)');
  like(
    'interaction',
    'sieve',
    'interaction.legend-filter',
    "outerLegend:true,params:{scale:{kind:'scale'},legend:{kind:'string'}},attach:(s,l)=>b().attach(s,l)",
  );
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(buildManifest(dir)));
  const rows = [
    { r: 'North', m: 1, p: 'Tea', v: 10 },
    { r: 'North', m: 2, p: 'Tea', v: 20 },
    { r: 'South', m: 1, p: 'Tea', v: 500 },
    { r: 'South', m: 3, p: 'Coffee', v: 900 },
  ];
  const spec = {
    data: 'd',
    size: [300, 180],
    scales: { x: { type: 'linear' }, y: { type: 'tall', zero: true }, color: { type: 'hue' } },
    guides: [{ type: 'key', scale: 'color' }],
    marks: [{ type: 'dot', x: 'm', y: 'v', color: 'p' }],
    interaction: [{ type: 'sieve' }],
  };
  const page = compose({ data: { d: rows }, charts: [{ spec, facet: { field: 'r' } }], distDir: dir });
  assert.deepStrictEqual(page.diagnostics, []);
  const [north, south] = page.entries[0].panels.map((p) => p.spec);
  assert.deepStrictEqual(north.scales.color.domain, ['Tea', 'Coffee'], 'merge "union": the categories of every panel');
  assert.deepStrictEqual(north.scales.color, south.scales.color);
  assert.strictEqual(north.scales.y.domain, undefined, 'no merge declared: each panel keeps its own');
  assert.deepStrictEqual(north.guides, [], 'shownOnce: the key is drawn above the panels');
  assert.deepStrictEqual(
    page.entries[0].legend.map((l) => l.label),
    ['Tea', 'Coffee'],
  );
  assert.deepStrictEqual(north.interaction, [{ type: 'sieve', scale: 'color', legend: 'bc-facet-legend-0' }], 'outerLegend');
  fs.rmSync(dir, { recursive: true, force: true });

  // a size scale says it merges too, so a bubble of one size is one value in every panel (before, each panel had its own)
  const bubbles = {
    data: 'd',
    size: [300, 180],
    scales: { x: { type: 'linear' }, y: { type: 'linear' }, size: { type: 'size' } },
    marks: [{ type: 'point', x: 'm', y: 'v', size: 'v' }],
  };
  const sized = compose({ data: { d: rows }, charts: [{ spec: bubbles, facet: { field: 'r' } }] }).entries[0].panels;
  const [n, s] = sized.map((p) => p.spec.scales.size.domain);
  assert.deepStrictEqual(n, s);
  assert(n[0] <= 10 && n[1] >= 900, String(n));
});

test('compose: facet draws one chart per value on shared scales, with one legend', () => {
  const rows = [
    { r: 'North', m: '2024-01-01', p: 'Tea', v: 10 },
    { r: 'North', m: '2024-02-01', p: 'Tea', v: 20 },
    { r: 'South', m: '2024-01-01', p: 'Tea', v: 500 },
    { r: 'South', m: '2024-03-01', p: 'Coffee', v: 900 },
  ];
  const spec = () => ({
    data: 'd',
    size: [300, 180],
    scales: { x: { type: 'time' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
    guides: [
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y' },
      { type: 'legend', scale: 'color' },
    ],
    marks: [{ type: 'line', x: 'm', y: 'v', color: 'p' }],
    interaction: [{ type: 'tooltip' }, { type: 'legend-filter' }],
  });
  const specs = (html) => [...html.matchAll(/data-bc-chart>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
  const page = compose({ data: { d: rows }, charts: [{ title: 'T', spec: spec(), facet: { field: 'r', columns: 2 } }] });
  assert.deepStrictEqual(page.diagnostics, []);
  const [north, south] = specs(page.html);
  assert.deepStrictEqual(north.transforms[0], { type: 'filter', field: 'r', value: 'North' });
  assert.strictEqual(south.transforms[0].value, 'South');
  assert.deepStrictEqual(north.scales.y.domain, south.scales.y.domain, 'one y');
  assert(north.scales.y.domain[1] >= 900, 'it reaches the largest panel: ' + north.scales.y.domain);
  assert.deepStrictEqual(north.scales.x.domain, south.scales.x.domain, 'one x');
  assert.deepStrictEqual(north.scales.color.domain, ['Tea', 'Coffee'], 'one set of colors, Coffee has its place in North too');
  assert(page.html.includes('--bc-facet-cols:2') && page.html.includes('<h4>North</h4>'));
  assert.strictEqual([...page.html.matchAll(/<section class="bc-section"/g)].length, 1, 'one card');
  assert.strictEqual([...page.html.matchAll(/<div class="bc-facet-legend"/g)].length, 1, 'one legend');
  assert(
    north.guides.every((g) => g.type !== 'legend'),
    'not in the panels',
  );
  const filters = [north, south].map((s) => s.interaction.find((x) => x.type === 'legend-filter'));
  assert.deepStrictEqual(filters[0], { type: 'legend-filter', scale: 'color', legend: 'bc-facet-legend-0' }, 'every panel listens to it');
  assert.deepStrictEqual(filters[1], filters[0]);
  assert(page.html.includes('id="bc-facet-legend-0"') && page.html.includes('data-bc-legend-index="1" aria-pressed="true"'));
  assert(page.blocks.includes('transform.filter'), 'the filter is on the page');
  // entries say the same to a page of one's own: the panels as drawn, the legend once, a plain chart as it is
  const [shown] = page.entries;
  assert.deepStrictEqual(
    shown.panels.map((p) => p.label),
    ['North', 'South'],
  );
  assert.deepStrictEqual(
    shown.panels.map((p) => p.spec),
    [north, south],
    'the specs the page carries',
  );
  assert.deepStrictEqual(
    shown.legend.map((l) => l.label),
    ['Tea', 'Coffee'],
  );
  assert.strictEqual(shown.legendId, 'bc-facet-legend-0');
  assert.deepStrictEqual(shown.facet, { field: 'r', columns: 2 });
  const mixed = compose({
    data: { d: rows },
    charts: [
      { section: 'S', note: 'n' },
      { title: 'A', spec: spec() },
    ],
  }).entries;
  assert.deepStrictEqual(mixed[0], { section: 'S', note: 'n' });
  assert.deepStrictEqual(mixed[1], { title: 'A', note: undefined, spec: spec() });

  const free = specs(compose({ data: { d: rows }, charts: [{ spec: spec(), facet: { field: 'r', free: ['y'] } }] }).html);
  assert.strictEqual(free[0].scales.y.domain, undefined, 'a free scale keeps its own');
  // colors of its own in each panel: the legend says something different in each, so each panel keeps its legend
  const ownColors = compose({ data: { d: rows }, charts: [{ spec: spec(), facet: { field: 'r', free: ['color'] } }] }).html;
  assert(!ownColors.includes('class="bc-facet-legend"'), 'no legend above the panels');
  for (const s of specs(ownColors)) {
    assert(s.guides.some((g) => g.type === 'legend'));
    assert.deepStrictEqual(s.interaction[1], { type: 'legend-filter' }, 'each filters its own legend');
  }

  const given = spec();
  given.scales.y = { type: 'linear', domain: [0, 2000] };
  assert.deepStrictEqual(
    specs(compose({ data: { d: rows }, charts: [{ spec: given, facet: { field: 'r' } }] }).html)[1].scales.y,
    given.scales.y,
    'a scale with a domain of its own is left as it is',
  );

  // the panel's rows are filtered before the chart's own transforms run: a total that drops the field still works
  const summed = spec();
  summed.transforms = [{ type: 'aggregate', groupby: ['m'], measures: [{ op: 'sum', field: 'v', as: 'total' }] }];
  summed.scales.color = undefined;
  delete summed.scales.color;
  summed.guides = [{ type: 'axis', scale: 'y' }];
  summed.marks = [{ type: 'line', x: 'm', y: 'total' }];
  summed.interaction = [];
  const totals = specs(compose({ data: { d: rows }, charts: [{ spec: summed, facet: { field: 'r' } }] }).html);
  assert.strictEqual(totals[0].transforms[0].type, 'filter', 'the filter comes first');
  assert(totals[0].scales.y.domain[1] >= 900, 'totals within the panels: ' + totals[0].scales.y.domain);

  const some = specs(compose({ data: { d: rows }, charts: [{ spec: spec(), facet: { field: 'r', values: ['South'] } }] }).html);
  assert.strictEqual(some.length, 1, 'only what is asked for');

  const canvasless = compose({
    data: { d: [{ r: '</h4><script>', x: 'a', v: 1 }] },
    charts: [
      {
        spec: { data: 'd', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'x', y: 'v' }] },
        facet: { field: 'r' },
      },
    ],
  }).html;
  assert(!canvasless.includes('<h4></h4><script>'), 'a value is text, not markup');

  const broken = spec();
  broken.marks = [{ type: 'line', x: 'nope', y: 'v' }];
  assert.throws(
    () => compose({ data: { d: rows }, charts: [{ section: 'A' }, { spec: broken, facet: { field: 'r' } }] }),
    (e) => e instanceof ComposeError && e.diagnostics.length > 0 && e.diagnostics.every((d) => d.path.startsWith('charts[1].')),
    'errors point at the entry',
  );
  for (const [facet, re] of [
    ['r', /must be an object/],
    [{}, /"field" must name/],
    [{ field: 'nope' }, /not a column/],
    [{ field: 'r', columns: 7 }, /from 1 to 6/],
    [{ field: 'r', columns: 1.5 }, /from 1 to 6/],
    [{ field: 'r', values: ['Mars'] }, /not a value/],
    [{ field: 'r', values: [] }, /no values/],
    [{ field: 'r', values: 'North' }, /must be a list/],
    [{ field: 'r', free: 'y' }, /"free" must be a list/],
    [{ field: 'r', rows: 2 }, /"rows" is not known/],
  ])
    assert.throws(
      () => compose({ data: { d: rows }, charts: [{ spec: spec(), facet }] }),
      (e) => e instanceof ComposeError && re.test(e.message),
      String(re),
    );
  assert.throws(
    () => compose({ data: { d: rows }, charts: [{ spec: { ...spec(), id: 'a' }, facet: { field: 'r' } }] }),
    /cannot have an "id"/,
  );
  assert.throws(
    () => compose({ data: { d: rows }, charts: [{ spec: spec(), minWidth: 500, facet: { field: 'r' } }] }),
    /does not go with minWidth/,
  );
  const many = Array.from({ length: 40 }, (_, i) => ({ r: 'r' + i, m: '2024-01-01', p: 'T', v: 1 }));
  assert.throws(() => compose({ data: { d: many }, charts: [{ spec: spec(), facet: { field: 'r' } }] }), /too many/);
});

test('compose: minWidth keeps a chart wide inside a card that scrolls; bad values are refused', () => {
  const h = compose({ data: DATA, charts: [{ spec: bars(), minWidth: 560 }, bars()] }).html;
  assert(h.includes('<div class="bc-scroll"><div style="min-width:560px"><script type="application/json" data-bc-chart>'));
  assert.strictEqual([...h.matchAll(/class="bc-scroll"/g)].length, 1, 'only that chart');
  for (const minWidth of [0, -1, '560px', 1e9, NaN])
    assert.throws(() => compose({ data: DATA, charts: [{ spec: bars(), minWidth }] }), /minWidth must be a width/, String(minWidth));
});

test('compose: a page is readable without any CSS from the caller, and the caller can add to it or drop it', () => {
  const styles = (html) => html.match(/<style>[\s\S]*?<\/style>/g) || [];
  const base = compose({ data: DATA, charts: [bars()] });
  assert.strictEqual(styles(base.html).length, 1);
  assert(base.html.includes('--bc-c0:#3a6fe4') && base.html.includes('prefers-color-scheme:dark'), 'chart theme variables, light and dark');
  assert(base.html.includes('font:14px/1.5 Inter,ui-sans-serif,system-ui'), "typography: the reader's UI font, no web font to fetch");
  assert(base.html.includes('font-variant-numeric:tabular-nums'), 'figures line up');

  const extra = compose({ data: DATA, charts: [bars()], css: '.mine{color:red}' });
  assert.strictEqual(styles(extra.html).length, 1, 'still one <style>');
  assert(extra.html.indexOf('--bc-c0') < extra.html.indexOf('.mine{color:red}'), 'the caller css comes after the default, so it wins');

  assert.strictEqual(styles(compose({ data: DATA, charts: [bars()], defaultCss: false }).html).length, 0, 'no css at all');
  const only = compose({ data: DATA, charts: [bars()], defaultCss: false, css: '.mine{color:red}' });
  assert(only.html.includes('.mine{color:red}') && !only.html.includes('--bc-c0'), 'only the caller css');
  assert.strictEqual(
    compose({ data: DATA, charts: [bars()], css: '.x{}' }).html,
    compose({ data: DATA, charts: [bars()], css: '.x{}' }).html,
    'deterministic',
  );
});

// ── the dry run: every chart is built once before the page is written ──
const sequentialChart = (color) => ({
  data: 'pts',
  scales: { x: { type: 'linear' }, y: { type: 'linear' }, color },
  marks: [{ type: 'point', x: 'x', y: 'y', color: 'y' }],
});

test('compose dry run: a problem that only shows when a chart is drawn stops the page, with its chart and message', () => {
  // valid as a spec (validation cannot know these colors are unusable), a runtime error when the scale is built
  failsWith(
    () => compose({ data: DATA, charts: [bars(), sequentialChart({ type: 'sequential', range: ['red', 'blue'] })] }),
    /charts\[1\]\.scales\.color: scale\.sequential: range colors must be #rgb or #rrggbb/,
  );
  failsWith(
    () => compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', domain: [1, 1] })] }),
    /charts\[0\]\.scales\.color\.domain: the domain of scale "color" is \[from, to\]: two different numbers, not \[1,1\]/,
  );
  try {
    compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', range: ['red', 'blue'] })] });
    assert.fail('should throw');
  } catch (e) {
    assert(
      e.diagnostics.some((d) => d.level === 'error' && d.chart === 0),
      'the diagnostics say which chart',
    );
  }
  assert.doesNotThrow(
    () => compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', range: ['red', 'blue'] })], dryRun: false }),
    'dryRun: false skips it',
  );
  const r = compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', range: ['red', 'blue'] })], allowErrors: true });
  assert(
    r.diagnostics.some((d) => d.level === 'error'),
    'allowErrors ships the page and keeps the diagnostic',
  );
});

test('compose dry run: warnings are reported and do not stop the page', () => {
  const rows = Array.from({ length: 20000 }, (_, i) => ({ a: (i * 7919) % 20000, b: i % 17 }));
  const unsorted = {
    data: 'u',
    transforms: [{ type: 'decimate', x: 'a', y: 'b' }],
    scales: { x: { type: 'linear' }, y: { type: 'linear' } },
    marks: [{ type: 'line', x: 'a', y: 'b' }],
  };
  const r = compose({ data: { u: rows }, charts: [unsorted] });
  const warn = r.diagnostics.find((d) => d.level === 'warn' && d.path === 'charts[0].transforms[0]');
  assert(warn && /not sorted by "a".*sort the data by "a" first/.test(warn.message), JSON.stringify(r.diagnostics));
  assert(r.html.startsWith('<!doctype html>'), 'the page is still produced');
  const sorted = compose({ data: { u: rows.slice().sort((p, q) => p.a - q.a) }, charts: [unsorted] });
  assert.deepStrictEqual(sorted.diagnostics, [], 'sorted data: silence');

  const orphan = { ...scatter(), guides: [], interaction: [{ type: 'legend-filter' }] };
  const o = compose({ data: DATA, charts: [orphan] });
  assert(
    o.diagnostics.some(
      (d) => d.level === 'warn' && d.path === 'charts[0]' && /legend-filter: needs a categorical color scale/.test(d.message),
    ),
    'what an interaction says to the console is a warning too: ' + JSON.stringify(o.diagnostics),
  );

  const oneUnknown = { ...bars(), marks: [{ type: 'rect', x: 'k', y: 'v', shade: 'red' }] };
  const u = compose({ data: DATA, charts: [oneUnknown] });
  assert.strictEqual(
    u.diagnostics.filter((d) => /unknown parameter "shade"/.test(d.message)).length,
    1,
    'said once, not by validation and again by the dry run',
  );
});

test('compose dry run: a good page says nothing, leaves no trace, and stays fast on big data', () => {
  assert.deepStrictEqual(compose({ data: DATA, charts: [bars(), scatter()] }).diagnostics, []);
  const big = Array.from({ length: 100000 }, (_, i) => ({ a: i, b: Math.sin(i / 100) * 10 }));
  const t0 = Date.now();
  const r = compose({
    data: { big },
    charts: [
      {
        data: 'big',
        transforms: [{ type: 'decimate', x: 'a', y: 'b' }],
        scales: { x: { type: 'linear' }, y: { type: 'linear' } },
        marks: [{ type: 'line', x: 'a', y: 'b' }],
        interaction: [{ type: 'zoom' }, { type: 'tooltip' }],
      },
    ],
  });
  assert.deepStrictEqual(r.diagnostics, []);
  assert(Date.now() - t0 < 8000, `100000 rows composed in ${Date.now() - t0} ms`);
  const spec = {
    data: 'big',
    transforms: [{ type: 'decimate', x: 'a', y: 'b' }],
    scales: { x: { type: 'linear' }, y: { type: 'linear' } },
    marks: [{ type: 'line', x: 'a', y: 'b' }],
    interaction: [{ type: 'zoom' }, { type: 'tooltip' }],
  };
  assert.strictEqual(
    compose({ data: { big }, charts: [spec], dryRun: false }).html,
    r.html,
    'the trial run leaves nothing in the page: byte for byte the same as without it',
  );
});

test('compose: binary columns are checked and drawn like any dataset, and stored as they came', async () => {
  const { encodeColumns } = require('./encode-columns.js');
  const { runPage } = require('./run-page.js');
  const cols = { a: Array.from({ length: 50 }, (_, i) => i), b: Array.from({ length: 50 }, (_, i) => (i * 7) % 13) };
  const page = {
    data: { d: encodeColumns(cols) },
    charts: [{ data: 'd', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] }],
  };
  const r = compose(page);
  assert.deepStrictEqual(r.diagnostics, []);
  assert.deepStrictEqual(r.compressed, [], 'already encoded: not compressed again');
  assert(r.html.includes(page.data.d.columns.a.data), 'the stored bytes are the ones given');
  const { handles } = runPage(r.html);
  await handles[0].ready;
  assert.strictEqual(handles[0].diagnostics.length, 0);
  assert.strictEqual(handles[0].host.children[0].tag, 'svg');

  const wrong = (columns, re) =>
    assert.throws(
      () => compose({ data: { d: { columns } }, charts: page.charts }),
      (e) => e instanceof ComposeError && re.test(e.message),
    );
  const good = encodeColumns({ a: [1, 2, 3] }).columns.a;
  wrong({ a: good, b: { dtype: 'float16', encoding: 'base64', data: '' } }, /data "d": column "b": unknown dtype "float16"/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'zip', data: '' } }, /column "b": unknown encoding "zip"/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'base64' } }, /column "b": a binary column needs a "data" string/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'gzip+base64', data: Buffer.from('nope').toString('base64') } }, /column "b":/);
  wrong(
    { a: good, b: { dtype: 'float64', encoding: 'base64', data: Buffer.from([1, 2, 3]).toString('base64') } },
    /column "b": 3 bytes is not a whole number of float64 values/,
  );
});

test('compose: pages carry the minified code by default, and draw what the readable code draws', async () => {
  const { runPage } = require('./run-page.js');
  const page = { data: DATA, charts: [bars()] };
  const small = compose(page);
  const big = compose({ ...page, distDir: path.join(__dirname, '../dist') });
  assert.deepStrictEqual(small.blocks, big.blocks);
  assert(small.bytes < big.bytes * 0.6, `${small.bytes} vs ${big.bytes}`);
  assert(!/\bdoc:/.test(small.html) && /\bdoc:/.test(big.html), 'the parameter docs stay out of the page');
  const a = runPage(small.html),
    b = runPage(big.html);
  await Promise.all([a.handles[0].ready, b.handles[0].ready]);
  assert.deepStrictEqual(Array.from(a.handles[0].diagnostics), []);
  assert.strictEqual(a.handles[0].host.children[0].serialize(), b.handles[0].host.children[0].serialize());
});

test('minify: dist/min mirrors dist with the sizes of its own files, and it never writes where it must not', () => {
  const { buildMin, MinifyError } = require('./minify.js');
  const dist = path.join(__dirname, '../dist');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-min-'));
  const m = buildMin(dist, path.join(out, 'min'));
  const raw = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(m.blocks), Object.keys(raw.blocks));
  for (const [name, b] of Object.entries(m.blocks)) {
    assert.strictEqual(b.bytes, fs.statSync(path.join(out, 'min', b.file)).size, name);
    assert(b.bytes < raw.blocks[name].bytes, name + ' is smaller');
    assert.deepStrictEqual(b.closure, raw.blocks[name].closure);
    assert.deepStrictEqual(
      b.params && Object.keys(b.params),
      raw.blocks[name].params && Object.keys(raw.blocks[name].params),
      'the manifest keeps its docs and parameters',
    );
  }
  assert.strictEqual(m.core.bytes, fs.statSync(path.join(out, 'min', 'core.js')).size);
  for (const bad of [dist, path.parse(dist).root, path.join(dist, '..')])
    assert.throws(
      () => buildMin(dist, bad),
      (e) => e instanceof MinifyError && /refusing/.test(e.message),
      bad,
    );
  assert.throws(() => buildMin(path.join(os.tmpdir(), 'no-dist'), path.join(out, 'x')), /manifest\.json not found/);
});

test('compose: a chart on the canvas renderer is checked, drawn once in the sandbox and inlined with its renderer', async () => {
  const { runPage } = require('./run-page.js');
  const r = compose({ data: DATA, charts: [{ ...bars(), renderer: 'canvas' }] });
  assert.deepStrictEqual(r.diagnostics, []);
  assert(r.blocks.includes('renderer.canvas') && !r.blocks.includes('renderer.svg'));
  const { handles } = runPage(r.html);
  await handles[0].ready;
  assert.strictEqual(handles[0].diagnostics.length, 0);
  assert.strictEqual(handles[0].host.children[0].tag, 'canvas');
});

test('compose: a chart that never finishes drawing in the trial run is a spec error, not a hung composer', () => {
  // the real blocks plus one whose render never returns
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-hang-'));
  const src = path.join(__dirname, '../dist');
  fs.mkdirSync(path.join(dir, 'blocks'));
  fs.copyFileSync(path.join(src, 'core.js'), path.join(dir, 'core.js'));
  for (const f of fs.readdirSync(path.join(src, 'blocks'))) fs.copyFileSync(path.join(src, 'blocks', f), path.join(dir, 'blocks', f));
  fs.writeFileSync(
    path.join(dir, 'blocks', 'mark.hang.js'),
    `"use strict";\n(function () { BC.define({ role: 'mark', type: 'hang', version: 1, channels: {}, render() { for (;;) {} } }); })();\n`,
  );
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(buildManifest(dir)));
  const started = Date.now();
  const spec = { ...bars(), marks: [{ type: 'hang' }] };
  failsWith(() => compose({ data: DATA, charts: [bars(), spec], distDir: dir, drawTimeout: 300 }), /charts\[1\].*did not finish drawing/);
  assert(Date.now() - started < 10000, 'it gives up instead of waiting forever');
});

test('compose: a report fetches nothing — its CSP refuses every request, and css or a color that would fetch is an error', () => {
  const html = compose({ data: DATA, charts: [bars()] }).html;
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(
    head,
    /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">/,
  );
  assert(head.indexOf('Content-Security-Policy') < head.indexOf('<style'), 'the policy comes before anything it governs');
  assert.match(head, /<link rel="icon" href="data:,">/, 'no request for /favicon.ico either');

  for (const css of [
    '@import "theme.css";',
    'body { background: url(http://127.0.0.1:9/bg.png) }',
    "h1 { background: URL( 'https://x.test/a.svg' ) }",
  ])
    failsWith(() => compose({ data: DATA, charts: [bars()], css }), /css: a report loads nothing from the network/);
  assert(compose({ data: DATA, charts: [bars()], css: 'h1 { background: url("data:image/svg+xml,%3Csvg%3E") }' }).html);
  failsWith(() => compose({ data: DATA, charts: [bars()], css: { body: 1 } }), /css must be the text of a stylesheet/);

  // the swatches of a facet's legend are written into a style attribute: their colors are checked like any range
  const facet = (range) => ({
    spec: {
      data: 'cats',
      size: [300, 180],
      scales: { x: { type: 'band' }, y: { type: 'linear' }, color: { type: 'color', range } },
      marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
      guides: [{ type: 'legend', scale: 'color' }],
    },
    facet: { field: 'k' },
  });
  failsWith(
    () => compose({ data: DATA, charts: [facet(['red;background-image:url(http://127.0.0.1:9/leak)'])] }),
    /charts\[0\]\.scales\.color\.range\[0\]: .* is not a color/,
  );
});

test('compose: a misspelled or misplaced key anywhere in a page is an error that says what was meant', () => {
  const page = { data: DATA, charts: [bars()] };
  failsWith(() => compose({ ...page, charts: [{ spec: bars(), notes: 'x' }] }), /charts\[0\]: unknown key "notes"; did you mean "note"\?/);
  failsWith(() => compose({ ...page, charts: [{ spec: bars(), titel: 'x' }] }), /charts\[0\]: unknown key "titel"; did you mean "title"\?/);
  failsWith(() => compose({ ...page, layout: { colums: 2 } }), /layout: unknown key "colums"; did you mean "columns"\?/);
  // what goes next to the spec, written inside it, would be dropped by the chart
  for (const [key, value] of [
    ['facet', { field: 'k' }],
    ['span', 1],
    ['minWidth', 500],
    ['note', 'x'],
    ['lang', 'de'],
  ])
    failsWith(
      () => compose({ ...page, charts: [{ spec: { ...bars(), [key]: value } }] }),
      new RegExp(`charts\\[0\\]\\.spec\\.${key}: "${key}" goes next to "spec" in the chart entry, not inside it`),
    );
  failsWith(
    () => compose({ ...page, data: { cats: { csv: 'k;v\na;1', delimeter: ';' } } }),
    /data "cats": unknown key "delimeter"; did you mean "delimiter"\?/,
  );
  failsWith(
    () => compose({ ...page, data: { cats: { csv: 'k,v\na,1', nullValues: 'n/a' } } }),
    /data "cats": "nullValues" must be a list of texts, like \["n\/a", "-"\]/,
  );
  failsWith(
    () => compose({ ...page, data: { cats: { csv: 'k,zip\na,1', types: { Zip: 'string' } } } }),
    /data "cats": "types" names "Zip", which is not a column; the header has "k", "zip"/,
  );
  failsWith(
    () => compose({ ...page, charts: [{ ...bars(), marks: [{ type: 'rec', x: 'k', y: 'v' }] }] }),
    /no such block: mark\.rec \(did you mean mark\.rect\?\)/,
  );
  // a key of the spec itself is the core's: a warning that names the key it looks like, and the page is written
  const r = compose({ ...page, charts: [{ ...bars(), interactions: [{ type: 'tooltip' }] }] });
  assert.deepStrictEqual(
    r.diagnostics.map((d) => [d.level, d.path, d.message]),
    [['warn', 'charts[0].interactions', 'unknown key "interactions"; did you mean "interaction"?']],
  );
});

test('compose command line: a page.json is a page — it cannot run code, write a page with errors, or misspell a key', () => {
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-cli-'));
  const run = (page, raw) => {
    const file = path.join(dir, 'page.json');
    fs.writeFileSync(file, raw !== undefined ? raw : JSON.stringify(page));
    fs.rmSync(path.join(dir, 'out.html'), { force: true });
    const r = spawnSync(process.execPath, [path.join(__dirname, 'compose.js'), file, path.join(dir, 'out.html')], { encoding: 'utf8' });
    return { ...r, written: fs.existsSync(path.join(dir, 'out.html')) };
  };
  const page = { title: 'CLI', data: DATA, charts: [bars()] };

  // a folder of "code" next to the page: the composer would run its core.js in a vm, which is no sandbox
  const lib = path.join(dir, 'lib');
  fs.mkdirSync(lib);
  const proof = path.join(dir, 'ran.txt');
  fs.writeFileSync(
    path.join(lib, 'core.js'),
    `this.constructor.constructor('return process')().mainModule.require('fs').writeFileSync(${JSON.stringify(proof)}, 'ran');`,
  );
  fs.writeFileSync(path.join(lib, 'manifest.json'), JSON.stringify({ core: { file: 'core.js' }, blocks: {} }));
  const code = run({ ...page, distDir: lib });
  assert.strictEqual(code.status, 1);
  assert.match(code.stderr, /"distDir" is an option for a program that calls compose\(\), not a key of a page/);
  assert(!fs.existsSync(proof), 'the code next to the page did not run');
  assert(!code.written);

  for (const key of ['allowErrors', 'after', 'before', 'include', 'dryRun', 'drawTimeout', 'baseDir']) {
    const r = run({ ...page, [key]: true });
    assert.strictEqual(r.status, 1, key);
    assert.match(r.stderr, new RegExp(`"${key}" is an option for a program`), key);
  }
  // so a chart with an error still stops the page
  const broken = run({ ...page, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }], allowErrors: true });
  assert(!broken.written);

  const typo = run({ ...page, subtitel: 'Q3' });
  assert.strictEqual(typo.status, 1);
  assert.match(typo.stderr, /page\.json: unknown key "subtitel"; did you mean "subtitle"\?/);
  assert.match(run({ ...page, CSS: 'body{}' }).stderr, /unknown key "CSS"; did you mean "css"\?/);
  assert.match(run({ ...page, theme: 'dark' }).stderr, /unknown key "theme"\. It takes "title", "subtitle"/);
  failsWith(() => compose({ ...page, chart: [] }), /compose\(\): unknown key "chart"; did you mean "charts"\?/);
  // raw HTML is the API's too
  const html = run({ ...page, charts: [{ spec: bars(), noteHtml: '<img src=x onerror=alert(1)>' }] });
  assert.strictEqual(html.status, 1);
  assert.match(html.stderr, /charts\[0\]\.noteHtml is raw HTML, which only a program that calls compose\(\) may put on a page/);

  // what Windows PowerShell 5.1 writes (Set-Content / Out-File -Encoding utf8): a byte order mark first
  const bom = run(null, '﻿' + JSON.stringify(page));
  assert.strictEqual(bom.status, 0, bom.stderr);
  assert(bom.written);
  const bad = run(null, '{ "title": "x", }');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /page\.json is not valid JSON/);
  assert.match(run(null, '[1, 2]').stderr, /must hold one object/);
});

(async () => {
  for (const [name, fn] of queue) {
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
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
