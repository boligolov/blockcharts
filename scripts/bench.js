// How long blockcharts and other chart libraries take to draw the same charts, in Chrome (playwright-core, channel
// "chrome"). test/bench has one page per library: bars over 12 categories and a line of 200 points, alternating, each
// 360 × 200 with axes and a tooltip, no animation (test/bench/common.js). blockcharts is the basic kit of the release this
// script builds; the others are the versions test/bench/package.json pins. Each page is bundled by esbuild as an app's
// production build would be (minified, NODE_ENV=production) and its JS measured gzipped.
//
// One run: a fresh page, the library loaded, a GC, then n charts drawn into cells laid out beforehand; the clock stops
// once the frame that shows them has been painted. Measured: that time, the main thread's busy time over it (CDP
// TaskDuration), and after a GC the heap and the DOM nodes the charts hold. Every run must draw all n charts with
// nothing in the console. Runs go in rounds: each round measures every library at every n once, in an order shuffled
// for that round (seeded), so that what the machine does meanwhile falls on all of them alike.
//
// Run: npm ci --prefix test/bench, then npm run bench
//   node scripts/bench.js [blockcharts chartjs echarts uplot plot recharts apexcharts plotly] [--runs=30] [--n=1,20,355]
//                         [--cpu=4] [--seed=1] [--save]
//   node scripts/bench.js --resave [--cpu=4]
// --cpu slows Chrome's CPU down that many times (as DevTools does), roughly a phone. The table (medians and quartiles)
// is printed, written to test/bench/out/results.md and the job summary on GitHub Actions; every run, with the machine,
// Chrome and the versions, to test/bench/out/results.json; a screenshot of each library's 20 charts to test/bench/out/shots
// (results-cpu4.md, results-cpu4.json and shots-cpu4 with --cpu=4).
// --save also writes the medians, quartiles and every run's time to test/bench/results.json (results-cpu4.json): the
// figures in the repository, which the site's /benchmarks/ page shows. --resave writes them from the last run's
// out/results.json without measuring again.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');
const { buildRelease } = require('./build-dist.js');

const repo = path.join(__dirname, '..');
const benchDir = path.join(repo, 'test', 'bench');
const outDir = path.join(benchDir, 'out');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};

/** Each library: the package whose version the table names, its name there, what it draws in, and how its page sets it
 *  up beyond the charts every page draws (test/bench/<library>.js). */
const LIBS = {
  blockcharts: { pkg: null, name: 'blockcharts', draws: 'SVG', setup: 'the basic kit; each chart’s rows given to the lake' },
  chartjs: { pkg: 'chart.js', name: 'Chart.js', draws: 'canvas', setup: 'chart.js/auto; not responsive' },
  echarts: { pkg: 'echarts', name: 'ECharts', draws: 'canvas', setup: 'only the modules these charts use; the tooltip on the axis' },
  uplot: { pkg: 'uplot', name: 'uPlot', draws: 'canvas', setup: 'its stylesheet; no tooltip in uPlot, its cursor stays on' },
  plot: { pkg: '@observablehq/plot', name: 'Observable Plot', draws: 'SVG', setup: 'tip: true; it orders the bars by name' },
  recharts: { pkg: 'recharts', name: 'Recharts', draws: 'SVG', setup: 'React 19, all the charts in one root' },
  apexcharts: { pkg: 'apexcharts', name: 'ApexCharts', draws: 'SVG', setup: 'toolbar and zoom off' },
  plotly: { pkg: 'plotly.js-dist-min', name: 'Plotly', draws: 'SVG', setup: 'the mode bar off' },
};
const chosen = args.filter((a) => !a.startsWith('--'));
for (const a of chosen) if (!LIBS[a]) throw new Error(`no library "${a}" (${Object.keys(LIBS).join(', ')})`);
const libs = chosen.length ? chosen : Object.keys(LIBS);
const runs = Math.max(1, Number(option('runs', '30')) || 30);
const ns = option('n', '1,20,355')
  .split(',')
  .map(Number)
  .filter((n) => n >= 1);
const cpuRate = Math.max(1, Number(option('cpu', '1')) || 1);
const seed = Number(option('seed', '1')) || 1;
/** What this run's files are called after: nothing, or the CPU slowdown. */
const suffix = cpuRate > 1 ? `-cpu${cpuRate}` : '';
const shotsDir = path.join(outDir, `shots${suffix}`);
/** The n whose first run is photographed: 20, or the nearest asked for. */
const shotN = ns.reduce((a, b) => (Math.abs(b - 20) < Math.abs(a - 20) ? b : a));

