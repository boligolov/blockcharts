// Tests for the release folder: files, kits, hashes, determinism, and the loader that fetches separate files.
// Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { buildRelease, ReleaseError } = require('./build-dist.js');
const { stripDocs } = require('./minify.js');
const { compose } = require('./compose.js');
const { El, createDocument } = require('./fake-dom.js');
const { countTags } = require('./run-page.js');

let passed = 0;
let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

const repo = path.join(__dirname, '..');
const distDir = path.join(repo, 'dist');
const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bc-release-'));
const sri = (buf) => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
const recipe = (name) => JSON.parse(fs.readFileSync(path.join(repo, 'skills/blockcharts/recipes', name), 'utf8'));
const pageKit = (name) => ({ name, blocks: compose({ ...recipe(name + '.json'), distDir }).blocks });

const out = tmp();
const release = buildRelease({ distDir, outDir: out, kits, pageKits: [pageKit('bar')] });
const read = (rel) => fs.readFileSync(path.join(out, rel));
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name])).sort();

function classic(file, extra) {
  const sandbox = { console: { warn() {}, error() {}, log() {} }, ...(extra || {}) };
  vm.createContext(sandbox);
  vm.runInContext(read(file).toString('utf8'), sandbox, { filename: file });
  return sandbox;
}

test('release: every part is a file of its own, and the manifest describes each one truthfully', () => {
  assert.strictEqual(release.version, manifest.core.version);
  const listed = new Set(['manifest.json', release.core.file, release.loader.file, release.types.file]);
  for (const b of Object.values(release.blocks)) listed.add(b.file);
  for (const k of Object.values(release.kits)) { listed.add(k.js.file); listed.add(k.mjs.file); listed.add(k.dts.file); }
  assert.deepStrictEqual(files(out).map((f) => f.split(path.sep).join('/')), Array.from(listed).sort(), 'nothing missing, nothing unexplained');
  const entries = [release.core, release.loader, release.types, ...Object.values(release.blocks), ...Object.values(release.kits).flatMap((k) => [k.js, k.mjs, k.dts])];
  for (const e of entries) {
    const buf = read(e.file);
    assert.strictEqual(e.bytes, buf.length, e.file);
    assert.strictEqual(e.sha384, sri(buf), e.file + ' hash');
    assert(e.gzip > 0 && (e.bytes < 500 || e.gzip < e.bytes), e.file + ' gzip');
  }
  assert.deepStrictEqual(Object.keys(release.blocks), Object.keys(manifest.blocks), 'every block, in manifest order');
  assert.deepStrictEqual(JSON.parse(read('manifest.json').toString()), release, 'the file says what the function returned');
  assert.strictEqual(release.blocks['mark.line'].closure.join(), manifest.blocks['mark.line'].closure.join());
  assert(!('params' in release.blocks['mark.line']), 'the manifest a browser downloads stays small');
});

