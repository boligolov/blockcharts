// The framework wrappers (blockcharts/react, /vue, /svelte, /element) as an app uses them: the release's files, bundled by
// esbuild with the real React, Vue and Svelte, in Chrome (playwright-core, channel "chrome"); their logic on a stub runtime;
// a server render; and their types, checked by tsc against code an app would write. Run: npm run test:frameworks
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');
const { buildRelease } = require('./build-dist.js');

const repo = path.join(__dirname, '..');
const distDir = path.join(repo, 'dist');
const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-frameworks-'));
// the app's node_modules are the repository's: React, Vue and Svelte resolve from the release's files as in an app
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
const rel = path.join(dir, 'release');
const release = buildRelease({ distDir, outDir: rel, kits });
const fw = (name) => pathToFileURL(path.join(rel, release.frameworks[name].mjs.file)).href;
const slash = (p) => p.split(path.sep).join('/');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ───────────── the shared controller, on a runtime that records what it is asked ─────────────

/** A stand-in for the runtime a kit puts on globalThis.BC: it records charts, datasets and updates. */
function stubRuntime(blocks = ['interaction.click']) {
  const log = [];
  const lake = new Map();
  const bc = {
    version: '0.0.0',
    define() {},
    has: (name) => blocks.includes(name),
    data(name, input) {
      if (input === null) lake.delete(name);
      else if (input === 'bad') throw new Error('malformed');
      else lake.set(name, input);
      log.push(['data', name, input === null ? null : 'set']);
    },
    chart(host, spec) {
      log.push(['chart', spec]);
      const handle = {
        host,
        spec,
        update(next) {
          log.push(['update', next]);
        },
        setView(s, d) {
          log.push(['setView', s, d]);
        },
        getView: () => ({ x: [1, 2] }),
        destroy() {
          log.push(['destroy']);
        },
      };
      return handle;
    },
  };
  return { bc, log, lake };
}

/** An element enough for the controller: listeners and children. */
function stubHost() {
  const listeners = {};
  return {
    listeners,
    children: [],
    textContent: '',
    ownerDocument: { createElement: (tag) => ({ tag, setAttribute() {}, className: '', textContent: '' }) },
    addEventListener(t, fn) {
      (listeners[t] = listeners[t] || []).push(fn);
    },
    removeEventListener(t, fn) {
      listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
    },
    querySelector(sel) {
      return this.children.find((c) => sel === '.' + c.className) || null;
    },
    appendChild(c) {
      this.children.push(c);
    },
    fire(t, detail) {
      for (const fn of listeners[t] || []) fn({ type: t, detail });
    },
  };
}

const SPEC = () => ({
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  marks: [{ type: 'rect', x: 'k', y: 'v' }],
});

test('controller: own data under a name of its own, drawn again only when the spec or the data changed', async () => {
  const { Controller, sameSpec } = await import(fw('controller'));
  const { bc, log, lake } = stubRuntime();
  globalThis.BC = bc;
  try {
    const host = stubHost();
    const c = new Controller(host);
    const rows = [{ k: 'a', v: 1 }];
    c.set({ spec: SPEC(), data: rows });
    const own = log[0][1];
    assert(/^bc:own:\d+$/.test(own), own);
    assert.strictEqual(log[1][0], 'chart');
    assert.strictEqual(log[1][1].data, own, "the spec draws the chart's own data");
    c.set({ spec: SPEC(), data: rows });
    assert.strictEqual(log.length, 2, 'the same spec in a new object and the same rows: nothing to do');
    c.set({ spec: { ...SPEC(), title: 'New' }, data: rows });
    assert.deepStrictEqual(
      log.slice(2).map((e) => e[0]),
      ['update'],
      'a new title: drawn again',
    );
    c.set({ spec: { ...SPEC(), title: 'New' }, data: rows.slice() });
    assert.deepStrictEqual(
      log.slice(3).map((e) => e[0]),
      ['data', 'update'],
      'new rows: given to the lake, drawn again',
    );
    c.set({ spec: { ...SPEC(), data: 'shared', title: 'New' } });
    assert.deepStrictEqual(log.slice(5, 7), [['data', own, null], log[6]], 'no data any more: its own dataset goes');
    assert.strictEqual(log[6][1].data, 'shared', 'and the spec names the shared one');
    // the same spec object, changed in place deep inside (a reactive object of Vue): drawn again, and only then
    const live = { ...SPEC(), data: 'shared', title: 'New' };
    c.set({ spec: live });
    c.set({ spec: live });
    assert.strictEqual(log.length, 7, 'unchanged');
    live.marks[0].y = 'w';
    c.set({ spec: live });
    assert.deepStrictEqual(log[7][0], 'update', 'a change in place is a change');
    assert.strictEqual(log[7][1].marks[0].y, 'w');
    const h = c.handle;
    c.destroy();
    c.destroy();
    assert.deepStrictEqual(
      log.slice(8).map((e) => e[0]),
      ['destroy'],
      'destroyed once',
    );
    assert.strictEqual(lake.size, 0);
    assert.deepStrictEqual(host.listeners['bc-click'], [], 'its listener is gone');
    c.set({ spec: SPEC(), data: rows });
    assert.strictEqual(log.length, 9, 'a controller that is gone draws nothing');
    assert(h);
    // what "the same" means
    const fn = () => 1;
    assert(sameSpec({ a: [1, { b: NaN }], f: fn }, { a: [1, { b: NaN }], f: fn }));
    assert(!sameSpec({ f: fn }, { f: () => 1 }), 'functions by identity');
    assert(!sameSpec({ a: 1 }, { a: 1, b: undefined }) && !sameSpec([1], { 0: 1 }) && !sameSpec({ a: [1] }, { a: [1, 2] }));
    // a time domain: dates by their time, not as objects with no keys
    assert(sameSpec({ domain: [new Date(1), new Date(2)] }, { domain: [new Date(1), new Date(2)] }));
    assert(!sameSpec({ domain: [new Date(1)] }, { domain: [new Date(5)] }), 'another date is another domain');
    assert(!sameSpec({ d: new Date(1) }, { d: {} }) && !sameSpec(new Map([[1, 2]]), new Map([[1, 3]])), 'by identity');
  } finally {
    delete globalThis.BC;
  }
});

