// blockcharts in apps made with the real toolchains (test/apps): Vite with React and with Vue (single-file components),
// SvelteKit (prerendered, hydrated), Next.js (App Router, rendered on the server, hydrated), Angular CLI (<block-chart>),
// and plain JavaScript. The package is the one `npm pack` makes, put into test/apps/node_modules as npm installs it.
//
// Each app is built for production by its own CLI and checked in Chrome on the same page of three charts (one with its
// own rows, two sharing a dataset of the app): every chart drawn, a click reaching the handler of the chart clicked, new
// rows and a new title drawing that chart again and only it, one chart taken away leaving the others as they were, and
// nothing left in the lake when they all go; no error or warning in the console, hydration ones included. The same
// checks run on each app's dev server (React in StrictMode there). Then every chart of every recipe of the skill is
// drawn by each app, and measured: mounting, new data for all, unmounting, the heap and the DOM after (leaks).
//
// Run: npm ci --prefix test/apps, then npm run test:apps
//   node scripts/test-apps.js [react vue svelte next angular vanilla] [--no-pack] [--no-dev] [--no-perf] [--copies=1,5]
// --no-pack keeps the package installed by the last run. The measures are printed as a table and written to
// test/apps/out/measures.json (and to the job summary on GitHub Actions).
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { gunzipSync } = require('fflate');
const { chromium } = require('playwright-core');
const { compose, resolveDataset } = require('./compose.js');

const repo = path.join(__dirname, '..');
const appsDir = path.join(repo, 'test', 'apps');
const modules = path.join(appsDir, 'node_modules');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};

/** Each app: how its CLI builds it and serves it in development, where the build lands, and where its pages are. */
const BIN = { vite: 'vite/bin/vite.js', next: 'next/dist/bin/next', ng: '@angular/cli/bin/ng.js' };
const APPS = {
  react: { build: ['vite', 'build'], out: 'dist', dev: ['vite', '--port', '{port}', '--strictPort'], all: '/?all' },
  vue: { build: ['vite', 'build'], out: 'dist', dev: ['vite', '--port', '{port}', '--strictPort'], all: '/?all' },
  svelte: { build: ['vite', 'build'], out: 'build', ssr: true, dev: ['vite', 'dev', '--port', '{port}', '--strictPort'], all: '/all' },
  next: { build: ['next', 'build'], out: 'out', ssr: true, dev: ['next', 'dev', '--port', '{port}'], all: '/all' },
  angular: { build: ['ng', 'build'], out: path.join('dist', 'browser'), dev: ['ng', 'serve', '--port', '{port}'], all: '/?all' },
  vanilla: { build: ['vite', 'build'], out: 'dist', dev: ['vite', '--port', '{port}', '--strictPort'], all: '/?all' },
};
const chosen = args.filter((a) => !a.startsWith('--'));
for (const a of chosen) if (!APPS[a]) throw new Error(`no app "${a}" (${Object.keys(APPS).join(', ')})`);
const apps = chosen.length ? chosen : Object.keys(APPS);
/** Mount, new data, unmount: how many times, for the medians and for what each cycle leaves behind. */
const cycles = Math.max(2, Number(option('cycles', '3')) || 3);
const copiesList = option('copies', '1,5')
  .split(',')
  .map(Number)
  .filter((n) => n >= 1);

const ENV = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0', NO_COLOR: '1' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-apps-'));

// ───────────── the package, as npm installs it ─────────────

/** `npm pack` of the repository (its prepack builds the release): the tarball's path. */
function pack() {
  const dest = path.join(tmp, 'pack');
  fs.mkdirSync(dest);
  const npmCli = process.env.npm_execpath && /npm-cli\.js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : null;
  const out = npmCli
    ? spawnSync(process.execPath, [npmCli, 'pack', '--pack-destination', dest], { cwd: repo, encoding: 'utf8', env: ENV })
    : spawnSync(`npm pack --pack-destination "${dest}"`, { cwd: repo, encoding: 'utf8', env: ENV, shell: true });
  if (out.status !== 0) throw new Error(`npm pack failed:\n${out.stdout}\n${out.stderr}`);
  const tgz = fs.readdirSync(dest).filter((f) => f.endsWith('.tgz'));
  assert.strictEqual(tgz.length, 1, `npm pack made ${tgz.join(', ') || 'nothing'}`);
  return path.join(dest, tgz[0]);
}

