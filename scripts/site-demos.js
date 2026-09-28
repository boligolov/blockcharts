// The pages of the site that show how to put a chart into a page of your own. Every snippet on them is the HTML that runs
// in the demo above it: the same string is put into the page and, escaped, into the <pre>. What a reader copies is what they saw work.
const { encodeColumns } = require('./encode-columns.js');
const zlib = require('zlib');

// deterministic pseudo-random numbers, so a rebuild changes nothing
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MONTHS = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01'];
const monthly = [];
[['web', [200, 260, 310, 290, 350, 420]], ['app', [120, 150, 210, 260, 280, 330]]].forEach(([channel, values]) => {
  values.forEach((visits, i) => monthly.push({ month: MONTHS[i], channel, visits }));
});

const lineSpec = (data, x, extra) => Object.assign({
  data,
  size: [720, 300],
  scales: { x: { type: 'time' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
  guides: [
    { type: 'grid', scale: 'y' },
    { type: 'axis', scale: 'x' },
    { type: 'axis', scale: 'y', title: 'Visits' },
    { type: 'legend', scale: 'color', position: 'top' },
  ],
  marks: [{ type: 'line', x, y: 'visits', color: 'channel' }],
  interaction: [{ type: 'tooltip' }],
}, extra || {});

const json = (v) => JSON.stringify(v);
// JSON as people write it: one line for anything short ({ "type": "band" }, [640, 300]), indented otherwise
const flatJson = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(flatJson).join(', ')}]`;
  const entries = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${flatJson(x)}`);
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
};
const pretty = (v, indent = '') => {
  const flat = flatJson(v);
  if (v === null || typeof v !== 'object' || flat.length + indent.length <= 80) return flat;
  const inner = indent + '  ';
  const items = Array.isArray(v) ? v.map((x) => inner + pretty(x, inner)) : Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`);
  return Array.isArray(v) ? `[\n${items.join(',\n')}\n${indent}]` : `{\n${items.join(',\n')}\n${indent}}`;
};
const dataTag = (data, id) => `<script type="application/json" id="${id || 'bc-data'}">\n${json(data)}\n</script>`;
const chartTag = (spec) => `<script type="application/json" data-bc-chart>\n${pretty(spec)}\n</script>`;

/** Each function returns { file, title, lead, sections: [{ h, p, html?, code?, label?, extra? }] }; `html` is live AND shown. */
function embedPages(root) {
  const kit = (name) => `${root}release/kits/${name}`;
  const pages = [];

  // ── 1. one script tag ──
  pages.push({
    file: 'kit.html',
    title: 'One script tag',
    lead: 'A kit is the core and a set of blocks in a single file. Add one script, describe the chart in JSON in the page, and it is drawn when the page loads.',
    sections: [
      {
        h: 'A chart from a kit',
        p: 'Charts mount themselves on DOMContentLoaded: every <code>script[data-bc-chart]</code> gets a <code>div.bc-chart</code> right after it. Data goes into <code>script#bc-data</code> by name, so several charts can share it.',
        html: `<script src="${kit('timeseries.js')}"></script>\n\n${dataTag({ visits: monthly })}\n\n${chartTag(lineSpec('visits', 'month', { interaction: [{ type: 'tooltip' }, { type: 'legend-filter' }] }))}`,
        note: 'Click a legend item to hide a series. On a CDN the first line is <code>&lt;script src="https://cdn.example.com/blockcharts/0.1.0/kits/timeseries.js"&gt;&lt;/script&gt;</code>, pinned to a version.',
      },
      {
        h: 'Which kit',
        p: 'Kits are lists of blocks in <code>kits.json</code>; the guide has the sizes. <code>basic</code> is bars, lines, points, areas and a tooltip. <code>timeseries</code> adds zoom, brush, filtering by legend and decimation. <code>composition</code> is pie, heatmap, histogram and stacks. <code>full</code> has everything. A kit built for exactly one page is one command: <code>node scripts/build-dist.js --page page.json=report</code>.',
      },
    ],
  });

  // ── 2. the loader ──
  pages.push({
    file: 'loader.html',
    title: 'Load only what the page uses',
    lead: 'The loader is 2 KB. It reads the specs on the page, asks the core which blocks they need, and downloads just those files.',
    sections: [
      {
        h: 'A chart through the loader',
        p: 'Nothing but <code>loader.js</code> is in the page. With <code>data-auto</code> it fetches <code>manifest.json</code>, the core and the blocks this chart needs, then mounts.',
        html: `<script src="${root}release/loader.js" data-auto></script>\n\n${dataTag({ visits: monthly })}\n\n${chartTag(lineSpec('visits', 'month', { size: [720, 260] }))}`,
        extra: `<p class="muted">Files the loader fetched for the chart above:</p><pre class="out" id="fetched">waiting for the chart…</pre>
<script>
window.addEventListener('load', function () {
  BCLoader.ready.then(function () {
    var files = performance.getEntriesByType('resource').map(function (r) { return r.name; }).filter(function (n) { return /\\/release\\//.test(n); })
      .map(function (n) { return n.replace(/^.*\\/release\\//, ''); });
    document.getElementById('fetched').textContent = files.join('\\n') + '\\n\\n' + files.length + ' files, the rest of the blocks were never requested';
  });
});
</script>`,
      },
      {
        h: 'By hand',
        p: 'Without <code>data-auto</code> you call it yourself, for example to add blocks that a chart made later will need:',
        code: `await BCLoader.load({\n  base: 'https://cdn.example.com/blockcharts/0.1.0/', // default: the folder of loader.js\n  blocks: ['interaction.zoom'],  // extra blocks besides the ones the page uses\n  scan: true,                    // read the specs on the page (default)\n  mount: true,                   // draw them when loaded (default)\n  integrity: true,               // put the SRI hashes of manifest.json on the script tags\n});`,
        label: 'JavaScript',
      },
    ],
  });

  // ── 3. ES module ──
  const moduleSpec = {
    data: 'sales', size: [720, 280],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [{ type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } }],
    marks: [{ type: 'rect', x: 'region', y: 'total', radius: 3 }, { type: 'text', x: 'region', y: 'total', text: 'total', format: 'compact', baseline: 'auto', dy: -5 }],
    interaction: [{ type: 'tooltip', formats: { total: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } } }],
  };
  const sales = [{ region: 'North', total: 42000 }, { region: 'South', total: 58000 }, { region: 'East', total: 31000 }, { region: 'West', total: 66000 }];
  pages.push({
    file: 'module.html',
    title: 'As an ES module',
    lead: 'The same kits come as ES modules. Import BC, give it data, and draw into any element. This is the way into a bundler or a framework component.',
    sections: [
      {
        h: 'import BC from a kit',
        p: 'The default export is the runtime, <code>BC</code>. <code>BC.data</code> adds a dataset by name; <code>BC.chart(element, spec)</code> draws and returns a handle. (Browsers load modules only over http or https, so open this page from a server, not from a file.)',
        html: `<div id="chart"></div>\n\n<script type="module">\n  import BC from '${kit('basic.mjs')}';\n\n  BC.data('sales', ${json(sales)});\n  const chart = BC.chart(document.getElementById('chart'), ${pretty(moduleSpec).replace(/\n/g, '\n  ')});\n  console.log(chart.diagnostics); // [] when the spec is fine\n</script>`,
      },
      {
        h: 'In a component',
        p: 'A component draws in its mount hook and cleans up in its unmount hook. <code>destroy()</code> removes the listeners and the elements the chart made; <code>update(spec)</code> redraws with a new spec and keeps the zoom.',
        code: `import BC from 'blockcharts/kits/basic.mjs';\n\nexport function mountChart(element, rows, spec) {\n  BC.data('rows', rows);            // last call for a name wins\n  const chart = BC.chart(element, { ...spec, data: 'rows' });\n  return {\n    update: (next) => chart.update({ ...next, data: 'rows' }),\n    destroy: () => chart.destroy(),\n  };\n}`,
        label: 'JavaScript',
      },
    ],
  });

  // ── 4. the API ──
  const days = 90;
  const apiSpec = lineSpec('visits', 'day', {
    size: [720, 320],
    interaction: [{ type: 'zoom', fit: ['y'] }, { type: 'brush', fit: ['y'] }, { type: 'legend-filter' }, { type: 'tooltip', content: 'tip' }],
  });
  pages.push({
    file: 'api.html',
    title: 'Control a chart from your code',
    lead: 'BC.chart returns a handle. Use it to move the visible window, swap the spec while keeping the zoom, and put your own content in the tooltip.',
    sections: [
      {
        h: 'The handle',
        p: 'The buttons call <code>setView</code>, <code>update</code> and <code>getView</code>. Scroll with Ctrl held, or drag, to zoom on the chart itself, then press <em>Log view</em>. Press <em>Points / lines</em> while zoomed: <code>update</code> keeps the zoom.',
        html: `<script src="${kit('timeseries.js')}"></script>

<div id="chart"></div>
<div class="bar">
  <button id="march">Zoom to March</button>
  <button id="reset">Reset</button>
  <button id="kind">Points / lines</button>
  <button id="view">Log view</button>
</div>
<pre class="out" id="out">…</pre>

<script>
  // 90 days of visits for three channels
  function makeRows() {
    var next = (function (s) { return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })(7);
    var rows = [];
    ['web', 'app', 'email'].forEach(function (channel, c) {
      var level = 200 - c * 60;
      for (var d = 0; d < ${days}; d++) {
        level = Math.max(20, level + (next() - 0.47) * 24);
        rows.push({ day: new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10), channel: channel, visits: Math.round(level) });
      }
    });
    return rows;
  }

  BC.data('visits', makeRows());
  BC.defineFn('tip', function (d) {          // custom tooltip: an array of lines, inserted as text
    return [d.values.channel, d.values.day + ': ' + d.values.visits + ' visits'];
  });

  var spec = ${pretty(apiSpec).replace(/\n/g, '\n  ').trimStart()};
  var chart = BC.chart(document.getElementById('chart'), spec);
  var out = document.getElementById('out');

  document.getElementById('march').onclick = function () {
    chart.setView('x', [Date.UTC(2024, 2, 1), Date.UTC(2024, 2, 31)]);
  };
  document.getElementById('reset').onclick = function () { chart.setView('x', null); };
  document.getElementById('kind').onclick = function () {
    var mark = spec.marks[0];
    mark.type = mark.type === 'line' ? 'point' : 'line';
    chart.update(spec);                       // the zoom stays
  };
  document.getElementById('view').onclick = function () {
    out.textContent = JSON.stringify(chart.getView());
  };
</script>`,
      },
      {
        h: 'What the handle offers',
        p: '<code>host</code>, <code>spec</code> and <code>diagnostics</code> are read-only; <code>ready</code> resolves after the first draw (a dataset that is still being decoded delays it); <code>update(spec, { resetView })</code>, <code>setView(scale, domain | null)</code>, <code>getView()</code> and <code>destroy()</code> do the work. Register functions with <code>BC.defineFn(name, fn)</code> and refer to them by name from the spec, which is how a JSON spec gets custom code without carrying any.',
      },
    ],
  });

  // ── 5. themes ──
  const themeSpec = {
    data: 'sales', size: [520, 220],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [{ type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y', format: 'compact' }],
    marks: [{ type: 'rect', x: 'region', y: 'total', radius: 2 }],
    interaction: [{ type: 'tooltip' }],
  };
  pages.push({
    file: 'theme.html',
    title: 'Colors and themes',
    lead: 'Charts are SVG and take every color from CSS variables, so one stylesheet themes them, dark mode is a media query, and print works.',
    sections: [
      {
        h: 'Three themes, one chart',
        p: 'Each box only sets variables on a wrapper element. The chart and its tooltip follow.',
        html: `<script src="${kit('basic.js')}"></script>
${dataTag({ sales: sales.map((r) => ({ region: r.region, total: r.total })) })}
<div class="cols">
  <div class="demo theme-warm">${chartTag(themeSpec)}</div>
  <div class="demo theme-mono">${chartTag(themeSpec)}</div>
  <div class="demo theme-neon">${chartTag(themeSpec)}</div>
</div>`,
      },
      {
        h: 'The variables',
        p: 'The first eight colors are for categories, in order of first appearance. Everything has a default, so you only set what you want to change.',
        code: `.my-theme {\n  --bc-text: #5b3a1e;        /* labels, tick text, tooltip text */\n  --bc-axis: #b08968;        /* axis lines and ticks */\n  --bc-grid: #f0e2d0;        /* grid lines */\n  --bc-tooltip-bg: #fff8ee;  /* tooltip background */\n  --bc-c0: #c1440e;          /* category colors, --bc-c0 ... --bc-c7 */\n  --bc-c1: #e29a3b;\n  --bc-c2: #7a4e2d;\n  --bc-brush-fill: rgba(43, 108, 176, .15);  /* selection rectangle of the brush */\n  --bc-brush-line: #2b6cb0;\n}\n\n@media (prefers-color-scheme: dark) {\n  .my-theme { --bc-text: #d6d3d1; --bc-grid: #2a2826; /* ... */ }\n}`,
        label: 'CSS',
      },
    ],
  });

  // ── 5b. your own block ──
  const targetSpec = {
    data: 'sales', size: [640, 260],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true, domain: [0, 80000] } },
    guides: [
      { type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y', format: 'compact' },
      { type: 'target', scale: 'y', value: 50000, label: 'Target 50K' },
    ],
    marks: [{ type: 'rect', x: 'region', y: 'total', radius: 2 }],
    interaction: [{ type: 'tooltip' }],
  };
  const targetBlock = `<script>
  // A new block: a dashed target line across the plot, at a value of a scale.
  BC.define({
    role: 'guide', type: 'target', version: 1,
    params: {
      scale: { kind: 'scale', required: true },
      value: { kind: 'number', required: true },
      label: { kind: 'string' },
    },
    render(spec, ctx) {
      const y = ctx.scales[spec.scale](spec.value);
      const { x, w } = ctx.plot;
      const color = 'var(--bc-c2, #e15759)';
      return {
        overlay: [
          { type: 'path', d: \`M\${x} \${y}H\${x + w}\`, cls: 'bc-target', style: { fill: 'none', stroke: color, strokeWidth: 1.5, strokeDash: [5, 4] } },
          { type: 'text', x: x + w, y: y - 6, text: spec.label || String(spec.value), anchor: 'end', size: 11, weight: 600, style: { fill: color } },
        ],
      };
    },
  });
</script>`;
  pages.push({
    file: 'block.html',
    title: 'Your own block',
    lead: 'A block is a small classic script that registers itself with BC.define. The built-in ones are made exactly this way, so a block of your own is a first-class part of the chart: the spec names it by type, and only the pages that use it carry it.',
    sections: [
      {
        h: 'A target line, in twenty lines',
        p: 'A new guide, <code>guide.target</code>, written in the page after the kit. The spec uses it like any other guide: <code>{"type": "target", "scale": "y", "value": 50000}</code>. Its parameters are declared, so a missing <code>value</code> or a misspelt name is reported the same way as for built-in blocks.',
        html: `<script src="${kit('basic.js')}"></script>
${targetBlock}
${dataTag({ sales: sales.map((r) => ({ region: r.region, total: r.total })) })}
${chartTag(targetSpec)}`,
      },
      {
        h: 'What a block can be',
        p: 'Six roles, one contract (<code>src/bc.d.ts</code>): a <b>scale</b> maps values, a <b>transform</b> reshapes rows, a <b>mark</b> turns rows into shapes, a <b>guide</b> explains a scale, an <b>interaction</b> listens to the reader, a <b>renderer</b> draws. Marks and guides return plain shapes (path, rect, circle, text, group) with CSS-variable colors, so a block of your own follows themes and dark mode, and works on the canvas renderer too. Give it <code>requires</code> and the composer and the loader bring its dependencies along. Defining the same block twice is harmless.',
      },
    ],
  });

  // ── 6. data forms ──
  const rnd = rng(11);
  const N = 2000;
  const xs = [], ys = [];
  let level = 50;
  for (let i = 0; i < N; i++) {
    level += (rnd() - 0.5) * 3;
    xs.push(i);
    ys.push(Math.round(level * 1000) / 1000);
  }
  const rows = xs.map((x, i) => ({ t: x, v: ys[i] }));
  const columns = { columns: { t: xs, v: ys } };
  const gzB64 = { encoding: 'gzip+base64', data: zlib.gzipSync(Buffer.from(json(columns)), { level: 9 }).toString('base64') };
  const binary = encodeColumns({ t: xs, v: ys });
  const binary32 = encodeColumns({ t: xs, v: ys }, { dtypes: { v: 'float32' } });
  const size = (v) => Buffer.byteLength(typeof v === 'string' ? v : json(v));
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  const forms = [
    ['Rows', rows, 'An array of objects. The simplest form, and the largest.'],
    ['Columns', columns, 'One array per field: no repeated keys.'],
    ['gzip + base64', gzB64, 'The JSON of rows or columns, gzipped and base64-encoded. The composer does this by itself for big datasets. Needs DecompressionStream (all current browsers).'],
    ['Binary columns', binary, 'Numeric columns as raw values, gzipped, base64: what a data pipeline can write. Integers use the smallest integer type; floats stay 64-bit, so nothing is lost.'],
  ];
  const dataSpec = (name) => ({
    data: name, size: [520, 200],
    scales: { x: { type: 'linear' }, y: { type: 'linear' } },
    guides: [{ type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'line', x: 't', y: 'v' }],
    interaction: [{ type: 'tooltip' }],
  });
  const dataHtml = `<script src="${kit('basic.js')}"></script>
<script type="application/json" id="bc-data">${json({ rows, columns: columns, gz: gzB64, binary })}</script>
<div class="cols">
${forms.map(([label, , ], i) => `  <div class="demo"><p class="muted" style="margin:0 0 4px">${label}</p>${chartTag(dataSpec(['rows', 'columns', 'gz', 'binary'][i])).replace(/\n/g, ' ')}</div>`).join('\n')}
</div>`;
  pages.push({
    file: 'data.html',
    title: 'Ways to hand over data',
    lead: 'The same 2000-point series, four ways. They draw the same picture; they differ in how many bytes the page carries.',
    sections: [
      {
        h: 'Four datasets, one result',
        p: 'All four charts below read a dataset of 2000 rows. Datasets that are encoded are decoded in the background; a chart shows a placeholder until its data is ready, and reports a clear error (naming the column) if the data is broken.',
        htmlLiveOnly: dataHtml,
        extraAfter: `<table><thead><tr><th>Form</th><th>Size in the page</th><th>What it is</th></tr></thead><tbody>
${forms.map(([label, value, what]) => `<tr><td>${label}</td><td>${kb(size(value))}</td><td>${what}</td></tr>`).join('\n')}
<tr><td>Binary, v as float32</td><td>${kb(size(binary32))}</td><td>Halves the values that are not integers, keeps about 7 digits. Only when you ask for it.</td></tr>
</tbody></table>`,
      },
      {
        h: 'What each one looks like',
        p: 'Tiny examples of the four shapes (the demo above has 2000 rows each):',
        code: `// rows\n[ { "t": 0, "v": 50.2 }, { "t": 1, "v": 50.9 } ]\n\n// columns\n{ "columns": { "t": [0, 1], "v": [50.2, 50.9] } }\n\n// gzip + base64 of the JSON above\n{ "encoding": "gzip+base64", "data": "H4sIAAAAAAAA..." }\n\n// binary columns (\`scripts/encode-columns.js\` writes them)\n{ "columns": {\n    "t": { "dtype": "uint8",   "encoding": "gzip+base64", "data": "H4sI..." },\n    "v": { "dtype": "float64", "encoding": "gzip+base64", "data": "H4sI..." }\n} }\n\n// from a CSV file, when composing a page: { "csvFile": "orders.csv" }`,
        label: 'Data forms',
      },
    ],
  });

  // ── 7. canvas ──
  const brng = rng(42);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = brng();
    while (!v) v = brng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const bx = [], by = [];
  [[1200, 1300, 380, 260], [2600, 2500, 300, 420], [3000, 1000, 240, 240]].forEach(([cx, cy, sx, sy]) => {
    for (let i = 0; i < 7000; i++) {
      bx.push(Math.max(0, Math.min(4095, Math.round(cx + gauss() * sx))));
      by.push(Math.max(0, Math.min(4095, Math.round(cy + gauss() * sy))));
    }
  });
  const bigData = { points: encodeColumns({ x: bx, y: by }) };
  const bigSpec = (renderer) => ({
    data: 'points', renderer, size: [520, 360],
    scales: { x: { type: 'linear', nice: true }, y: { type: 'linear', nice: true } },
    guides: [{ type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'point', x: 'x', y: 'y', r: 1.6, opacity: 0.35 }],
    interaction: [{ type: 'zoom', scales: ['x', 'y'] }, { type: 'tooltip' }],
  });
  const canvasHtml = (data) => `<script src="${kit('full.js')}"></script>
<script type="application/json" id="bc-data">${data}</script>

<div class="cols">
  <div><p class="muted" style="margin:0 0 4px">SVG (the default)</p><div id="svg-chart"></div></div>
  <div><p class="muted" style="margin:0 0 4px">Canvas</p><div id="canvas-chart"></div></div>
</div>
<div class="bar"><button id="bench">Time 20 zoom steps on each</button></div>
<pre class="out" id="result">Press the button. Both charts also zoom with Ctrl + wheel.</pre>

<script>
  BC.mount(); // read the data above now, not at the end of the page load

  var svg = BC.chart(document.getElementById('svg-chart'), ${json(bigSpec('svg'))});
  var canvas = BC.chart(document.getElementById('canvas-chart'), ${json(bigSpec('canvas'))});

  function frame() { return new Promise(function (done) { requestAnimationFrame(function () { requestAnimationFrame(done); }); }); }
  async function time(chart) {
    var t0 = performance.now();
    for (var i = 0; i < 20; i++) {
      var from = (i % 10) * 90, span = 4095 - (i % 10) * 300;
      chart.setView('x', [from, from + span]);
      chart.setView('y', [from, from + span]);
      await frame();
    }
    var ms = (performance.now() - t0) / 20;
    chart.setView('x', null); chart.setView('y', null);
    await frame();
    return ms;
  }
  document.getElementById('bench').onclick = async function () {
    await svg.ready; await canvas.ready;
    var a = await time(svg), b = await time(canvas);
    document.getElementById('result').textContent =
      'SVG:    ' + a.toFixed(0) + ' ms per redraw\\nCanvas: ' + b.toFixed(0) + ' ms per redraw  (' + (a / b).toFixed(1) + 'x faster)';
  };
</script>`;
  pages.push({
    file: 'canvas.html',
    title: 'Many points: the canvas renderer',
    lead: 'An SVG chart makes a DOM element for every mark. Fine for thousands, slow for tens of thousands. Add <code>"renderer": "canvas"</code> to the spec and the same chart is drawn on one canvas.',
    sections: [
      {
        h: 'The same 21,000 points, two renderers',
        p: 'Both charts read one dataset and have the same spec except <code>renderer</code>. Zoom, pan, tooltip, legend filter, colors and dark mode work the same. Time the redraws on your machine:',
        html: canvasHtml(json(bigData)),
        shown: canvasHtml('{"points": {"columns": {"x": {...}, "y": {...}}}}  /* two binary columns, see "Ways to hand over data" */'),
        note: 'Numbers depend on the machine; on the machine this page was made on the canvas redraws about 5 times faster at 50,000 points. A single long <em>line</em> is one path element either way, so it gains little from a canvas: reduce it with the <code>decimate</code> transform instead.',
      },
      {
        h: 'What is different on a canvas',
        p: 'A canvas has no elements, so a few things that come from elements do not exist: CSS classes on marks, the browser\'s native hover title, and text selection inside the chart. Colors still come from your CSS variables, and the chart repaints when the color scheme or the container width changes. Charts are sharp on high-density screens (the backing store follows <code>devicePixelRatio</code>, up to 3). The renderer is a block like any other: kits that include it are <code>timeseries</code> and <code>full</code>.',
      },
    ],
  });

  return pages;
}

module.exports = { embedPages, monthly, lineSpec };