test('controller: onClick adds interaction.click once, gets the row, and says so when the kit has no such block', async () => {
  const { Controller } = await import(fw('controller'));
  const host = stubHost();
  const { bc, log } = stubRuntime();
  globalThis.BC = bc;
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    const got = [];
    const c = new Controller(host);
    c.set({ spec: SPEC(), onClick: (d, e) => got.push([d, e.type]) });
    assert.deepStrictEqual(log[0][1].interaction, [{ type: 'click' }]);
    host.fire('bc-click', { row: 2 });
    assert.deepStrictEqual(got, [[{ row: 2 }, 'bc-click']]);
    c.set({ spec: { ...SPEC(), interaction: [{ type: 'click', cursor: false }] }, onClick: () => got.push('second') });
    assert.deepStrictEqual(log[1][1].interaction, [{ type: 'click', cursor: false }], 'a click the spec has is not added twice');
    host.fire('bc-click', { row: 0 });
    assert.strictEqual(got[1], 'second', 'the latest function is called');
    c.set({ spec: SPEC() });
    assert.strictEqual(log[2][1].interaction, undefined, 'no function, no clicks');
    host.fire('bc-click', { row: 0 });
    assert.strictEqual(got.length, 2);

    globalThis.BC = stubRuntime([]).bc;
    const d = new Controller(stubHost());
    d.set({ spec: SPEC(), onClick() {} });
    d.set({ spec: { ...SPEC(), title: 'x' }, onClick() {} });
    assert.strictEqual(warnings.filter((w) => /interaction\.click/.test(w)).length, 1, 'said once, not at every render');
  } finally {
    console.warn = warn;
    delete globalThis.BC;
  }
});

test('controller: no runtime on the page is a message in the chart and in the console, never a throw', async () => {
  const { Controller } = await import(fw('controller'));
  const host = stubHost();
  const errors = [];
  const error = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    delete globalThis.BC;
    const c = new Controller(host);
    c.set({ spec: SPEC() });
    c.set({ spec: SPEC() });
    assert.strictEqual(host.children.length, 1, 'one box, however often it renders');
    assert(/no runtime on the page.*kits\/basic\.mjs/.test(host.children[0].textContent), host.children[0].textContent);
    assert.strictEqual(errors.length, 1);
    // something else called BC is not a runtime (an element with id="BC")
    globalThis.BC = { id: 'BC' };
    new Controller(stubHost()).set({ spec: SPEC() });
    assert.strictEqual(errors.length, 2);
    // a malformed dataset is the chart's to report, not a crash
    globalThis.BC = stubRuntime().bc;
    const m = new Controller(stubHost());
    m.set({ spec: SPEC(), data: 'bad' });
    assert(m.handle, 'the chart is still made, and reports an unknown dataset');
    assert(errors.some((e) => /malformed/.test(e)));
  } finally {
    console.error = error;
    delete globalThis.BC;
  }
});

// ───────────── a server renders an empty element, and importing touches no DOM ─────────────

