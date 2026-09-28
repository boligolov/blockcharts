// Tests for the manifest builder and the page composer. Run: npm test  (or node scripts/test-compose.js after a build)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');
const { buildManifest } = require('./build-manifest.js');
const { compose, ComposeError } = require('./compose.js');

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// ── manifest, on synthetic dist folders ──
const CORE = "(function(){ const VERSION = '9.9.9'; })();";
const block = (role, type, extra) => `"use strict";\n(function () { BC.define({ role: '${role}', type: '${type}', version: 1${extra || ''} }); })();\n`;

function fixture(files, core) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-manifest-'));
  fs.mkdirSync(path.join(dir, 'blocks'));
  fs.writeFileSync(path.join(dir, 'core.js'), core === undefined ? CORE : core);
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'blocks', name), src);
  return dir;
}
const problems = (files, core) => {
  try { buildManifest(fixture(files, core)); } catch (e) { return e.message; }
  return null;
};

test('manifest: closure is transitive, includes the block itself, ordered by role', () => {
  const m = buildManifest(fixture({
    'mark.m.js': block('mark', 'm', ", requires: ['scale.s'], channels: { x: { required: true } }, params: { p: { kind: 'number' } }, doc: 'd'"),
    'scale.s.js': block('scale', 's', ", requires: ['transform.t']"),
    'transform.t.js': block('transform', 't'),
    'guide.g.js': block('guide', 'g'),
  }));
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
  const m = buildManifest(fixture({
    'mark.top.js': block('mark', 'top', ", requires: ['scale.a', 'scale.b']"),
    'scale.a.js': block('scale', 'a', ", requires: ['scale.base']"),
    'scale.b.js': block('scale', 'b', ", requires: ['scale.base']"),
    'scale.base.js': block('scale', 'base'),
  }));
  assert.deepStrictEqual(m.blocks['mark.top'].closure, ['scale.a', 'scale.b', 'scale.base', 'mark.top']);
});