/** A package tarball unpacked into `into`, as npm does for a package with no dependencies and no scripts. */
function untar(tgz, into) {
  const buf = Buffer.from(gunzipSync(fs.readFileSync(tgz)));
  let at = 0;
  let longName = null;
  let files = 0;
  while (at + 512 <= buf.length) {
    const head = buf.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const str = (o, n) =>
      head
        .subarray(o, o + n)
        .toString('utf8')
        .replace(/\0[\s\S]*$/, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = head[156] ? String.fromCharCode(head[156]) : '0';
    const prefix = str(345, 155);
    let name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const body = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (longName) {
      name = longName;
      longName = null;
    }
    if (type !== '0') continue; // folders come with their files
    const rel = name.replace(/^package\//, '');
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error(`a path out of the package: ${name}`);
    const file = path.join(into, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    files++;
  }
  return files;
}

// ───────────── every chart of every recipe ─────────────

/** { lake, charts }: each recipe's datasets under "<recipe>:<name>", and each chart its composed page shows (a facet's
 *  panels each), its spec naming its dataset so. */
function allFixture() {
  const dir = path.join(repo, 'skills', 'blockcharts', 'recipes');
  const lake = {};
  const charts = [];
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const name = f.slice(0, -5);
    const page = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [d, input] of Object.entries(page.data)) lake[`${name}:${d}`] = resolveDataset(d, input, dir);
    compose({ ...page, baseDir: dir }).entries.forEach((e, i) => {
      const specs = e.panels ? e.panels.map((p) => p.spec) : e.spec ? [e.spec] : [];
      specs.forEach((spec, k) => {
        assert(typeof spec.data === 'string', `${name}: chart ${i} names no dataset`);
        charts.push({ id: `${name}#${i}${specs.length > 1 ? '.' + k : ''}`, spec: { ...spec, data: `${name}:${spec.data}` } });
      });
    });
  }
  return { lake, charts };
}

// ───────────── building and serving ─────────────

/** A CLI of test/apps/node_modules, run in an app's folder. */
function cli(app, command, options = {}) {
  const [bin, ...rest] = command;
  return [process.execPath, [path.join(modules, BIN[bin]), ...rest], { cwd: path.join(appsDir, app), env: ENV, ...options }];
}

function build(app) {
  const out = path.join(appsDir, app, APPS[app].out);
  fs.rmSync(out, { recursive: true, force: true });
  const [cmd, argv, opts] = cli(app, APPS[app].build);
  const t0 = Date.now();
  const run = spawnSync(cmd, argv, { ...opts, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = `${run.stdout || ''}\n${run.stderr || ''}`;
  fs.writeFileSync(path.join(tmp, `${app}-build.log`), log);
  if (run.status !== 0 || !fs.existsSync(path.join(out, 'index.html')))
    throw new Error(`${app}: the build failed (exit ${run.status})\n${log.split('\n').slice(-40).join('\n')}`);
  return { seconds: (Date.now() - t0) / 1000, log };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** A static server of a build, as a host serves it: a path, its index.html, its .html, or the app's index.html (an app
 *  that routes in the browser); /fixtures/ is the test's. */
function serve(root, fixtures) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const base = url.startsWith('/fixtures/') ? fixtures : root;
    const rel = url.startsWith('/fixtures/') ? url.slice('/fixtures'.length) : url;
    const at = path.join(base, rel);
    if (!at.startsWith(base)) return res.writeHead(403).end();
    const tries = [at, path.join(at, 'index.html'), at.replace(/[\\/]$/, '') + '.html'];
    let file = tries.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file && !path.extname(rel) && base === root) file = path.join(root, 'index.html');
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const get = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(30000, () => req.destroy());
  });

/** The app's dev server, ready: { url, stop() }. */
async function devServer(app) {
  const port = await freePort();
  const [cmd, argv, opts] = cli(
    app,
    APPS[app].dev.map((a) => (a === '{port}' ? String(port) : a)),
  );
  const child = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const stop = () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  };
  const url = `http://localhost:${port}`;
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    if (child.exitCode !== null) break;
    if ((await get(url + '/')).status === 200) return { url, stop, log: () => log };
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`${app}: the dev server did not answer at ${url}\n${log.split('\n').slice(-30).join('\n')}`);
}