test('release: the same input gives the same bytes, and a rebuild removes what no longer belongs', () => {
  const other = tmp();
  buildRelease({ distDir, outDir: other, kits, pageKits: [pageKit('bar')] });
  for (const f of files(out)) assert(read(f).equals(fs.readFileSync(path.join(other, f))), f + ' differs');
  assert.deepStrictEqual(files(other), files(out));

  fs.writeFileSync(path.join(other, 'kits', 'stale.js'), 'x');
  fs.writeFileSync(path.join(other, 'blocks', 'stale.js'), 'x');
  fs.writeFileSync(path.join(other, 'keep.txt'), 'mine');
  buildRelease({ distDir, outDir: other, kits });
  assert(!fs.existsSync(path.join(other, 'kits', 'stale.js')) && !fs.existsSync(path.join(other, 'blocks', 'stale.js')));
  assert(!fs.existsSync(path.join(other, 'kits', 'bar.js')), 'the page kit of the earlier build is gone');
  assert.strictEqual(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8'), 'mine', 'files it does not own are left alone');
});

for (const name of Object.keys(kits)) {
  test(`kit ${name}: one script registers exactly its blocks (with their dependencies), as a classic script and as an ES module`, () => {
    const k = release.kits[name];
    const sb = classic(k.js.file);
    assert.strictEqual(sb.BC.version, release.version);
    assert.deepStrictEqual(Array.from(sb.BC.blocks()).sort(), k.blocks.slice().sort());
    for (const b of k.blocks) for (const r of manifest.blocks[b].requires) assert(k.blocks.includes(r), `${b} needs ${r}`);
    assert(read(k.js.file).toString().startsWith(`/*! blockcharts ${release.version} kit "${name}"`), 'the banner says what is inside');
    assert(!/<\/script|<!--/i.test(read(k.js.file).toString()), 'safe to inline in a page');
    const asked = kits[name].blocks === '*' ? Object.keys(manifest.blocks) : kits[name].blocks;
    for (const b of asked) assert(k.blocks.includes(b), `${b} is in the kit`);
    if (kits[name].blocks === '*') assert.strictEqual(k.blocks.length, Object.keys(manifest.blocks).length);
  });
}

test('kit: an ES module gives BC as its default export and needs nothing around it', async () => {
  delete globalThis.BC;
  const mod = await import(pathToFileURL(path.join(out, 'kits', 'basic.mjs')).href);
  assert.strictEqual(mod.default, globalThis.BC);
  assert.deepStrictEqual(Array.from(mod.default.blocks()).sort(), release.kits.basic.blocks.slice().sort());
  delete globalThis.BC;
});

test('kit: a page kit holds exactly what one page uses, and that page validates on it', () => {
  const k = release.kits.bar;
  assert.deepStrictEqual(k.blocks, compose({ ...recipe('bar.json'), distDir }).blocks);
  assert(k.js.bytes < release.kits.full.js.bytes);
  const { BC } = classic(k.js.file);
  const page = recipe('bar.json');
  for (const name of Object.keys(page.data)) BC.data(name, page.data[name]);
  for (const c of page.charts) assert.deepStrictEqual(Array.from(BC.validate(c.spec || c)).filter((d) => d.level === 'error'), []);
});

test('release: mistakes are errors that say what to fix, and nothing is written to places it does not own', () => {
  const bad = (opts, re) => assert.throws(() => buildRelease({ distDir, outDir: tmp(), ...opts }), (e) => e instanceof ReleaseError && re.test(e.message));
  bad({ kits: { x: { blocks: ['mark.ghost'] } } }, /kit "x": no such block: mark\.ghost/);
  bad({ kits: { x: { blocks: 'all' } } }, /kit "x": "blocks" must be a list/);
  bad({ kits: { x: {} } }, /kit "x": "blocks" must be a list/);
  bad({ kits: { 'Bad Name': { blocks: '*' } } }, /kit name "Bad Name"/);
  bad({ kits: { bar: { blocks: '*' } }, pageKits: [{ name: 'bar', blocks: [] }] }, /kit "bar" is defined twice/);
  for (const dir of [repo, path.join(repo, 'src'), path.join(repo, 'dist', 'x'), path.join(repo, 'skills'), path.parse(repo).root]) {
    assert.throws(() => buildRelease({ distDir, outDir: dir, kits }), (e) => e instanceof ReleaseError && /refusing/.test(e.message), dir);
  }
  assert.throws(() => buildRelease({ distDir: path.join(os.tmpdir(), 'no-dist'), outDir: tmp(), kits }), /ENOENT/);
});

// ── the loader, run against a fake browser that "downloads" from the release folder ──
function browser(options) {
  const o = options || {};
  const base = 'https://cdn.test/bc/';
  const log = { fetched: [], scripts: [], timers: 0 };
  const body = new El('body');
  const chartNodes = (o.charts || []).map((spec) => Object.assign(new El('script'), { text: JSON.stringify(spec), textContent: JSON.stringify(spec) }));
  const dataNode = Object.assign(new El('script'), { text: JSON.stringify(o.data || {}), textContent: JSON.stringify(o.data || {}) });
  [dataNode, ...chartNodes].forEach((n) => body.appendChild(n));
  const self = { src: base + 'loader.js', hasAttribute: (a) => a === 'data-auto' && !!o.auto };
  const sandbox = {
    console: { warn() {}, error: (...a) => (log.errors = (log.errors || []).concat(a.join(' '))), log() {} },
    setTimeout: () => { log.timers++; return 0; },
    getComputedStyle: () => ({ position: 'static' }),
    fetch: async (url) => {
      log.fetched.push(url);
      const rel = url.slice(base.length);
      const missing = (o.missing || []).includes(rel) || !fs.existsSync(path.join(out, rel));
      return { ok: !missing, status: missing ? 404 : 200, json: async () => JSON.parse(fs.readFileSync(path.join(out, rel), 'utf8')) };
    },
  };
  const head = new El('head');
  const doc = createDocument({
    currentScript: o.noCurrentScript ? null : self,
    head,
    querySelectorAll: (sel) => (sel === 'script#bc-data' ? [dataNode] : sel === 'script[data-bc-chart]' ? chartNodes : []),
  });
  head.appendChild = (el) => {
    log.scripts.push({ url: el.src, integrity: el.integrity, crossOrigin: el.crossOrigin });
    const rel = el.src.slice(base.length);
    setImmediate(() => {
      if ((o.missing || []).includes(rel) || !fs.existsSync(path.join(out, rel))) return el.onerror();
      vm.runInContext(fs.readFileSync(path.join(out, rel), 'utf8'), sandbox, { filename: rel });
      el.onload();
    });
    return el;
  };
  sandbox.document = doc;
  vm.createContext(sandbox);
  const run = () => vm.runInContext(read('loader.js').toString('utf8'), sandbox, { filename: 'loader.js' });
  return { sandbox, log, body, run, base };
}

const oneChart = { data: 'd', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }], marks: [{ type: 'line', x: 'a', y: 'b' }] };
const oneData = { d: [{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 1 }] };