test('manifest: every kind of broken input is a clear error, all reported together', () => {
  assert.match(problems({ 'scale.a.js': block('scale', 'a', ", requires: ['scale.b']"), 'scale.b.js': block('scale', 'b', ", requires: ['scale.a']") }), /dependency cycle: scale\.a -> scale\.b -> scale\.a/);
  assert.match(problems({ 'mark.m.js': block('mark', 'm', ", requires: ['scale.ghost']") }), /mark\.m requires scale\.ghost, which no block file provides/);
  assert.match(problems({ 'mark.other.js': block('mark', 'm') }), /mark\.other\.js defines mark\.m; the file must be named mark\.m\.js/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"mark",type:"m",version:1});BC.define({role:"mark",type:"n",version:1});' }), /exactly once \(it called it 2 times\)/);
  assert.match(problems({ 'mark.m.js': '/* nothing */' }), /exactly once \(it called it 0 times\)/);
  assert.match(problems({ 'mark.m.js': block('mark', 'm', ", note: '</script><script>alert(1)'") }), /contains "<\/script"/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"mark",type:"m",version:1}); // <!-- oops' }), /contains "<\/script" or "<!--"/);
  assert.match(problems({ 'mark.m.js': 'this is not javascript (' }), /failed to run against the stub BC/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"widget",type:"m",version:1});' }), /invalid role\/type/);
  assert.match(problems({ 'mark.m.js': 'BC.define({role:"mark",type:"m",version:0});' }), /version must be a positive integer/);
  assert.match(problems({ 'mark.m.js': 'while(true){}' }), /failed to run/, 'a block that never returns is cut off');
  assert.match(problems({ 'mark.m.js': block('mark', 'm') }, '// no version'), /cannot find `const VERSION/);
  assert.match(problems({}, '/* </script> */ const VERSION = "x";'), /core\.js/);
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
    assert(e.requires.every((r) => m.blocks[r]), `${name}: requires exist`);
    assert.strictEqual(e.file, `blocks/${name}.js`);
    assert.strictEqual(e.bytes, fs.statSync(path.join(__dirname, '../dist', e.file)).size, `${name}: bytes match the file`);
  }
  assert.deepStrictEqual(m, JSON.parse(JSON.stringify(buildManifest(path.join(__dirname, '../dist')))), 'manifest.json is up to date with the blocks');
});

// ── composer, on the real blocks ──
const DATA = { cats: [{ k: 'a', v: 3 }, { k: 'b', v: 6 }], pts: [{ x: 1, y: 2, g: 'A' }, { x: 2, y: 3, g: 'B' }] };
const bars = () => ({
  data: 'cats',
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
  marks: [{ type: 'rect', x: 'k', y: 'v' }],
});
const scatter = () => ({
  data: 'pts',
  scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'color' } },
  guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, { type: 'legend', scale: 'color' }],
  marks: [{ type: 'point', x: 'x', y: 'y', color: 'g' }],
  interaction: [{ type: 'tooltip' }],
});
const failsWith = (fn, re) => assert.throws(fn, (e) => e instanceof ComposeError && re.test(e.message), `expected ComposeError ${re}`);

test('compose: only the blocks the charts need are inlined, in a fixed order', () => {
  const r = compose({ data: DATA, charts: [bars()] });
  assert.deepStrictEqual(r.blocks, ['scale.band', 'scale.linear', 'mark.rect', 'guide.axis', 'renderer.svg']);
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/manifest.json'), 'utf8'));
  const everything = Object.values(m.blocks).reduce((n, b) => n + b.bytes, m.core.bytes);
  assert(r.bytes < everything * 0.7, `${r.bytes} vs ${everything}`);
  assert(!r.html.includes('mark.line') && !r.html.includes("type: 'zoom'"), 'no unused block code');
  const two = compose({ data: DATA, charts: [bars(), scatter()] });
  assert.deepStrictEqual(two.blocks, ['scale.band', 'scale.color', 'scale.linear', 'mark.point', 'mark.rect', 'guide.axis', 'guide.legend', 'interaction.tooltip', 'renderer.svg'], 'union over both charts');
  assert.strictEqual(compose({ data: DATA, charts: [bars()], include: ['mark.line', 'interaction.zoom'] }).blocks.includes('interaction.zoom'), true, 'include adds blocks for hand-written scripts');
});

test('compose: the same input gives byte-identical output', () => {
  const a = compose({ title: 'T', data: DATA, charts: [bars(), scatter()], css: 'body{margin:0}' });
  const b = compose({ title: 'T', data: DATA, charts: [scatter(), bars()].reverse(), css: 'body{margin:0}' });
  assert.strictEqual(a.html, b.html);
});

test('compose: nothing in data, specs, titles or css can break out of its tag', () => {
  const evil = '</script><script>alert(1)</script><!--   & "quoted" ';
  const data = { cats: [{ k: evil, v: 3 }, { k: 'b', v: 6 }] };
  const spec = { ...bars(), title: evil };
  const r = compose({ title: evil, data, charts: [{ spec, title: evil, note: evil, noteHtml: '<code>ok</code>' }], css: '</style><script>alert(2)</script>', before: '<!-- mine -->' });
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
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'hexbin', x: 'k', y: 'v' }] }] }), /no such block: mark\.hexbin\. Available: .*mark\.rect/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), renderer: 'webgl' }] }), /no such block: renderer\.webgl/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }] }), /charts\[0\]\.marks\[0\]\.y: unknown field "ghost"/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), data: 'nope' }] }), /dataset "nope" is not in the data lake/);
  failsWith(() => compose({ data: DATA, charts: [bars(), { ...scatter(), scales: { x: { type: 'linear' } } }] }), /charts\[1\]/);
  failsWith(() => compose({ data: { cats: 5 }, charts: [bars()] }), /data "cats": .*array of rows/);
  failsWith(() => compose({ data: [], charts: [bars()] }), /data must be an object/);
  failsWith(() => compose({ data: DATA, charts: [] }), /non-empty array/);
  failsWith(() => compose({ data: DATA }), /non-empty array/);
  failsWith(() => compose({ data: DATA, charts: [null] }), /charts\[0\] is not a chart spec/);
  failsWith(() => compose({ data: DATA, charts: [bars()], distDir: path.join(os.tmpdir(), 'bc-nowhere') }), /manifest\.json not found/);
  try { compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }] }); assert.fail('should throw'); }
  catch (e) { assert(e.diagnostics.some((d) => d.level === 'error' && d.path === 'charts[0].marks[0].y'), 'diagnostics are attached'); }
  assert.doesNotThrow(() => compose({ data: DATA, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'ghost' }] }], allowErrors: true }), 'allowErrors ships the page anyway');
});

test('compose: warnings do not stop the page, unused data is reported', () => {
  const r = compose({ data: { ...DATA, spare: [{ a: 1 }] }, charts: [{ ...bars(), marks: [{ type: 'rect', x: 'k', y: 'v', shade: 'red' }] }] });
  assert(r.diagnostics.some((d) => d.level === 'warn' && d.path === 'charts[0].marks[0].shade'));
  assert.deepStrictEqual(r.unusedData.sort(), ['pts', 'spare']);
});

const { runPage, countTags } = require('./run-page.js');

test('compose: the produced page mounts and draws when its scripts run', () => {
  const r = compose({ title: 'Run', data: DATA, charts: [{ spec: bars(), title: 'Bars' }, scatter()] });
  const { handles, body } = runPage(r.html);
  assert.strictEqual(handles.length, 2);
  assert(handles.every((h) => h.diagnostics.length === 0), JSON.stringify(handles.map((h) => h.diagnostics)));
  assert.strictEqual(countTags(handles[0].host.children[0], 'rect'), 2, 'two bars');
  assert.strictEqual(countTags(handles[1].host.children[0], 'circle'), 2);
  assert.strictEqual(body.children.filter((c) => c.className === 'bc-chart').length, 2, 'a host div was inserted for each chart');
});

// ── compression ──
const BIG = Array.from({ length: 400 }, (_, i) => ({ a: i, b: Math.round(Math.sin(i / 7) * 1000), name: 'series ' + (i % 5) }));
const bigSpec = () => ({ data: 'big', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] });
const storedData = (html) => JSON.parse(html.match(/<script type="application\/json" id="bc-data">(.*?)<\/script>/s)[1]);

test('compose: big datasets are stored as base64(gzip), small ones stay readable, and it is optional', () => {
  const r = compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()] });
  assert.deepStrictEqual(r.compressed, ['big']);
  const stored = storedData(r.html);
  assert.deepStrictEqual(stored.cats, DATA.cats, 'a small dataset is untouched');
  assert.deepStrictEqual(Object.keys(stored.big), ['encoding', 'data']);
  assert.strictEqual(stored.big.encoding, 'gzip+base64');
  assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(Buffer.from(stored.big.data, 'base64')).toString('utf8')), BIG, 'exactly the original rows');
  const plainPage = compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()], compress: false });
  assert(r.html.length < plainPage.html.length - 10000, 'the page is much smaller');
  assert.deepStrictEqual(plainPage.compressed, []);
  assert.deepStrictEqual(compose({ data: DATA, charts: [bars()], compress: true }).compressed, ['cats', 'pts'], 'true = everything');
  assert.strictEqual(compose({ data: { ...DATA, big: BIG }, charts: [bars(), bigSpec()] }).html, r.html, 'deterministic');
  failsWith(() => compose({ data: DATA, charts: [bars()], compress: 'yes' }), /compress must be/);
});

test('compose: "auto" leaves data that does not compress well alone', () => {
  let seed = 1;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const noise = Array.from({ length: 300 }, () => ({ k: Array.from({ length: 40 }, () => alphabet[(seed = (seed * 16807) % 2147483647) % 64]).join('') }));
  const r = compose({ data: { noise }, charts: [{ data: 'noise', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'k', y: 'k' }] }], allowErrors: true });
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
  failsWith(() => compose({ data: { big: wrapped }, charts: [{ ...bigSpec(), marks: [{ type: 'point', x: 'a', y: 'nope' }] }] }), /unknown field "nope"/);
  failsWith(() => compose({ data: { big: { encoding: 'gzip+base64', data: 'not gzip' } }, charts: [bigSpec()] }), /data "big":/);
  failsWith(() => compose({ data: { big: { encoding: 'rot13', data: 'x' } }, charts: [bigSpec()] }), /data "big": unknown encoding "rot13"/);
  failsWith(() => compose({ data: { big: { encoding: 'base64' } }, charts: [bigSpec()] }), /needs a "data" string/);
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

// ── functions and other things JSON cannot carry ──
test('compose: a function (or anything else JSON would drop or change) in a spec is refused with its path', () => {
  const withFn = { ...scatter(), interaction: [{ type: 'tooltip' }, { type: 'tooltip', content: (d) => d.row }] };
  failsWith(() => compose({ data: DATA, charts: [bars(), withFn] }), /^charts\[1\]\.interaction\[1\]\.content is a function; a JSON spec cannot carry code\. Register it with BC\.defineFn/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), title: NaN }] }), /charts\[0\]\.title is NaN, which JSON turns into null/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), size: [640, Infinity] }] }), /charts\[0\]\.size\[1\] is Infinity/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), title: Symbol('x') }] }), /is a symbol/);
  failsWith(() => compose({ data: DATA, charts: [{ ...bars(), title: 10n }] }), /is a bigint/);
  const loop = bars();
  loop.self = loop;
  failsWith(() => compose({ data: DATA, charts: [loop] }), /charts\[0\]\.self is a circular reference/);
  assert.doesNotThrow(() => compose({ data: DATA, charts: [{ ...bars(), title: undefined }] }), 'undefined properties are simply dropped, as JSON does');
  const shared = { type: 'axis', scale: 'x' };
  assert.doesNotThrow(() => compose({ data: DATA, charts: [{ ...bars(), guides: [shared, shared] }] }), 'the same object twice is not a cycle');
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

test('compose: a dashboard grid — columns, spans, a heading and a subtitle; bad layouts are refused', () => {
  const page = compose({
    title: 'Q3 <review>', subtitle: 'Sales & margin',
    layout: { columns: 4 },
    data: DATA,
    charts: [{ spec: bars(), span: 1 }, { spec: bars(), span: 3, title: 'Wide' }, bars()],
  });
  const h = page.html;
  assert(h.includes('<main class="bc-page bc-wide">') && h.includes('<div class="bc-grid" style="--bc-cols:4">'), 'a wide page with a 4-column grid');
  assert(h.includes('<h1>Q3 &lt;review&gt;</h1><p>Sales &amp; margin</p>'), 'the heading and subtitle, escaped');
  const spans = [...h.matchAll(/<section class="bc-section" style="grid-column:span (\d+)">/g)].map((m) => +m[1]);
  assert.deepStrictEqual(spans, [1, 3, 4], 'spans as given; a chart without one takes the full row');
  assert(h.indexOf('<h1>') < h.indexOf('<div class="bc-grid"'), 'the heading comes before the grid');

  const single = compose({ data: DATA, charts: [bars()] }).html;
  assert(single.includes('<main class="bc-page">') && !single.includes('style="--bc-cols') && !single.includes('style="grid-column'), 'one column: a narrow page, cards without spans');
  assert(single.includes('<section class="bc-section">'), 'even a chart with no title sits in a card');
  assert(!single.includes('<header'), 'no heading without a title');

  for (const [layout, re] of [[{ columns: 0 }, /layout.columns/], [{ columns: 13 }, /layout.columns/], [{ columns: 2.5 }, /layout.columns/], [[], /layout must be an object/], ['4', /layout must be an object/]]) {
    assert.throws(() => compose({ data: DATA, charts: [bars()], layout }), (e) => e instanceof ComposeError && re.test(e.message), JSON.stringify(layout));
  }
  for (const span of [0, 5, 1.5, '2']) {
    assert.throws(() => compose({ data: DATA, charts: [{ spec: bars(), span }], layout: { columns: 4 } }), (e) => e instanceof ComposeError && /charts\[0\]\.span/.test(e.message), String(span));
  }
  assert.throws(() => compose({ data: DATA, charts: [{ spec: bars(), span: 2 }] }), /from 1 to 1/, 'a span needs a grid to span');
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
  assert.strictEqual(compose({ data: DATA, charts: [bars()], css: '.x{}' }).html, compose({ data: DATA, charts: [bars()], css: '.x{}' }).html, 'deterministic');
});

// ── the dry run: every chart is built once before the page is written ──
const sequentialChart = (color) => ({
  data: 'pts',
  scales: { x: { type: 'linear' }, y: { type: 'linear' }, color },
  marks: [{ type: 'point', x: 'x', y: 'y', color: 'y' }],
});

test('compose dry run: a problem that only shows when a chart is drawn stops the page, with its chart and message', () => {
  // valid as a spec (validation cannot know these colors are unusable), a runtime error when the scale is built
  failsWith(() => compose({ data: DATA, charts: [bars(), sequentialChart({ type: 'sequential', range: ['red', 'blue'] })] }), /charts\[1\]: scale\.sequential: range colors must be #rgb or #rrggbb/);
  failsWith(() => compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', domain: [1, 1] })] }), /domain must be \[min, max\]/);
  try { compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', range: ['red', 'blue'] })] }); assert.fail('should throw'); }
  catch (e) { assert(e.diagnostics.some((d) => d.level === 'error' && d.chart === 0), 'the diagnostics say which chart'); }
  assert.doesNotThrow(() => compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', range: ['red', 'blue'] })], dryRun: false }), 'dryRun: false skips it');
  const r = compose({ data: DATA, charts: [sequentialChart({ type: 'sequential', range: ['red', 'blue'] })], allowErrors: true });
  assert(r.diagnostics.some((d) => d.level === 'error'), 'allowErrors ships the page and keeps the diagnostic');
});

test('compose dry run: warnings are reported and do not stop the page', () => {
  const rows = Array.from({ length: 20000 }, (_, i) => ({ a: (i * 7919) % 20000, b: i % 17 }));
  const unsorted = { data: 'u', transforms: [{ type: 'decimate', x: 'a', y: 'b' }], scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'a', y: 'b' }] };
  const r = compose({ data: { u: rows }, charts: [unsorted] });
  const warn = r.diagnostics.find((d) => d.level === 'warn' && d.path === 'charts[0].transforms[0]');
  assert(warn && /not sorted by "a".*sort the data by "a" first/.test(warn.message), JSON.stringify(r.diagnostics));
  assert(r.html.startsWith('<!doctype html>'), 'the page is still produced');
  const sorted = compose({ data: { u: rows.slice().sort((p, q) => p.a - q.a) }, charts: [unsorted] });
  assert.deepStrictEqual(sorted.diagnostics, [], 'sorted data: silence');

  const orphan = { ...scatter(), guides: [], interaction: [{ type: 'legend-filter' }] };
  const o = compose({ data: DATA, charts: [orphan] });
  assert(o.diagnostics.some((d) => d.level === 'warn' && d.path === 'charts[0]' && /legend-filter: needs a categorical color scale/.test(d.message)), 'what an interaction says to the console is a warning too: ' + JSON.stringify(o.diagnostics));

  const oneUnknown = { ...bars(), marks: [{ type: 'rect', x: 'k', y: 'v', shade: 'red' }] };
  const u = compose({ data: DATA, charts: [oneUnknown] });
  assert.strictEqual(u.diagnostics.filter((d) => /unknown parameter "shade"/.test(d.message)).length, 1, 'said once, not by validation and again by the dry run');
});

test('compose dry run: a good page says nothing, leaves no trace, and stays fast on big data', () => {
  assert.deepStrictEqual(compose({ data: DATA, charts: [bars(), scatter()] }).diagnostics, []);
  const big = Array.from({ length: 100000 }, (_, i) => ({ a: i, b: Math.sin(i / 100) * 10 }));
  const t0 = Date.now();
  const r = compose({ data: { big }, charts: [{ data: 'big', transforms: [{ type: 'decimate', x: 'a', y: 'b' }], scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'a', y: 'b' }], interaction: [{ type: 'zoom' }, { type: 'tooltip' }] }] });
  assert.deepStrictEqual(r.diagnostics, []);
  assert(Date.now() - t0 < 8000, `100000 rows composed in ${Date.now() - t0} ms`);
  const spec = { data: 'big', transforms: [{ type: 'decimate', x: 'a', y: 'b' }], scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'a', y: 'b' }], interaction: [{ type: 'zoom' }, { type: 'tooltip' }] };
  assert.strictEqual(compose({ data: { big }, charts: [spec], dryRun: false }).html, r.html, 'the trial run leaves nothing in the page: byte for byte the same as without it');
});

test('compose: binary columns are checked and drawn like any dataset, and stored as they came', async () => {
  const { encodeColumns } = require('./encode-columns.js');
  const { runPage } = require('./run-page.js');
  const cols = { a: Array.from({ length: 50 }, (_, i) => i), b: Array.from({ length: 50 }, (_, i) => (i * 7) % 13) };
  const page = { data: { d: encodeColumns(cols) }, charts: [{ data: 'd', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] }] };
  const r = compose(page);
  assert.deepStrictEqual(r.diagnostics, []);
  assert.deepStrictEqual(r.compressed, [], 'already encoded: not compressed again');
  assert(r.html.includes(page.data.d.columns.a.data), 'the stored bytes are the ones given');
  const { handles } = runPage(r.html);
  await handles[0].ready;
  assert.strictEqual(handles[0].diagnostics.length, 0);
  assert.strictEqual(handles[0].host.children[0].tag, 'svg');

  const wrong = (columns, re) => assert.throws(() => compose({ data: { d: { columns } }, charts: page.charts }), (e) => e instanceof ComposeError && re.test(e.message));
  const good = encodeColumns({ a: [1, 2, 3] }).columns.a;
  wrong({ a: good, b: { dtype: 'float16', encoding: 'base64', data: '' } }, /data "d": column "b": unknown dtype "float16"/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'zip', data: '' } }, /column "b": unknown encoding "zip"/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'base64' } }, /column "b": a binary column needs a "data" string/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'gzip+base64', data: Buffer.from('nope').toString('base64') } }, /column "b":/);
  wrong({ a: good, b: { dtype: 'float64', encoding: 'base64', data: Buffer.from([1, 2, 3]).toString('base64') } }, /column "b": 3 bytes is not a whole number of float64 values/);
});

test('compose: pages carry the minified code by default, and draw what the readable code draws', async () => {
  const { runPage } = require('./run-page.js');
  const page = { data: DATA, charts: [bars()] };
  const small = compose(page);
  const big = compose({ ...page, distDir: path.join(__dirname, '../dist') });
  assert.deepStrictEqual(small.blocks, big.blocks);
  assert(small.bytes < big.bytes * 0.6, `${small.bytes} vs ${big.bytes}`);
  assert(!/\bdoc:/.test(small.html) && /\bdoc:/.test(big.html), 'the parameter docs stay out of the page');
  const a = runPage(small.html), b = runPage(big.html);
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
    assert.deepStrictEqual(b.params && Object.keys(b.params), raw.blocks[name].params && Object.keys(raw.blocks[name].params), 'the manifest keeps its docs and parameters');
  }
  assert.strictEqual(m.core.bytes, fs.statSync(path.join(out, 'min', 'core.js')).size);
  for (const bad of [dist, path.parse(dist).root, path.join(dist, '..')]) assert.throws(() => buildMin(dist, bad), (e) => e instanceof MinifyError && /refusing/.test(e.message), bad);
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

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('ok  ', name); }
    catch (e) { failed++; console.log('FAIL', name); console.error(e); process.exitCode = 1; }
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