// ───────────── in Chrome ─────────────

/** What a page says in its console that a working app never says: errors and warnings, and what it throws. */
function watch(p) {
  const said = [];
  p.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const where = m.location().url || '';
    // a browser asks every site for its icon; these apps have none
    if (/\/favicon\.ico$/.test(where)) return;
    said.push(`${m.type()}: ${m.text()}${where ? ` (${where})` : ''}`);
  });
  p.on('pageerror', (e) => said.push(`thrown: ${e.message}`));
  return said;
}

/** The checks on the page of three charts (test/apps/shared/smoke.js). */
async function smoke(browser, url, app) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const said = watch(p);
  try {
    await p.goto(url, { waitUntil: 'load', timeout: 120000 });
    const marks = (name) => `[data-chart="${name}"] [data-bc-layer="marks"]`;
    const count = () => p.evaluate(() => document.querySelectorAll('[data-chart] [data-bc-layer="marks"]').length);
    await p.waitForFunction(() => document.querySelectorAll('[data-chart] [data-bc-layer="marks"]').length === 3, null, {
      timeout: 60000,
    });
    const bars = (name) => p.evaluate((sel) => document.querySelectorAll(`${sel} rect`).length, marks(name));
    assert.deepStrictEqual([await bars('a'), await bars('b'), await bars('c')], [3, 5, 5], 'chart a its own rows, b and c the shared');

    // the drawings of b and c, marked: one that is built again is a new element, without the mark
    await p.evaluate(() => {
      for (const n of ['b', 'c']) document.querySelector(`[data-chart="${n}"] [data-bc-layer="marks"]`).ownerSVGElement.dataset.kept = n;
    });
    const kept = () => p.evaluate(() => [...document.querySelectorAll('[data-chart] svg[data-kept]')].map((s) => s.dataset.kept).join(','));

    const click = async (name, i) => {
      const box = await p.evaluate(
        ([sel, i]) => {
          const r = document.querySelectorAll(`${sel} rect`)[i];
          r.scrollIntoView({ block: 'center' });
          const b = r.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        },
        [marks(name), i],
      );
      const before = await p.evaluate(() => document.getElementById('picked').textContent);
      await p.mouse.move(box.x, box.y);
      await p.mouse.click(box.x, box.y);
      // the handler sets the app's state; the framework renders it when it renders (React: not at once)
      await p
        .waitForFunction((before) => document.getElementById('picked').textContent !== before, before, { timeout: 5000 })
        .catch(() => {});
      return p.evaluate(() => document.getElementById('picked').textContent);
    };
    assert.strictEqual(await click('a', 1), 'a:South', 'a click on the second bar of a');
    assert.strictEqual(await click('c', 3), 'c:Q4', 'a click on c reaches the handler of c, not of b');
    assert.strictEqual(await click('b', 0), 'b:Q1');

    await p.click('#update');
    await p.waitForFunction((sel) => document.querySelectorAll(`${sel} rect`).length === 4, marks('a'));
    assert.strictEqual(await kept(), 'b,c', 'new rows for a: b and c are not built again');
    await p.click('#retitle');
    await p.waitForFunction(() => document.querySelector('[data-chart="a"]').textContent.includes('Revenue'));
    assert.strictEqual(await kept(), 'b,c', 'a new title for a: b and c are not built again');

    await p.click('#remove-b');
    await p.waitForFunction(() => !document.querySelector('[data-chart="b"]'));
    assert.strictEqual(await count(), 2);
    assert.strictEqual(await kept(), 'c', 'b taken away: c stays as it was');
    assert.strictEqual(await click('c', 0), 'c:Q1', 'and still takes clicks');
    assert.strictEqual(await bars('a'), 4);

    // datasets a component made for its own data (bc:own:N): one while chart a lives, none after
    const own = () =>
      p.evaluate(() => {
        const left = [];
        for (let n = 1; n <= 50; n++)
          if (!BC.validate({ data: `bc:own:${n}`, marks: [] }).some((d) => /is not in the data lake/.test(d.message))) left.push(n);
        return left.length;
      });
    const shared = () =>
      p.evaluate(() => !BC.validate({ data: 'smoke:shared', marks: [] }).some((d) => /is not in the data lake/.test(d.message)));
    assert.strictEqual(await own(), app === 'vanilla' ? 0 : 1, 'the own dataset of chart a, and no other');
    await p.click('#hide');
    await p.waitForFunction(() => !document.querySelector('[data-chart]'));
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('main svg').length), 0, 'no drawing left (a tooltip neither)');
    assert.strictEqual(await own(), 0, 'every dataset a component made is gone');
    assert.strictEqual(await shared(), true, "the app's own dataset stays: the app gave it, the app takes it away");
    assert.deepStrictEqual(said, [], 'nothing in the console');
  } finally {
    await p.close();
  }
}