if (!fs.existsSync(path.join(benchDir, 'node_modules')))
  throw new Error('the libraries are not installed: npm ci --prefix test/bench (from the root), then npm run bench');

/** A small seeded generator (mulberry32), so that a seed gives the same orders again. */
function random(s) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The q-quantile of numbers, interpolated between the two nearest. */
function quantile(values, q) {
  const a = values.slice().sort((x, y) => x - y);
  const at = (a.length - 1) * q;
  const lo = Math.floor(at);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (at - lo);
}

function versionOf(lib) {
  if (!LIBS[lib].pkg) return JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  return JSON.parse(fs.readFileSync(path.join(benchDir, 'node_modules', LIBS[lib].pkg, 'package.json'), 'utf8')).version;
}

/** Bundles a library's page as a production build and writes it to out/pages: one HTML file, its script inline. */
async function page(lib, rel) {
  const built = await esbuild.build({
    entryPoints: [path.join(benchDir, `${lib}.js`)],
    bundle: true,
    minify: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    alias: { blockcharts: rel },
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'text' },
    logLevel: 'silent',
  });
  const js = Buffer.from(built.outputFiles[0].contents);
  const file = path.join(outDir, 'pages', `${lib}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const script = js.toString('utf8').replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync(
    file,
    '<!doctype html><meta charset="utf-8"><style>body{margin:0;font:12px system-ui}' +
      '#grid{display:flex;flex-wrap:wrap;width:1480px}.cell{width:360px;height:200px;overflow:hidden}</style>' +
      `<div id="grid"></div><script>${script}</script>`,
  );
  return { url: 'file:///' + file.split(path.sep).join('/'), gzip: zlib.gzipSync(js, { level: 9 }).length };
}

/** One run of a library at n charts, in a page of its own. */
async function measure(browser, lib, url, n, shot) {
  const p = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const said = [];
  p.on('console', (m) => m.type() === 'error' && said.push(m.text().slice(0, 200)));
  p.on('pageerror', (e) => said.push(String(e).slice(0, 200)));
  try {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await p.goto(url);
    await p.waitForFunction(() => window.ready === true);
    if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await cdp.send('HeapProfiler.collectGarbage');
    const m0 = await metrics();
    const { ms, drawn } = await p.evaluate((count) => window.run(count), n);
    const m1 = await metrics();
    await cdp.send('HeapProfiler.collectGarbage');
    const m2 = await metrics();
    if (shot) await p.screenshot({ path: path.join(shotsDir, `${lib}.png`), clip: { x: 0, y: 0, width: 1480, height: 420 } });
    if (drawn !== n) said.push(`${drawn} of ${n} charts drawn`);
    return {
      ms,
      cpu: (m1.TaskDuration - m0.TaskDuration) * 1000,
      heap: m2.JSHeapUsedSize - m0.JSHeapUsedSize,
      nodes: m2.Nodes - m0.Nodes,
      said,
    };
  } finally {
    await p.close();
  }
}

const fmt = (x, digits = 0) => x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The table: one block per n, the libraries from the fastest, each with its median, quartiles and ratio to blockcharts. */
function table(summary, meta) {
  const lines = [];
  lines.push(
    `${meta.runs} runs of each library at each n, ${meta.date}; Chrome ${meta.chrome}` +
      (meta.cpu > 1 ? `, CPU slowed ${meta.cpu}×` : '') +
      `; ${meta.machine.cpu} (${meta.machine.cores} threads), ${meta.machine.ram} GB, ${meta.machine.os}.`,
  );
  for (const n of meta.ns) {
    const rows = summary.filter((s) => s.n === n).sort((a, b) => a.ms.median - b.ms.median);
    const base = rows.find((r) => r.lib === 'blockcharts');
    lines.push('', `**${n} chart${n === 1 ? '' : 's'}**`, '');
    lines.push(
      '| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |',
    );
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of rows)
      lines.push(
        `| ${LIBS[r.lib].name} | ${meta.versions[r.lib]} | ${fmt(r.ms.median, r.ms.median < 100 ? 1 : 0)} | ` +
          `${fmt(r.ms.q1, r.ms.q1 < 100 ? 1 : 0)}–${fmt(r.ms.q3, r.ms.q3 < 100 ? 1 : 0)} | ${fmt(r.ms.median / n, 2)} | ` +
          `${base ? fmt(r.ms.median / base.ms.median, 1) : ''} | ${fmt(r.cpu, r.cpu < 100 ? 1 : 0)} | ${fmt(r.heap / 1048576, 1)} | ` +
          `${fmt(r.nodes)} | ${fmt(meta.gzip[r.lib] / 1024)} |`,
      );
  }
  return lines.join('\n');
}

/** What the repository keeps of a run: the machine and versions, and for each library at each n its medians, quartiles
 *  and every run's time (a tenth of a ms), not the rest of each run. One result a line, so a new run diffs readably. */
function snapshot({ meta, summary, runs: all }) {
  const results = summary.map((s) => ({
    ...s,
    samples: all.filter((r) => r.lib === s.lib && r.n === s.n).map((r) => Math.round(r.ms * 10) / 10),
  }));
  const libraries = Object.fromEntries(
    Object.keys(meta.versions).map((l) => [l, { name: LIBS[l].name, draws: LIBS[l].draws, setup: LIBS[l].setup }]),
  );
  const lines = results.map((r) => '  ' + JSON.stringify(r));
  return ['{', ` "meta": ${JSON.stringify({ ...meta, libraries })},`, ' "results": [', lines.join(',\n'), ' ]', '}', ''].join('\n');
}
const saved = path.join(benchDir, `results${suffix}.json`);

if (args.includes('--resave')) {
  const last = path.join(outDir, `results${suffix}.json`);
  if (!fs.existsSync(last)) throw new Error(`no ${path.relative(repo, last)}: run the bench first`);
  fs.writeFileSync(saved, snapshot(JSON.parse(fs.readFileSync(last, 'utf8'))));
  console.log(`written: ${path.relative(repo, saved)}`);
  process.exit(0);
}

(async () => {
  const started = Date.now();
  const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));
  const rel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-bench-')), 'release');
  buildRelease({ distDir: path.join(repo, 'dist'), outDir: rel, kits });
  fs.rmSync(shotsDir, { recursive: true, force: true });
  fs.mkdirSync(shotsDir, { recursive: true });

  const pages = {};
  for (const lib of libs) pages[lib] = await page(lib, rel);
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  const problems = [];
  try {
    const meta = {
      date: new Date().toISOString().slice(0, 10),
      runs,
      ns,
      cpu: cpuRate,
      seed,
      chrome: browser.version(),
      machine: {
        cpu: os.cpus()[0].model.trim().replace(/\s+/g, ' '),
        cores: os.cpus().length,
        ram: Math.round(os.totalmem() / 2 ** 30),
        os: `${os.type()} ${os.release()}`,
      },
      versions: Object.fromEntries(libs.map((l) => [l, versionOf(l)])),
      gzip: Object.fromEntries(libs.map((l) => [l, pages[l].gzip])),
    };
    const jobs = ns.flatMap((n) => libs.map((lib) => ({ lib, n })));
    const rnd = random(seed);
    for (let round = 0; round < runs; round++) {
      for (const { lib, n } of shuffle(jobs, rnd)) {
        const r = await measure(browser, lib, pages[lib].url, n, round === 0 && n === shotN);
        results.push({ lib, n, round, ...r });
        for (const s of r.said) problems.push(`${lib}, ${n} charts, run ${round + 1}: ${s}`);
      }
      const done = round + 1;
      const left = ((Date.now() - started) / done) * (runs - done);
      process.stdout.write(`round ${done} of ${runs}` + (done < runs ? `, about ${Math.ceil(left / 60000)} min left` : '') + '\n');
    }

    const summary = [];
    for (const n of ns)
      for (const lib of libs) {
        const mine = results.filter((r) => r.lib === lib && r.n === n);
        const of = (f) => mine.map(f);
        summary.push({
          lib,
          n,
          ms: {
            median: quantile(
              of((r) => r.ms),
              0.5,
            ),
            q1: quantile(
              of((r) => r.ms),
              0.25,
            ),
            q3: quantile(
              of((r) => r.ms),
              0.75,
            ),
          },
          cpu: quantile(
            of((r) => r.cpu),
            0.5,
          ),
          heap: quantile(
            of((r) => r.heap),
            0.5,
          ),
          nodes: quantile(
            of((r) => r.nodes),
            0.5,
          ),
        });
      }
    const md = table(summary, meta);
    console.log('\n' + md);
    fs.writeFileSync(path.join(outDir, `results${suffix}.md`), md + '\n');
    fs.writeFileSync(path.join(outDir, `results${suffix}.json`), JSON.stringify({ meta, summary, runs: results }, null, 1));
    if (args.includes('--save')) fs.writeFileSync(saved, snapshot({ meta, summary, runs: results }));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## blockcharts and other libraries\n${md}\n`);
  } finally {
    await browser.close();
  }
  console.log(`\n${results.length} runs in ${Math.round((Date.now() - started) / 60000)} min`);
  if (problems.length) {
    console.log(`\n${problems.length} runs went wrong:\n` + [...new Set(problems)].slice(0, 20).join('\n'));
    process.exitCode = 1;
  }
})();