test('server: React and Vue render an empty <div>, the action and the element import without a DOM', async () => {
  const { BlockChart: ReactChart } = await import(fw('react'));
  const React = require(path.join(dir, 'node_modules', 'react'));
  const { renderToString } = require(path.join(dir, 'node_modules', 'react-dom', 'server'));
  assert.strictEqual(renderToString(React.createElement(ReactChart, { spec: SPEC(), data: [], className: 'c' })), '<div class="c"></div>');
  const { BlockChart: VueChart } = await import(fw('vue'));
  const vue = await import(pathToFileURL(require.resolve('vue', { paths: [dir] })).href);
  const server = await import(pathToFileURL(require.resolve('vue/server-renderer', { paths: [dir] })).href);
  const html = await server.renderToString(vue.createSSRApp({ render: () => vue.h(VueChart, { spec: SPEC(), data: [] }) }));
  assert.strictEqual(html, '<div></div>');
  const svelte = await import(fw('svelte'));
  assert.strictEqual(typeof svelte.blockchart, 'function');
  const element = await import(fw('element'));
  assert.strictEqual(typeof element.BlockChartElement, 'function');
  element.defineBlockChart('x-chart'); // no customElements on a server: nothing to do, nothing thrown
});

// ───────────── the types, as an app's TypeScript sees them ─────────────

test('types: code an app writes compiles against the release, and wrong props do not', () => {
  const app = path.join(dir, 'types-app');
  fs.mkdirSync(app, { recursive: true });
  const r = (name) => `../release/frameworks/${name}.mjs`;
  fs.writeFileSync(
    path.join(app, 'app.tsx'),
    [
      `import { useRef } from 'react';`,
      `import { BlockChart, type BlockChartHandle } from '${r('react')}';`,
      `import { BlockChart as VueChart } from '${r('vue')}';`,
      `import { blockchart } from '${r('svelte')}';`,
      `import { BlockChartElement } from '${r('element')}';`,
      `import { h } from 'vue';`,
      `const spec = { scales: { x: { type: 'band' } }, marks: [{ type: 'rect', x: 'k', y: 'v' }] };`,
      `const rows = [{ k: 'a', v: 1 }];`,
      `export function App() {`,
      `  const ref = useRef<BlockChartHandle>(null);`,
      `  const v: unknown = ref.current?.chart?.diagnostics;`,
      `  ref.current?.setView('x', null);`,
      `  return <BlockChart ref={ref} spec={spec} data={rows} className="c" onClick={(d, e) => console.log(d.values, d.row, e.detail.markIndex, v)} />;`,
      `}`,
      `export function Bad() {`,
      `  // @ts-expect-error a spec is an object`,
      `  const a = <BlockChart spec={5} />;`,
      `  // @ts-expect-error the detail has no such field`,
      `  const b = <BlockChart spec={spec} onClick={(d) => d.nope} />;`,
      `  return [a, b];`,
      `}`,
      `export const vnode = h(VueChart, { spec, data: rows, onClick: (d: BC.ClickDetail) => d.values });`,
      `export function action(node: HTMLElement) { return blockchart(node, { spec, data: { columns: { k: ['a'], v: [1] } } }); }`,
      `const el: BlockChartElement = document.createElement('block-chart');`,
      `el.spec = spec;`,
      `el.addEventListener('bc-click', (e) => e.detail.values);`,
      `// @ts-expect-error data is rows, columns or an encoded dataset`,
      `el.data = 'rows';`,
      `// rows an app describes with an interface (no index signature) are rows, in a prop and in the element`,
      `interface Sale { region: string; total: number }`,
      `declare const sales: Sale[];`,
      `export const typed = <BlockChart spec={spec} data={sales} />;`,
      `el.data = sales;`,
      `// @ts-expect-error numbers are not rows`,
      `el.data = [1, 2];`,
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2020',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ['es2020', 'dom'],
        types: [],
      },
      files: ['app.tsx'],
    }),
  );
  const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  const out = spawnSync(process.execPath, [tsc, '-p', app], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
});

// ───────────── in Chrome: the real frameworks, bundled as an app bundles them ─────────────

const ROWS3 = [
  { k: 'North', v: 42 },
  { k: 'South', v: 58 },
  { k: 'East', v: 31 },
];
const ROWS4 = ROWS3.concat([{ k: 'West', v: 12 }]);
/** The spec every app draws: bars, with a tooltip; `title` changes it, `click` adds the click interaction itself. */
const specSource = `const spec = (title, click) => ({
  title,
  size: [480, 260],
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
  marks: [{ type: 'rect', x: 'k', y: 'v' }],
  interaction: [{ type: 'tooltip' }].concat(click ? [{ type: 'click' }] : []),
});
window.clicks = [];
const ROWS3 = ${JSON.stringify(ROWS3)};
const ROWS4 = ${JSON.stringify(ROWS4)};`;
const kit = slash(path.join(rel, 'kits', 'basic.mjs'));