/** The server's HTML of the smoke page: the three chart elements are there, empty, for the browser to draw in. */
async function serverHtml(url) {
  const { status, body } = await get(url);
  assert.strictEqual(status, 200);
  for (const n of ['a', 'b', 'c']) assert(body.includes(`data-chart="${n}"`), `the server rendered chart ${n}'s element`);
  assert(!/data-bc-layer|<svg/.test(body), 'and drew nothing in it');
  assert(body.includes('id="picked"'));
}

const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

/** Every chart of every recipe, `copies` times: mounted, given new data and unmounted, three times; the medians. */
async function measure(browser, url, copies) {
  const p = await browser.newPage({ viewport: { width: 1320, height: 900 } });
  const said = watch(p);
  const scripts = [];
  p.on('response', async (r) => {
    if (r.request().resourceType() !== 'script') return;
    try {
      const body = await r.body();
      scripts.push({ url: r.url(), bytes: body.length, gzip: gzip(body) });
    } catch (e) {
      // a response that has no body (a redirect) is not code
    }
  });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const gc = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
  };
  try {
    await p.goto(url + (copies > 1 ? `${url.includes('?') ? '&' : '?'}copies=${copies}` : ''), { waitUntil: 'load', timeout: 120000 });
    await p.waitForSelector('#mount', { timeout: 60000 });
    const n = await p.evaluate(() => window.allCharts);
    // in the page: click, then wait frame by frame until the charts are as asked; the milliseconds that took
    const phase = async (button, until) => {
      const before = await metrics();
      const wall = await p.evaluate(
        ([button, until, n]) => {
          const cells = () => document.querySelectorAll('#all .cell');
          const drawn = (cell) => cell.querySelector('svg, canvas') && !cell.querySelector('.bc-loading');
          const checks = {
            drawn: () => cells().length === n && [...cells()].every(drawn),
            redrawn: () => cells().length === n && [...cells()].every((c) => drawn(c) && !c.querySelector('svg, canvas').bcOld),
            gone: () => cells().length === 0,
          };
          if (until === 'redrawn') for (const el of document.querySelectorAll('#all .cell svg, #all .cell canvas')) el.bcOld = true;
          const t0 = performance.now();
          document.querySelector(button).click();
          return new Promise((resolve, reject) => {
            const limit = t0 + 60000;
            const tick = () => {
              if (checks[until]()) resolve(performance.now() - t0);
              else if (performance.now() > limit) reject(new Error(`${button}: not ${until} after 60 s`));
              else requestAnimationFrame(tick);
            };
            tick();
          });
        },
        [button, until, n],
      );
      const after = await metrics();
      return {
        wall,
        cpu: (after.TaskDuration - before.TaskDuration) * 1000,
        script: (after.ScriptDuration - before.ScriptDuration) * 1000,
      };
    };
    await gc();
    const base = await metrics();
    const runs = [];
    for (let i = 0; i < cycles; i++) {
      const mount = await phase('#mount', 'drawn');
      await gc();
      const live = await metrics();
      const update = await phase('#update', 'redrawn');
      const unmount = await phase('#unmount', 'gone');
      await gc();
      const after = await metrics();
      runs.push({ mount, update, unmount, live, after });
    }
    // datasets the components made for their own data: none may be left
    const own = await p.evaluate(
      (last) => {
        let left = 0;
        for (let k = 1; k <= last; k++)
          if (!BC.validate({ data: `bc:own:${k}`, marks: [] }).some((d) => /is not in the data lake/.test(d.message))) left++;
        return left;
      },
      n * (cycles + 2) * 2 + 50,
    );
    const median = (pick) => runs.map(pick).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    const last = runs[runs.length - 1].after;
    return {
      charts: n,
      js: scripts.reduce((s, x) => s + x.bytes, 0),
      jsGzip: scripts.reduce((s, x) => s + x.gzip, 0),
      mount: { wall: median((r) => r.mount.wall), cpu: median((r) => r.mount.cpu) },
      update: { wall: median((r) => r.update.wall), cpu: median((r) => r.update.cpu) },
      unmount: { wall: median((r) => r.unmount.wall), cpu: median((r) => r.unmount.cpu) },
      heapLive: median((r) => r.live.JSHeapUsedSize - base.JSHeapUsedSize),
      nodesLive: median((r) => r.live.Nodes - base.Nodes),
      heapLeft: last.JSHeapUsedSize - base.JSHeapUsedSize,
      // what each cycle after the first adds to the heap, per chart: the first warms up (compiled code, caches) and
      // adds what it adds once; a chart or a dataset kept by something would add its share every time
      heapPerChart: (last.JSHeapUsedSize - runs[0].after.JSHeapUsedSize) / (runs.length - 1) / n,
      heapAfter: runs.map((r) => r.after.JSHeapUsedSize - base.JSHeapUsedSize),
      nodesLeft: last.Nodes - base.Nodes,
      listenersLeft: last.JSEventListeners - base.JSEventListeners,
      own,
      said,
    };
  } finally {
    await p.close();
  }
}

