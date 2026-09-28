// Core + blocks tests on a fake DOM. Run: npm test  (writes dist/test.html for a visual check)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

class FakeNode {
  constructor(tag) { this.nodeType = 1; this.tag = tag; this.attrs = {}; this.children = []; this.text = ''; this.parentNode = null; this.listeners = {}; this.style = {}; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== fn); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; }
  setPointerCapture() {}
  fire(t, ev) { for (const fn of this.listeners[t] || []) fn({ preventDefault() {}, ...ev }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
  set textContent(t) { this.text = String(t); this.children = []; }
  get textContent() { return this.text; }
  get attributes() { return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] })); }
  serialize() {
    const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`).join('');
    const inner = this.text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + this.children.map((c) => c.serialize()).join('');
    return `<${this.tag}${a}>${inner}</${this.tag}>`;
  }
}
const noNodes = { forEach() {} };
globalThis.getComputedStyle = () => ({ position: 'static' });
globalThis.document = {
  readyState: 'complete',
  createElementNS: (_ns, tag) => new FakeNode(tag),
  createElement: (tag) => new FakeNode(tag),
  querySelectorAll: () => noNodes,
  listeners: {},
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== fn); },
  fire(t, ev) { for (const fn of this.listeners[t] || []) fn(ev); },
};
const quiet = { warn: console.warn, error: console.error };
const logged = { warn: [], error: [] };
console.warn = (...a) => logged.warn.push(a.join(' '));
console.error = (...a) => logged.error.push(a.join(' '));

const dist = path.join(__dirname, '../dist');
require(`${dist}/core.js`);
for (const f of fs.readdirSync(`${dist}/blocks`)) require(`${dist}/blocks/${f}`);

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const flush = () => new Promise((r) => setTimeout(r, 10));
const svgOf = (host) => host.children[0].serialize();
const count = (s, re) => (s.match(re) || []).length;
const axisStarts = (svg) => [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+)[^>]*class="bc-axis"/g)].map((m) => [+m[1], +m[2]]);
const dSpec = () => ({
  data: 'sales',
  scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true }, y2: { type: 'linear', range: 'height' } },
  guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, { type: 'axis', scale: 'y2', position: 'right' }],
  marks: [
    { type: 'point', x: 'month', y: 'revenue', r: 4 },
    { type: 'point', x: 'month', y: { field: 'units', scale: 'y2' }, r: 3 },
  ],
});

BC.data('sales', [
  { month: 1, revenue: 120, units: 3400 }, { month: 2, revenue: 150, units: 3900 },
  { month: 3, revenue: 130, units: 5200 }, { month: 4, revenue: 180, units: 4800 },
  { month: 5, revenue: 210, units: 6100 }, { month: 6, revenue: 190, units: 7300 },
  { month: 7, revenue: 260, units: 6900 }, { month: 8, revenue: 240, units: 8800 },
]);

test('registry: blocks registered, define is idempotent', () => {
  // every block of the build is registered (tests add a few of their own, which are not part of the build)
  const real = Object.keys(JSON.parse(fs.readFileSync(`${dist}/manifest.json`, 'utf8')).blocks).sort();
  assert(real.length >= 20, `the manifest lists the blocks: ${real.length}`);
  assert.deepStrictEqual(BC.blocks().filter((n) => real.includes(n)).sort(), real);
  const before = BC.blocks().length;
  BC.define(BC.get('mark.point'));
  assert.strictEqual(BC.blocks().length, before);
  assert.strictEqual(logged.warn.length, 0, 'same version: silent');
  const v = BC.get('mark.point').version;
  BC.define({ ...BC.get('mark.point'), version: v + 1 });
  assert.strictEqual(logged.warn.length, 1, 'other version: warns');
  assert.strictEqual(BC.get('mark.point').version, v, 'first one is kept');
  logged.warn.length = 0;
});

test('data lake: null cells become NaN and are skipped, bad input throws', () => {
  BC.data('mixed', [{ a: 1, b: 'x', c: null }, { a: 2, b: 'y', c: 3 }]);
  const host = new FakeNode('div');
  const h = BC.chart(host, { data: 'mixed', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'c' }] });
  assert.strictEqual(h.diagnostics.filter((d) => d.level === 'error').length, 0);
  assert.strictEqual(count(svgOf(host), /<circle /g), 1, 'the row with a null c is skipped');
  assert.throws(() => BC.data('bad', { columns: { a: [1, 2], b: [1] } }), /column "b"/);
  assert.throws(() => BC.data('bad', 5), /array of rows/);
});

test('needs: direct block names of a spec', () => {
  assert.deepStrictEqual(BC.needs(dSpec()), ['scale.linear', 'mark.point', 'guide.axis', 'renderer.svg']);
  assert.deepStrictEqual(BC.needs({ renderer: 'canvas', marks: [] }), ['renderer.canvas']);
  assert.deepStrictEqual(BC.needs(null), []);
});

test('validate: a good spec has no diagnostics', () => {
  assert.deepStrictEqual(BC.validate(dSpec()), []);
});

test('validate: catches dangling scale, missing block, unknown field, bad params', () => {
  const s = dSpec();
  s.marks.push({ type: 'point', x: 'month', y: { field: 'units', scale: 'nope' } });
  s.marks.push({ type: 'hexbin', x: 'month' });
  s.marks.push({ type: 'point', x: 'month', y: 'ghost', shade: 'red', r: 'big' });
  s.marks.push({ type: 'point', x: 'month' });
  s.guides.push({ type: 'axis', scale: 'y', position: 'middle' });
  s.guides.push({ type: 'axis' });
  s.scales.z = { type: 'log' };
  const d = BC.validate(s);
  const has = (level, p, re) => assert(d.some((x) => x.level === level && x.path === p && re.test(x.message)), `${level} ${p} ${re}\n${JSON.stringify(d, null, 1)}`);
  has('error', 'marks[2].y', /scale "nope" is not declared/);
  has('error', 'marks[3].type', /"mark.hexbin" is not loaded/);
  has('error', 'marks[4].y', /unknown field "ghost"/);
  has('warn', 'marks[4].shade', /unknown parameter "shade"/);
  has('error', 'marks[4].r', /must be a number/);
  has('error', 'marks[5].y', /requires channel "y"/);
  has('error', 'guides[3].position', /one of: top, right, bottom, left/);
  has('error', 'guides[4].scale', /axis requires "scale"/);
  has('error', 'scales.z.type', /"scale.log" is not loaded/);
});

test('validate: never throws on garbage', () => {
  for (const bad of [null, undefined, 5, {}, { data: 1, marks: 'x' }, { data: 'sales', marks: [null, 5, {}] }]) {
    assert.doesNotThrow(() => BC.validate(bad));
  }
});

test('validate: transitive requires and channel scale kinds', () => {
  BC.define({ role: 'mark', type: 'needy', version: 1, requires: ['scale.log'], channels: { x: { required: true, scales: ['log'] } }, render: () => [] });
  const d = BC.validate({ data: 'sales', scales: { x: { type: 'linear' } }, marks: [{ type: 'needy', x: 'month' }] });
  assert(d.some((x) => /mark\.needy requires scale\.log/.test(x.message)));
  assert(d.some((x) => x.path === 'marks[0].x' && /does not accept a "linear" scale \(accepts: log\)/.test(x.message)));
});

test('chart: dual-axis renders every point, no NaN', () => {
  const host = new FakeNode('div');
  const h = BC.chart(host, dSpec());
  const svg = svgOf(host);
  assert.deepStrictEqual(h.diagnostics, []);
  assert.strictEqual(count(svg, /<circle /g), 16);
  assert(!/NaN|undefined|Infinity/.test(svg));
  assert.strictEqual(count(svg, /class="bc-axis"/g), 3);
  assert(svg.includes('data-bc-mark="1" data-bc-row="7"'));
  fs.writeFileSync(`${dist}/test.html`, `<!doctype html><meta charset="utf-8"><title>test</title><body style="margin:24px;max-width:720px;font-family:system-ui">${svg}`);
});

test('layout: two axes on one side stack', () => {
  const s = dSpec();
  s.guides[2].position = 'left';
  const host = new FakeNode('div');
  BC.chart(host, s);
  const [bottom, left1, left2] = axisStarts(svgOf(host));
  assert(left2[0] < left1[0], `second left axis is drawn outside the first: ${left2[0]} < ${left1[0]}`);
  assert(left1[0] - left2[0] > 20, 'and clear of its labels');
  assert(bottom[1] > 300, 'x axis at the bottom');
});

test('layout: title reserves space', () => {
  const a = new FakeNode('div'), b = new FakeNode('div');
  BC.chart(a, dSpec());
  BC.chart(b, { ...dSpec(), title: 'Sales' });
  assert(svgOf(b).includes('>Sales<'));
  assert(axisStarts(svgOf(b))[1][1] > axisStarts(svgOf(a))[1][1], 'plot top moved down');
});

test('chart: invalid spec renders an error box and does not throw', () => {
  const host = new FakeNode('div');
  const h = BC.chart(host, { data: 'nope', marks: [] });
  assert(h.diagnostics.some((d) => d.level === 'error'));
  assert.strictEqual(host.children[0].attrs.class, 'bc-error');
  assert(host.children[0].text.includes('dataset "nope" is not in the data lake'));
  assert(logged.error.length > 0);
  logged.error.length = 0;
});

test('chart: a failing mark is reported, the rest still renders', () => {
  BC.define({ role: 'mark', type: 'boom', version: 1, channels: { x: { required: true } }, render() { throw new Error('kaboom'); } });
  const s = dSpec();
  s.marks.push({ type: 'boom', x: 'month' });
  const host = new FakeNode('div');
  const h = BC.chart(host, s);
  assert(h.diagnostics.some((d) => d.path === 'marks[2]' && d.message === 'kaboom'));
  assert.strictEqual(count(svgOf(host), /<circle /g), 16);
  logged.error.length = 0;
});

test('chart: update() rebuilds, destroy() empties the host', () => {
  const host = new FakeNode('div');
  const h = BC.chart(host, dSpec());
  const s2 = dSpec();
  s2.marks.pop();
  h.update(s2);
  assert.strictEqual(h.spec, s2);
  assert.strictEqual(host.children.length, 1);
  assert.strictEqual(count(svgOf(host), /<circle /g), 8);
  h.destroy();
  assert.strictEqual(host.children.length, 0);
});

test('interaction: attach gets a live context, cleanup runs on update/destroy', () => {
  let seen = null, cleaned = 0;
  BC.define({
    role: 'interaction', type: 'probe', version: 1,
    attach(spec, live) { seen = live; live.cleanup(() => { cleaned++; }); },
  });
  const s = dSpec();
  s.interaction = [{ type: 'probe' }];
  const host = new FakeNode('div');
  const h = BC.chart(host, s);
  assert(seen && seen.host === host && seen.root.tag === 'svg');
  assert(seen.plot.w > 0 && seen.scales.x && seen.list.layers.length === 4, 'inherits the chart context, incl. live plot');
  const el = { closest: () => ({ getAttribute: (k) => (k === 'data-bc-mark' ? '1' : '5') }) };
  assert.deepStrictEqual(seen.hit({ target: el }), { mark: 1, row: 5 });
  assert.strictEqual(seen.hit({ target: { closest: () => null } }), null);
  h.update(s);
  assert.strictEqual(cleaned, 1);
  h.destroy();
  assert.strictEqual(cleaned, 2);
});

require('./test-blocks.js')({ test, FakeNode, svgOf, count, axisStarts, logged, flush, dist });
require('./test-data.js')({ test, FakeNode, svgOf, count, axisStarts, logged, flush, dist });

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('ok  ', name); }
    catch (e) { console.log('FAIL', name); quiet.error(e); process.exitCode = 1; }
  }
  console.log(`\n${passed} of ${queue.length} passed`);
})();