const APPS = {
  react: () => `
import '${kit}';
import { createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BlockChart } from '${slash(path.join(rel, 'frameworks', 'react.mjs'))}';
${specSource}
let setState;
function App() {
  const [s, set] = useState({ rows: ROWS3, title: 'Sales', show: true });
  setState = set;
  return s.show
    ? createElement(BlockChart, { spec: spec(s.title), data: s.rows, className: 'chart', ref: (r) => (window.handle = r), onClick: (d) => window.clicks.push(d.values) })
    : null;
}
createRoot(document.getElementById('app')).render(createElement(StrictMode, null, createElement(App)));
window.t = { update: (patch) => flushSync(() => setState((s) => ({ ...s, ...patch }))) };`,
  vue: () => `
import '${kit}';
import { createApp, h, reactive, nextTick } from 'vue';
import { BlockChart } from '${slash(path.join(rel, 'frameworks', 'vue.mjs'))}';
${specSource}
const s = reactive({ rows: ROWS3, title: 'Sales', show: true, tick: 0 });
createApp({
  // tick: a render whose spec is new and the same (Vue renders again only when something it read changed)
  render: () => (s.tick >= 0 && s.show ? h(BlockChart, { spec: spec(s.title), data: s.rows, ref: (r) => (window.handle = r), onClick: (d) => window.clicks.push(d.values) }) : null),
}).mount('#app');
window.t = { update: (patch) => { Object.assign(s, patch); return nextTick(); } };`,
  svelte: () => `
import '${kit}';
import { mount, flushSync } from 'svelte';
import App from './App.svelte.js';
${specSource}
const api = {};
mount(App, { target: document.getElementById('app'), props: { api, spec, rows: ROWS3, onClick: (d) => window.clicks.push(d.values) } });
window.t = { update: (patch) => { api.update(patch); flushSync(); } };`,
  element: () => `
import '${kit}';
import '${slash(path.join(rel, 'frameworks', 'element.mjs'))}';
${specSource}
const el = document.createElement('block-chart');
el.spec = spec('Sales', true);
el.data = ROWS3;
el.addEventListener('bc-click', (e) => window.clicks.push(e.detail.values));
document.getElementById('app').appendChild(el);
window.handle = { get chart() { return el.chart; } };
window.t = {
  update: async (patch) => {
    if (patch.rows) el.data = patch.rows;
    if ('title' in patch) el.spec = spec(patch.title, true);
    if (patch.show === false) el.remove();
    await Promise.resolve();
  },
};`,
  // a spec the app keeps in a reactive object and changes in place, as Vue apps do
  'vue-reactive': () => `
import '${kit}';
import { createApp, h, reactive, nextTick } from 'vue';
import { BlockChart } from '${slash(path.join(rel, 'frameworks', 'vue.mjs'))}';
${specSource}
const s = reactive({ spec: spec('Sales'), rows: ROWS3 });
createApp({ render: () => h(BlockChart, { spec: s.spec, data: s.rows }) }).mount('#app');
window.t = { shorter: () => { s.spec.size[1] = 140; return nextTick(); } };`,
};

// ───── several charts on one page: chart a with its own rows, b and c drawing one dataset the app gave to BC.data ─────

const multiSource = `${specSource}
BC.data('shared', [{ k: 'Q1', v: 10 }, { k: 'Q2', v: 14 }, { k: 'Q3', v: 9 }, { k: 'Q4', v: 17 }, { k: 'Q5', v: 12 }]);
const sharedSpec = (title, click) => ({ ...spec(title, click), data: 'shared' });
const pick = (name) => (d) => window.clicks.push(name + ':' + d.values.k);`;