test('loader: data-auto loads the core and only the blocks the page uses, then draws', async () => {
  const b = browser({ auto: true, charts: [oneChart], data: oneData });
  b.run();
  const BC = await b.sandbox.BCLoader.ready;
  const needs = Array.from(BC.needs(oneChart));
  const want = new Set();
  for (const n of needs) for (const c of manifest.blocks[n].closure) want.add(c);
  assert.deepStrictEqual(Array.from(BC.blocks()).sort(), Array.from(want).sort(), 'and nothing else');
  assert(BC.blocks().length < Object.keys(manifest.blocks).length);
  assert.deepStrictEqual(b.log.fetched, [b.base + 'manifest.json'], 'one manifest request');
  assert.strictEqual(b.log.scripts[0].url, b.base + 'core.js', 'the core first');
  assert.strictEqual(b.log.timers, 0, 'the core did not mount by itself before its blocks were there');
  assert.strictEqual(countTags(b.body, 'svg'), 1, 'the chart is drawn');
  assert(!b.log.errors, JSON.stringify(b.log.errors));
  assert(b.log.scripts.every((s) => s.integrity === undefined), 'no integrity attributes unless asked');
});

test('loader: explicit blocks, no scan, no mount, integrity from the manifest, and nothing is fetched twice', async () => {
  const b = browser({ charts: [oneChart], data: oneData });
  b.run();
  const BC = await b.sandbox.BCLoader.load({ blocks: ['mark.rect'], scan: false, mount: false, integrity: true });
  assert.deepStrictEqual(Array.from(BC.blocks()).sort(), manifest.blocks['mark.rect'].closure.slice().sort());
  assert.strictEqual(countTags(b.body, 'svg'), 0, 'mount: false');
  for (const s of b.log.scripts) {
    const rel = s.url.slice(b.base.length);
    const e = rel === 'core.js' ? release.core : Object.values(release.blocks).find((x) => x.file === rel);
    assert.strictEqual(s.integrity, e.sha384, rel);
    assert.strictEqual(s.crossOrigin, 'anonymous');
  }
  const n = b.log.scripts.length;
  await b.sandbox.BCLoader.load({ blocks: ['mark.rect', 'scale.linear'], scan: false, mount: false });
  assert.strictEqual(b.log.scripts.length, n + 1 - (manifest.blocks['mark.rect'].closure.includes('scale.linear') ? 1 : 0), 'only what was new');
  assert.strictEqual(b.log.fetched.length, 1, 'the manifest is fetched once');
});