// ───────────── the run ─────────────

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const results = {};

let fixturesDir;
let browser;
const servers = {};

test('the package: npm pack, unpacked into test/apps/node_modules', () => {
  const into = path.join(modules, 'blockcharts');
  if (flag('no-pack')) {
    assert(fs.existsSync(path.join(into, 'package.json')), 'no package installed yet: run without --no-pack');
    return;
  }
  const tgz = pack();
  fs.rmSync(into, { recursive: true, force: true });
  const files = untar(tgz, into);
  const pkg = JSON.parse(fs.readFileSync(path.join(into, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, require('../package.json').version);
  for (const sub of ['react', 'vue', 'svelte', 'element']) assert(pkg.exports[`./${sub}`], `exports ./${sub}`);
  console.log(`     ${path.basename(tgz)}: ${files} files`);
});

test('every chart of every recipe, as one fixture', () => {
  fixturesDir = path.join(tmp, 'fixtures');
  fs.mkdirSync(fixturesDir);
  const all = allFixture();
  assert(all.charts.length > 50, `${all.charts.length} charts`);
  fs.writeFileSync(path.join(fixturesDir, 'all.json'), JSON.stringify(all));
  console.log(`     ${all.charts.length} charts, ${Object.keys(all.lake).length} datasets`);
});

for (const app of apps) {
  test(`${app}: the production build of its own CLI`, () => {
    const { seconds } = build(app);
    console.log(`     ${seconds.toFixed(1)} s`);
  });
  if (APPS[app].ssr)
    test(`${app}: the server's HTML has the charts' elements, empty`, async () => {
      servers[app] = servers[app] || (await serve(path.join(appsDir, app, APPS[app].out), fixturesDir));
      await serverHtml(`http://127.0.0.1:${servers[app].address().port}/`);
    });
  test(`${app} in Chrome: three charts, clicks to the right one, one redrawn alone, one taken away, nothing left`, async () => {
    servers[app] = servers[app] || (await serve(path.join(appsDir, app, APPS[app].out), fixturesDir));
    await smoke(browser, `http://127.0.0.1:${servers[app].address().port}/`, app);
  });
  if (!flag('no-dev'))
    test(`${app} on its dev server: the same checks`, async () => {
      const dev = await devServer(app);
      try {
        await smoke(browser, dev.url + '/', app);
      } catch (e) {
        e.message += `\n--- the dev server said:\n${dev.log().split('\n').slice(-20).join('\n')}`;
        throw e;
      } finally {
        dev.stop();
      }
    });
  if (!flag('no-perf'))
    for (const copies of copiesList)
      test(`${app} in Chrome: every chart of every recipe${copies > 1 ? ` ×${copies}` : ''}, measured`, async () => {
        servers[app] = servers[app] || (await serve(path.join(appsDir, app, APPS[app].out), fixturesDir));
        const m = await measure(browser, `http://127.0.0.1:${servers[app].address().port}${APPS[app].all}`, copies);
        (results[copies] = results[copies] || {})[app] = m;
        assert.strictEqual(m.own, 0, 'datasets the components made are all gone');
        assert(m.listenersLeft <= 5, `${m.listenersLeft} event listeners more than before the charts`);
        assert(m.nodesLeft <= 20, `${m.nodesLeft} DOM nodes more than before the charts, after they all went`);
        // a chart drawn holds 60 to 90 KB of heap: one kept after it went adds that much every cycle; warming up adds a
        // few hundred KB in all, whatever the number of charts (4 KB a chart for 71 of them)
        assert(m.heapPerChart < 16384, `the heap grows by ${Math.round(m.heapPerChart)} bytes per chart with every cycle`);
        assert.deepStrictEqual(m.said, [], 'nothing in the console');
      });
}

const ms = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString();
const mb = (v) => (v / 1048576).toFixed(1);
const kb = (v) => (v / 1024).toFixed(0);

/** The measures as a Markdown table, one per number of charts. */
function table() {
  const lines = [];
  for (const [copies, byApp] of Object.entries(results)) {
    const n = Object.values(byApp)[0].charts;
    lines.push(
      `\n### ${n} charts${copies > 1 ? ` (every recipe ×${copies})` : ' (every recipe)'}: Chrome, production builds, median of ${cycles}\n`,
    );
    lines.push(
      '| app | JS loaded, KB gzip | mount, ms (CPU) | new data, ms (CPU) | unmount, ms (CPU) | heap of the charts, MB | DOM nodes | heap after, MB | per cycle, B/chart | nodes left | listeners left |',
    );
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const [app, m] of Object.entries(byApp))
      lines.push(
        `| ${app} | ${kb(m.jsGzip)} | ${ms(m.mount.wall)} (${ms(m.mount.cpu)}) | ${ms(m.update.wall)} (${ms(m.update.cpu)}) | ` +
          `${ms(m.unmount.wall)} (${ms(m.unmount.cpu)}) | ${mb(m.heapLive)} | ${m.nodesLive} | ${mb(m.heapLeft)} | ${Math.round(m.heapPerChart)} | ${m.nodesLeft} | ${m.listenersLeft} |`,
      );
  }
  return lines.join('\n');
}

let running = null;
process.on('exit', () => {
  if (running === null) return;
  console.log(`\nFAIL ${running}: never finished`);
  process.exitCode = 1;
});

(async () => {
  if (!fs.existsSync(path.join(modules, 'vite', 'package.json'))) {
    console.log('test/apps has no node_modules: run npm ci --prefix test/apps first');
    process.exitCode = 1;
    return;
  }
  let passed = 0;
  let failed = 0;
  const failedBuilds = new Set();
  try {
    for (const [name, fn] of tests) {
      running = name;
      const app = name.split(/[ :]/)[0];
      if (failedBuilds.has(app)) {
        failed++;
        console.log('FAIL', name, '(its build failed)');
        continue;
      }
      if (!browser && /Chrome|dev server/.test(name)) browser = await chromium.launch({ channel: 'chrome' });
      try {
        await fn();
        passed++;
        console.log('ok  ', name);
      } catch (e) {
        failed++;
        if (/production build/.test(name)) failedBuilds.add(app);
        console.log('FAIL', name);
        console.error(e);
        process.exitCode = 1;
      }
    }
  } finally {
    running = null;
    if (browser) await browser.close();
    for (const s of Object.values(servers)) s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (Object.keys(results).length) {
    const md = table();
    console.log(md);
    fs.mkdirSync(path.join(appsDir, 'out'), { recursive: true });
    fs.writeFileSync(path.join(appsDir, 'out', 'measures.json'), JSON.stringify(results, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## blockcharts in apps\n${md}\n`);
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