Object.assign(APPS, {
  'react-multi': () => `
import '${kit}';
import { createElement as h, Fragment, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BlockChart } from '${slash(path.join(rel, 'frameworks', 'react.mjs'))}';
${multiSource}
let set;
function App() {
  const [s, setS] = useState({ rows: ROWS3, title: 'Sales', b: true, show: true });
  set = setS;
  if (!s.show) return null;
  return h(Fragment, null,
    h('div', { 'data-chart': 'a' }, h(BlockChart, { spec: spec(s.title), data: s.rows, onClick: pick('a') })),
    s.b ? h('div', { 'data-chart': 'b' }, h(BlockChart, { spec: sharedSpec('B'), onClick: pick('b') })) : null,
    h('div', { 'data-chart': 'c' }, h(BlockChart, { spec: sharedSpec('C'), onClick: pick('c') })));
}
createRoot(document.getElementById('app')).render(h(StrictMode, null, h(App)));
window.t = { update: (patch) => flushSync(() => set((s) => ({ ...s, ...patch }))) };`,
  'vue-multi': () => `
import '${kit}';
import { createApp, h, reactive, nextTick } from 'vue';
import { BlockChart } from '${slash(path.join(rel, 'frameworks', 'vue.mjs'))}';
${multiSource}
const s = reactive({ rows: ROWS3, title: 'Sales', b: true, show: true });
createApp({
  render: () =>
    s.show
      ? [
          h('div', { 'data-chart': 'a' }, [h(BlockChart, { spec: spec(s.title), data: s.rows, onClick: pick('a') })]),
          s.b ? h('div', { 'data-chart': 'b' }, [h(BlockChart, { spec: sharedSpec('B'), onClick: pick('b') })]) : null,
          h('div', { 'data-chart': 'c' }, [h(BlockChart, { spec: sharedSpec('C'), onClick: pick('c') })]),
        ]
      : null,
}).mount('#app');
window.t = { update: (patch) => { Object.assign(s, patch); return nextTick(); } };`,
  'svelte-multi': () => `
import '${kit}';
import { mount, flushSync } from 'svelte';
import App from './App.svelte.js';
${multiSource}
const api = {};
mount(App, { target: document.getElementById('app'), props: { api, spec, sharedSpec, pick, rows: ROWS3 } });
window.t = { update: (patch) => { api.update(patch); flushSync(); } };`,
  'element-multi': () => `
import '${kit}';
import '${slash(path.join(rel, 'frameworks', 'element.mjs'))}';
${multiSource}
const app = document.getElementById('app');
const make = (name, chartSpec, data) => {
  const box = document.createElement('div');
  box.dataset.chart = name;
  const el = document.createElement('block-chart');
  el.spec = chartSpec;
  if (data) el.data = data;
  el.addEventListener('bc-click', (e) => pick(name)(e.detail));
  box.appendChild(el);
  app.appendChild(box);
  return el;
};
const a = make('a', spec('Sales', true), ROWS3);
make('b', sharedSpec('B', true));
make('c', sharedSpec('C', true));
window.t = {
  update: async (patch) => {
    if (patch.rows) a.data = patch.rows;
    if ('title' in patch) a.spec = spec(patch.title, true);
    if (patch.b === false) app.querySelector('[data-chart="b"]').remove();
    if (patch.show === false) app.textContent = '';
    await Promise.resolve();
  },
};`,
});

const SVELTE_MULTI = `<script>
  import { blockchart } from '${slash(path.join(rel, 'frameworks', 'svelte.mjs'))}';
  let { api, spec, sharedSpec, pick, rows } = $props();
  let s = $state.raw({ rows, title: 'Sales', b: true, show: true });
  api.update = (patch) => (s = { ...s, ...patch });
</script>
{#if s.show}
  <div data-chart="a" use:blockchart={{ spec: spec(s.title), data: s.rows, onClick: pick('a') }}></div>
  {#if s.b}<div data-chart="b" use:blockchart={{ spec: sharedSpec('B'), onClick: pick('b') }}></div>{/if}
  <div data-chart="c" use:blockchart={{ spec: sharedSpec('C'), onClick: pick('c') }}></div>
{/if}
`;

const SVELTE_APP = `<script>
  import { blockchart } from '${slash(path.join(rel, 'frameworks', 'svelte.mjs'))}';
  let { api, spec, rows, onClick } = $props();
  let s = $state.raw({ rows, title: 'Sales', show: true });
  api.update = (patch) => (s = { ...s, ...patch });
</script>
{#if s.show}<div use:blockchart={{ spec: spec(s.title), data: s.rows, onClick }}></div>{/if}
`;