test('loader: a block that does not exist, a file that is missing, a base that is unknown: each is a clear failure', async () => {
  let b = browser({});
  b.run();
  await assert.rejects(() => b.sandbox.BCLoader.load({ blocks: ['mark.ghost', 'mark.line'] }), /no such block: mark\.ghost/);

  b = browser({ missing: ['blocks/mark.line.js'] });
  b.run();
  await assert.rejects(() => b.sandbox.BCLoader.load({ blocks: ['mark.line'], mount: false }), /cannot load https:\/\/cdn\.test\/bc\/blocks\/mark\.line\.js/);
  b.log.missing = null;

  b = browser({ noCurrentScript: true });
  b.run();
  await assert.rejects(() => b.sandbox.BCLoader.load({}), /pass \{ base/);
  await assert.rejects(() => b.sandbox.BCLoader.load({ base: 'https://cdn.test/nothing/' }), /404|no such|ENOENT/);

  b = browser({ missing: ['manifest.json'] });
  b.run();
  await assert.rejects(() => b.sandbox.BCLoader.load({}), /manifest\.json answered 404/);
});

test('loader: a chart whose spec is broken does not stop the others being loaded; mount reports it', async () => {
  const b = browser({ charts: [oneChart], data: oneData });
  const broken = Object.assign(new El('script'), { text: '{nope', textContent: '{nope' });
  b.body.appendChild(broken);
  b.sandbox.document.querySelectorAll = (sel) => (sel === 'script#bc-data' ? [] : sel === 'script[data-bc-chart]' ? b.body.children.slice(1) : []);
  b.body.children[0].text = b.body.children[0].textContent = JSON.stringify(oneData);
  b.sandbox.document.querySelectorAll = ((orig) => (sel) => (sel === 'script#bc-data' ? [b.body.children[0]] : orig(sel)))(b.sandbox.document.querySelectorAll);
  b.run();
  await b.sandbox.BCLoader.load({});
  assert.strictEqual(countTags(b.body, 'svg'), 1);
  assert(b.log.errors && b.log.errors.some((e) => /not valid JSON/.test(e)), JSON.stringify(b.log.errors));
});

test('core: BC_CONFIG.autoMount false is honored, and the default still mounts on its own', () => {
  let on = 0, off = 0;
  const a = classic('core.js', { document: createDocument(), setTimeout: () => { on++; } });
  const b = classic('core.js', { document: createDocument(), BC_CONFIG: { autoMount: false }, setTimeout: () => { off++; } });
  assert.strictEqual(typeof a.BC.mount, 'function');
  assert.strictEqual(typeof b.BC.mount, 'function', 'still usable by hand');
  assert.strictEqual(on, 1);
  assert.strictEqual(off, 0);
});

test('minified release: every recipe draws exactly what the unminified code draws', async () => {
  const { runPage } = require('./run-page.js');
  const plainCode = (names) => [manifest.core.file, ...names.map((n) => manifest.blocks[n].file)].map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
  const kit = read('kits/full.js').toString('utf8');
  const recipes = fs.readdirSync(path.join(repo, 'skills/blockcharts/recipes')).filter((f) => f.endsWith('.json'));
  assert(recipes.length >= 12);
  for (const file of recipes) {
    const page = JSON.parse(fs.readFileSync(path.join(repo, 'skills/blockcharts/recipes', file), 'utf8'));
    const r = compose({ ...page, distDir, baseDir: path.join(repo, 'skills/blockcharts/recipes') });
    const a = runPage(r.html, plainCode(r.blocks));
    const b = runPage(r.html, kit);
    assert.strictEqual(a.handles.length, b.handles.length, file);
    for (let i = 0; i < a.handles.length; i++) {
      await Promise.all([a.handles[i].ready, b.handles[i].ready]);
      assert.deepStrictEqual(Array.from(b.handles[i].diagnostics), [], file);
      const output = (el) => (el.tag === 'canvas' ? JSON.stringify(el.getContext('2d').calls) : el.serialize());
      assert(output(a.handles[i].host.children[0]).length > 500, file + ' drew something');
      assert.strictEqual(output(b.handles[i].host.children[0]), output(a.handles[i].host.children[0]), `${file} chart ${i}`);
    }
    assert.deepStrictEqual(b.errors, [], file);
  }
});

test('minified release: smaller than the source by a wide margin, and only the docs are gone from the blocks', () => {
  const full = release.kits.full;
  const plainBytes = Buffer.byteLength([manifest.core.file, ...Object.values(manifest.blocks).map((b) => b.file)].map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n'));
  assert(full.js.bytes < plainBytes * 0.5, `${full.js.bytes} vs ${plainBytes}`);
  assert(!/\bdoc:/.test(read('kits/full.js').toString()), 'no doc strings in the released code');
  assert(read('kits/full.js').toString().split('\n').length < 120, 'a few lines, not a line per statement');
  const shape = (src, file) => {
    const defs = [];
    vm.runInNewContext(src, { BC: { define: (d) => defs.push(d) } }, { filename: file });
    const d = defs[0];
    const strip = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k, v]) => !(k === 'doc' && typeof v === 'string')).map(([k, v]) => [k, typeof v === 'function' ? 'fn' : strip(v)])) : o);
    return JSON.stringify(strip(JSON.parse(JSON.stringify(d, (k, v) => (typeof v === 'function' ? 'fn' : v)))));
  };
  for (const name of Object.keys(manifest.blocks)) {
    assert.strictEqual(shape(read(release.blocks[name].file).toString(), name), shape(fs.readFileSync(path.join(distDir, manifest.blocks[name].file), 'utf8'), name), name + ': same parameters, channels, versions, requires');
  }
  const raw = buildRelease({ distDir, outDir: tmp(), kits: { all: { blocks: '*' } }, minify: false });
  assert(raw.kits.all.js.bytes > plainBytes, 'minify: false keeps the code as it was');
  assert(fs.readFileSync(path.join(distDir, 'blocks/mark.rect.js'), 'utf8').includes('doc:'));
});

test('minified release: a doc cut that changes anything else is refused, not shipped', () => {
  const ok = "(function(){ BC.define({ role: 'mark', type: 'x', version: 1, doc: 'What it is, \\'quoted\\'.', params: { a: { kind: 'number', doc: \"A number.\" } } }); })();";
  const out = stripDocs('x.js', ok);
  assert(!/doc/.test(out) && /kind: 'number'/.test(out));
  assert.throws(() => stripDocs('x.js', "(function(){ BC.define({ role: 'mark', type: 'x', version: 1, doc: 'a' + 'b', params: {} }); })();"), /does not run|more than the docs/);
  assert.throws(() => stripDocs('x.js', "(function(){ BC.define({ role: 'mark', type: 'x', version: 1, render() { return \"see doc: 'here'\"; } }); })();"), /more than the docs changed/);
  assert.throws(() => stripDocs('x.js', "BC.define({ role: 'mark', type: 'x', version: 1, doc: 'ok' }); throw new Error('boom');"), /does not run/);
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('ok  ', name); }
    catch (e) { failed++; console.log('FAIL', name); console.error(e); process.exitCode = 1; }
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