/** One app's page: its bundle inlined, so it opens from a file. */
async function appPage(name) {
  const at = path.join(dir, 'apps', name);
  fs.mkdirSync(at, { recursive: true });
  const component = { svelte: SVELTE_APP, 'svelte-multi': SVELTE_MULTI }[name];
  if (component) {
    const { compile } = require(require.resolve('svelte/compiler', { paths: [dir] }));
    fs.writeFileSync(path.join(at, 'App.svelte.js'), compile(component, { generate: 'client', dev: true, filename: 'App.svelte' }).js.code);
  }
  fs.writeFileSync(path.join(at, 'entry.mjs'), APPS[name]());
  const built = await esbuild.build({
    entryPoints: [path.join(at, 'entry.mjs')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    nodePaths: [path.join(dir, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const js = built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const file = path.join(at, 'index.html');
  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="app" style="width:520px"></div><script>${js}</script>`,
  );
  return file;
}

let browser;
async function open(name) {
  const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
  p.errors = [];
  p.on('console', (m) => m.type() === 'error' && p.errors.push(m.text()));
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(pathToFileURL(await appPage(name)).href);
  await p.waitForFunction(() => document.querySelectorAll('#app svg [data-bc-layer="marks"] rect').length > 0);
  return p;
}
const bars = (p) => p.evaluate(() => document.querySelectorAll('#app svg [data-bc-layer="marks"] rect').length);
/** Charts in the app: one marks layer each (a chart's tooltip has an <svg> of its own). */
const charts = (p) => p.evaluate(() => document.querySelectorAll('#app [data-bc-layer="marks"]').length);

for (const name of ['react', 'vue', 'svelte', 'element']) {
  test(`${name} in Chrome: draws, redraws only on a real change, clicks reach the app, and leaves nothing behind`, async () => {
    const p = await open(name);
    try {
      assert.strictEqual(await bars(p), 3);
      assert.strictEqual(await charts(p), 1, 'one chart (React draws twice in StrictMode, and cleans up the first)');
      // the same spec in a new object: the chart stays as it is (its element is the same one)
      await p.evaluate(() => (document.querySelector('#app [data-bc-layer="marks"]').ownerSVGElement.dataset.mark = 'kept'));
      await p.evaluate(() => window.t.update({ title: 'Sales', tick: 1 }));
      assert.strictEqual(
        await p.evaluate(() => document.querySelector('#app [data-bc-layer="marks"]').ownerSVGElement.dataset.mark),
        'kept',
      );
      // new rows and a new title: drawn again
      await p.evaluate((rows) => window.t.update({ rows }), ROWS4);
      await p.waitForFunction(() => document.querySelectorAll('#app svg [data-bc-layer="marks"] rect').length === 4);
      await p.evaluate(() => window.t.update({ title: 'Revenue' }));
      await p.waitForFunction(() => document.getElementById('app').textContent.includes('Revenue'));
      // a click on the second bar: the app gets its row; a click beside the bars does nothing
      const box = await p.evaluate(() => {
        const r = document.querySelectorAll('#app svg [data-bc-layer="marks"] rect')[1].getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right };
      });
      await p.mouse.move(box.x, box.y);
      const cursor = (x, y) => p.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [x, y]);
      assert.strictEqual(await cursor(box.x, box.y), 'pointer', 'a hand over the bar');
      await p.mouse.click(box.x, box.y);
      await p.mouse.click(box.right + 3, 5);
      assert.deepStrictEqual(await p.evaluate(() => window.clicks), [{ k: 'South', v: 58 }]);
      // the ref is the chart's view (a Svelte action has no ref)
      if (name !== 'svelte')
        assert.strictEqual(await p.evaluate(() => !!window.handle && !!window.handle.chart && window.handle.chart.diagnostics.length), 0);
      // unmounted: no chart, and no dataset of its own left in the lake (the one it draws now is there before)
      const own = () =>
        p.evaluate(() =>
          [1, 2, 3, 4, 5, 6, 7, 8].filter(
            (n) => !BC.validate({ data: 'bc:own:' + n, marks: [] }).some((d) => /is not in the data lake/.test(d.message)),
          ),
        );
      assert.strictEqual((await own()).length, 1, 'one dataset of its own while it lives, whatever it made before');
      await p.evaluate(() => window.t.update({ show: false }));
      await p.waitForFunction(() => !document.querySelector('#app svg'));
      assert.deepStrictEqual(await own(), [], 'every dataset it made is gone');
      assert.deepStrictEqual(p.errors, []);
    } finally {
      await p.close();
    }
  });
}

for (const name of ['react', 'vue', 'svelte', 'element']) {
  test(`${name} in Chrome: three charts, two from one dataset of the app; each its own clicks and redraws, one taken away alone`, async () => {
    const p = await open(`${name}-multi`);
    try {
      const marks = (n) => `#app [data-chart="${n}"] [data-bc-layer="marks"]`;
      await p.waitForFunction(() => document.querySelectorAll('#app [data-chart] [data-bc-layer="marks"]').length === 3);
      const barsOf = (n) => p.evaluate((sel) => document.querySelectorAll(`${sel} rect`).length, marks(n));
      assert.deepStrictEqual([await barsOf('a'), await barsOf('b'), await barsOf('c')], [3, 5, 5], 'a its own rows, b and c the shared');
      // b and c marked: a chart built again is a new <svg>, without the mark
      await p.evaluate(() => {
        for (const n of ['b', 'c'])
          document.querySelector(`#app [data-chart="${n}"] [data-bc-layer="marks"]`).ownerSVGElement.dataset.kept = n;
      });
      const kept = () => p.evaluate(() => [...document.querySelectorAll('#app svg[data-kept]')].map((s) => s.dataset.kept).join(','));
      const click = async (n, i) => {
        const box = await p.evaluate(
          ([sel, i]) => {
            const r = document.querySelectorAll(`${sel} rect`)[i];
            r.scrollIntoView({ block: 'center' });
            const b = r.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
          },
          [marks(n), i],
        );
        await p.mouse.move(box.x, box.y);
        await p.mouse.click(box.x, box.y);
      };
      await click('a', 1);
      await click('c', 3);
      await click('b', 0);
      assert.deepStrictEqual(
        await p.evaluate(() => window.clicks),
        ['a:South', 'c:Q4', 'b:Q1'],
        "each click reaches its own chart's handler",
      );

      await p.evaluate((rows) => window.t.update({ rows }), ROWS4);
      await p.waitForFunction((sel) => document.querySelectorAll(`${sel} rect`).length === 4, marks('a'));
      assert.strictEqual(await kept(), 'b,c', 'new rows for a: b and c are not built again');
      await p.evaluate(() => window.t.update({ title: 'Revenue' }));
      await p.waitForFunction(() => document.querySelector('#app [data-chart="a"]').textContent.includes('Revenue'));
      assert.strictEqual(await kept(), 'b,c', 'a new title for a: b and c are not built again');

      await p.evaluate(() => window.t.update({ b: false }));
      await p.waitForFunction(() => !document.querySelector('#app [data-chart="b"]'));
      assert.strictEqual(await charts(p), 2);
      assert.strictEqual(await kept(), 'c', 'b taken away: c stays as it was');
      await click('c', 0);
      assert.strictEqual(await p.evaluate(() => window.clicks.at(-1)), 'c:Q1', 'and still takes clicks');

      const inLake = (n) =>
        p.evaluate((n) => !BC.validate({ data: n, marks: [] }).some((d) => /is not in the data lake/.test(d.message)), n);
      const own = () =>
        p.evaluate(
          () =>
            [...Array(30).keys()].filter(
              (n) => !BC.validate({ data: 'bc:own:' + n, marks: [] }).some((d) => /is not in the data lake/.test(d.message)),
            ).length,
        );
      assert.strictEqual(await own(), 1, "chart a's own dataset, and no other");
      await p.evaluate(() => window.t.update({ show: false }));
      await p.waitForFunction(() => !document.querySelector('#app svg'));
      assert.strictEqual(await own(), 0, 'every dataset a chart made is gone');
      assert.strictEqual(await inLake('shared'), true, "the app's dataset stays: the app gave it, the app takes it away");
      assert.deepStrictEqual(p.errors, []);
    } finally {
      await p.close();
    }
  });
}

test('vue in Chrome: a reactive spec changed in place deep inside is drawn again', async () => {
  const p = await open('vue-reactive');
  try {
    const height = () =>
      p.evaluate(() => document.querySelector('#app [data-bc-layer="marks"]').ownerSVGElement.getBoundingClientRect().height);
    assert(Math.abs((await height()) - 260) < 2, String(await height()));
    await p.evaluate(() => window.t.shorter());
    await p.waitForFunction(
      () => document.querySelector('#app [data-bc-layer="marks"]').ownerSVGElement.getBoundingClientRect().height < 150,
    );
    assert.deepStrictEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test('element in Chrome: a spec in an attribute on a plain page, properties set before it is defined, and moved in the page', async () => {
  const at = path.join(dir, 'apps', 'element-plain');
  fs.mkdirSync(at, { recursive: true });
  const kitJs = fs.readFileSync(path.join(rel, 'kits', 'basic.js'), 'utf8');
  const elementJs = (
    await esbuild.build({
      entryPoints: [path.join(rel, 'frameworks', 'element.mjs')],
      bundle: true,
      write: false,
      format: 'iife',
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
  const spec = {
    data: 'sales',
    size: [400, 200],
    scales: { x: { type: 'band' }, y: { type: 'linear' } },
    marks: [{ type: 'rect', x: 'k', y: 'v' }],
  };
  const html = `<!doctype html><meta charset="utf-8"><body>
<script>${kitJs}</script>
<script>BC_DATA = ${JSON.stringify(ROWS3)}; BC.data('sales', BC_DATA);</script>
<div id="a"><block-chart id="one" spec='${JSON.stringify(spec)}'></block-chart></div>
<div id="b"></div>
<block-chart id="early"></block-chart>
<script>document.getElementById('early').spec = ${JSON.stringify({ ...spec, data: undefined })}; document.getElementById('early').data = ${JSON.stringify(ROWS4)};</script>
<script>${elementJs.replace(/<\/script/gi, '<\\/script')}</script>`;
  fs.writeFileSync(path.join(at, 'index.html'), html);
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await p.goto(pathToFileURL(path.join(at, 'index.html')).href);
    await p.waitForFunction(() => document.querySelectorAll('block-chart svg').length === 2);
    const counts = await p.evaluate(() =>
      ['one', 'early'].map((id) => document.querySelectorAll(`#${id} [data-bc-layer="marks"] rect`).length),
    );
    assert.deepStrictEqual(counts, [3, 4], 'the attribute spec, and the properties set before the element was defined');
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.getElementById('one')).display), 'block');
    assert(
      await p.evaluate(() => document.getElementById('one').getBoundingClientRect().width > 300),
      'laid out at the width of its block',
    );
    // moved: drawn again where it lands, one chart
    await p.evaluate(() => document.getElementById('b').appendChild(document.getElementById('one')));
    await p.waitForFunction(() => document.querySelectorAll('#b block-chart svg').length === 1);
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('#one svg').length), 1);
    // a broken attribute is a message, the chart as it was stays
    await p.evaluate(() => document.getElementById('one').setAttribute('spec', '{oops'));
    assert(
      errors.some((e) => /not valid JSON/.test(e)),
      errors.join('\n'),
    );
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('#one svg').length), 1);
  } finally {
    await p.close();
  }
});

test('click in Chrome: a canvas chart sends the row an SVG chart of the same spec sends, at the same place', async () => {
  const at = path.join(dir, 'apps', 'canvas-click');
  fs.mkdirSync(at, { recursive: true });
  const kitJs = fs.readFileSync(path.join(rel, 'kits', 'full.js'), 'utf8');
  const spec = {
    data: 'sales',
    size: [400, 220],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y' },
    ],
    marks: [{ type: 'rect', x: 'k', y: 'v' }],
    interaction: [{ type: 'click' }],
  };
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<div id="svg" style="width:400px"></div><div id="canvas" style="width:400px"></div>
<script>${kitJs}</script>
<script>
BC.data('sales', ${JSON.stringify(ROWS3)});
const spec = ${JSON.stringify(spec)};
BC.chart(document.getElementById('svg'), spec);
BC.chart(document.getElementById('canvas'), Object.assign({}, spec, { renderer: 'canvas' }));
window.got = [];
document.addEventListener('bc-click', (e) => got.push([e.target.closest('#svg, #canvas').id, e.detail.values]));
</script>`;
  fs.writeFileSync(path.join(at, 'index.html'), html);
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await p.goto(pathToFileURL(path.join(at, 'index.html')).href);
    await p.waitForFunction(() => document.querySelector('#canvas canvas') && document.querySelectorAll('#svg rect').length > 0);
    // where each bar is, relative to the SVG chart, and where the canvas chart starts
    const places = await p.evaluate(() => {
      const o = document.getElementById('svg').getBoundingClientRect();
      const c = document.getElementById('canvas').getBoundingClientRect();
      return {
        dy: c.y - o.y,
        dx: c.x - o.x,
        bars: Array.from(document.querySelectorAll('#svg [data-bc-layer="marks"] rect')).map((r) => {
          const b = r.getBoundingClientRect();
          return [b.x + b.width / 2, b.y + b.height / 2];
        }),
      };
    });
    assert.strictEqual(places.bars.length, 3);
    for (const [x, y] of places.bars) {
      await p.mouse.click(x, y);
      await p.mouse.move(x + places.dx, y + places.dy);
      assert.strictEqual(
        await p.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [x + places.dx, y + places.dy]),
        'pointer',
        'a hand over a bar of the canvas',
      );
      await p.mouse.click(x + places.dx, y + places.dy);
    }
    const got = await p.evaluate(() => window.got);
    assert.deepStrictEqual(
      got,
      ROWS3.flatMap((r) => [
        ['svg', r],
        ['canvas', r],
      ]),
    );
    assert.deepStrictEqual(errors, []);
  } finally {
    await p.close();
  }
});

test('Chrome: a wrapper on a page with no kit shows why in the chart, and the page goes on', async () => {
  const at = path.join(dir, 'apps', 'no-kit');
  fs.mkdirSync(at, { recursive: true });
  fs.writeFileSync(
    path.join(at, 'entry.mjs'),
    `import { blockchart } from '${slash(path.join(rel, 'frameworks', 'svelte.mjs'))}';
const node = document.getElementById('app');
blockchart(node, { spec: { marks: [] }, data: [] });
window.after = true;`,
  );
  const js = (
    await esbuild.build({ entryPoints: [path.join(at, 'entry.mjs')], bundle: true, write: false, format: 'iife', logLevel: 'silent' })
  ).outputFiles[0].text;
  fs.writeFileSync(path.join(at, 'index.html'), `<!doctype html><div id="app"></div><script>${js}</script>`);
  const p = await browser.newPage();
  const thrown = [];
  p.on('pageerror', (e) => thrown.push(String(e)));
  try {
    await p.goto(pathToFileURL(path.join(at, 'index.html')).href);
    assert.strictEqual(await p.evaluate(() => window.after), true);
    assert(/no runtime on the page/.test(await p.evaluate(() => document.getElementById('app').textContent)));
    assert.deepStrictEqual(thrown, []);
  } finally {
    await p.close();
  }
});

let running = null;
process.on('exit', () => {
  if (running === null) return;
  console.log(`\nFAIL ${running}: never finished (it threw outside its promise, or waits on one that never settles)`);
  process.exitCode = 1;
});

(async () => {
  let passed = 0;
  let failed = 0;
  try {
    for (const [name, fn] of tests) {
      running = name;
      if (!browser && /Chrome/.test(name)) browser = await chromium.launch({ channel: 'chrome' });
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
  } finally {
    running = null;
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
