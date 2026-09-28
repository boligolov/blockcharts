// Showcase page, assembled by the composer (scripts/compose.js): only the blocks it needs are inlined.
// Usage: npm run page   (or: node scripts/page.js)  → dist/page.html
const fs = require('fs');
const path = require('path');
const { compose } = require('./compose.js');

const DAY = 86400000;

// ── data ──
const sales = [];
for (let i = 1; i <= 12; i++) sales.push({ month: i, revenue: Math.round(120 + i * 12 + Math.sin(i) * 30), units: Math.round(3000 + i * 450 + Math.cos(i) * 600) });

const regions = ['North', 'South', 'East', 'West', 'Central'].map((region, i) => ({ region, total: [42, 58, 31, 66, 25][i] }));

const traffic = [];
for (let d = 0; d < 90; d++) {
  const date = new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10);
  traffic.push({ date, visits: Math.round(200 + d * 2 + Math.sin(d / 6) * 60), channel: 'web' });
  traffic.push({ date, visits: Math.round(120 + Math.cos(d / 9) * 40 + d), channel: 'app' });
  traffic.push({ date, visits: Math.round(60 + Math.sin(d / 3) * 15 + d / 3), channel: 'email' });
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const scatter = [];
for (let i = 0; i < 80; i++) {
  const height = 150 + rnd() * 50;
  scatter.push({ height: +height.toFixed(1), weight: +(height * 0.45 - 12 + (rnd() - 0.5) * 18).toFixed(1), group: rnd() < 0.5 ? 'A' : 'B' });
}

const monthly = [];
for (let i = 0; i < 60; i++) monthly.push({ month: new Date(Date.UTC(2020, i, 1)).toISOString().slice(0, 10), value: Math.round(100 + i * 3 + Math.sin(i / 2) * 25) });

const quarters = [];
for (const [q, vals] of [['Q1', [30, 20, 10]], ['Q2', [35, 25, 15]], ['Q3', [28, 30, 22]], ['Q4', [40, 28, 26]]]) {
  ['Hardware', 'Software', 'Services'].forEach((line, i) => quarters.push({ quarter: q, line, revenue: vals[i] }));
}

const mix = [];
for (let d = 0; d < 60; d++) {
  const date = new Date(Date.UTC(2024, 0, 1 + d * 3)).toISOString().slice(0, 10);
  mix.push({ date, source: 'Search', share: 40 + Math.sin(d / 8) * 10 }, { date, source: 'Social', share: 25 + Math.cos(d / 6) * 8 }, { date, source: 'Direct', share: 20 + d / 5 });
}

// ── charts ──
const G = (scale) => ({ type: 'grid', scale });
const A = (scale, extra) => ({ type: 'axis', scale, ...extra });
const COLOR = { color: { type: 'color' } };

const charts = [
  {
    title: 'Lines on a time scale, with zoom and tooltip',
    noteHtml: 'One long-format dataset; <code>color: "channel"</code> splits the lines and colors them, a legend shows the scale. Hover for values. Ctrl + wheel zooms around the cursor and the y axis fits the window (<code>fit: ["y"]</code>), drag pans, double-click resets.',
    spec: {
      data: 'traffic',
      scales: { x: { type: 'time' }, y: { type: 'linear', zero: true }, ...COLOR },
      guides: [G('y'), A('x'), A('y'), { type: 'legend', scale: 'color', position: 'top' }],
      marks: [{ type: 'line', x: 'date', y: 'visits', color: 'channel' }],
      interaction: [{ type: 'zoom', fit: ['y'] }, { type: 'tooltip' }],
    },
  },
  {
    title: 'Stacked bars',
    noteHtml: '<code>transform.stack</code> adds the start and end of every segment; a rect uses them as <code>y2</code> and <code>y</code>, colored by series. The tooltip is told which fields to show (<code>fields</code>), so it skips the two helper columns.',
    spec: {
      data: 'quarters',
      size: [640, 300],
      transforms: [{ type: 'stack', field: 'revenue', by: 'quarter', group: 'line' }],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, ...COLOR },
      guides: [G('y'), A('x'), A('y'), { type: 'legend', scale: 'color' }],
      marks: [{ type: 'rect', x: 'quarter', y: 'revenue1', y2: 'revenue0', color: 'line' }],
      interaction: [{ type: 'tooltip', fields: ['quarter', 'line', 'revenue'] }],
    },
  },
  {
    title: 'Stacked areas, 100%',
    noteHtml: 'The same transform with <code>normalize: true</code>, drawn as areas over time.',
    spec: {
      data: 'mix',
      size: [640, 280],
      transforms: [{ type: 'stack', field: 'share', by: 'date', group: 'source', normalize: true }],
      scales: { x: { type: 'time' }, y: { type: 'linear', domain: [0, 1] }, ...COLOR },
      guides: [G('y'), A('x'), A('y'), { type: 'legend', scale: 'color', position: 'top' }],
      marks: [{ type: 'area', x: 'date', y: 'share1', y2: 'share0', color: 'source' }],
      interaction: [{ type: 'tooltip', fields: ['date', 'source', 'share'] }],
    },
  },
  {
    title: 'Bars on a band scale',
    noteHtml: 'Band + linear + rect, with a light corner radius.',
    spec: {
      data: 'regions',
      size: [640, 260],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      guides: [G('y'), A('x'), A('y')],
      marks: [{ type: 'rect', x: 'region', y: 'total', radius: 3 }],
      interaction: [{ type: 'tooltip' }],
    },
  },
  {
    title: 'Two scales on one chart',
    noteHtml: 'A second y scale, <code>y2</code>, drawn on the right with <code>position: "right"</code>. Marks pick it with <code>{field, scale}</code>.',
    spec: {
      data: 'sales',
      scales: { x: { type: 'linear', padding: 0.05 }, y: { type: 'linear', zero: true }, y2: { type: 'linear', range: 'height' } },
      guides: [G('y'), A('x'), A('y'), A('y2', { position: 'right' })],
      marks: [{ type: 'point', x: 'month', y: 'revenue', r: 4 }, { type: 'point', x: 'month', y: { field: 'units', scale: 'y2' }, r: 3 }],
      interaction: [{ type: 'tooltip' }],
    },
  },
  {
    title: 'Scatter, two groups',
    noteHtml: 'Points colored by a field through a color scale, legend on the right. Domains are padded (<code>padding: 0.04</code>). The tooltip content comes from a page function: <code>content: "personTip"</code>, registered with <code>BC.defineFn</code>, gets the whole row and returns a DOM node.',
    spec: {
      data: 'scatter',
      size: [640, 320],
      scales: { x: { type: 'linear', padding: 0.04 }, y: { type: 'linear', padding: 0.04 }, ...COLOR },
      guides: [G('x'), G('y'), A('x'), A('y'), { type: 'legend', scale: 'color' }],
      marks: [{ type: 'point', x: 'height', y: 'weight', r: 3.5, opacity: 0.75, color: 'group' }],
      interaction: [{ type: 'tooltip', content: 'personTip' }],
    },
  },
  {
    title: 'Years of monthly data',
    noteHtml: 'Sixty points; the axis ticks snap to calendar units. Zoom in far enough and they switch to months, then days.',
    spec: {
      data: 'monthly',
      size: [640, 260],
      scales: { x: { type: 'time' }, y: { type: 'linear' } },
      guides: [G('y'), A('x'), A('y')],
      marks: [{ type: 'area', x: 'month', y: 'value', baseline: 100, opacity: 0.25 }, { type: 'line', x: 'month', y: 'value' }],
      interaction: [{ type: 'zoom', wheel: 'always', fit: ['y'] }, { type: 'tooltip' }],
    },
  },
  {
    title: 'A broken spec',
    noteHtml: 'Validation errors are shown in place of the chart, with the path into the spec, and never throw. (The composer normally refuses such a spec; this page allows it on purpose.)',
    spec: { data: 'sales', marks: [{ type: 'point', x: 'month', y: 'ghost' }] },
  },
];

// ── page chrome ──
const css = `
:root{--bg:#fafaf9;--card:#fff;--line:#e7e5e4;--fg:#1c1917;--muted:#78716c;
 --bc-text:#44403c;--bc-axis:#a8a29e;--bc-grid:#eeeceb;--bc-tooltip-bg:#fff;
 --bc-c0:#4e79a7;--bc-c1:#f28e2b;--bc-c2:#e15759;--bc-c3:#76b7b2;--bc-c4:#59a14f;--bc-c5:#edc948;--bc-c6:#b07aa1;--bc-c7:#ff9da7}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141312;--card:#1c1b19;--line:#2e2c29;--fg:#f5f5f4;--muted:#a8a29e;
 --bc-text:#d6d3d1;--bc-axis:#78716c;--bc-grid:#2a2826;--bc-tooltip-bg:#292725;
 --bc-c0:#7aa6d6;--bc-c1:#ffb066;--bc-c2:#ff7f80;--bc-c3:#8fd3ce;--bc-c4:#7ec672;--bc-c5:#f5d76e;--bc-c6:#d0a0c6;--bc-c7:#ffb3bc}}
:root[data-theme=dark]{--bg:#141312;--card:#1c1b19;--line:#2e2c29;--fg:#f5f5f4;--muted:#a8a29e;
 --bc-text:#d6d3d1;--bc-axis:#78716c;--bc-grid:#2a2826;--bc-tooltip-bg:#292725;
 --bc-c0:#7aa6d6;--bc-c1:#ffb066;--bc-c2:#ff7f80;--bc-c3:#8fd3ce;--bc-c4:#7ec672;--bc-c5:#f5d76e;--bc-c6:#d0a0c6;--bc-c7:#ffb3bc}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:8px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 4px}
p{margin:0 0 12px;color:var(--muted);font-size:13px}code{background:var(--line);padding:1px 5px;border-radius:4px;font-size:12px}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:4px 10px;border-radius:6px;cursor:pointer}
button:hover{border-color:var(--muted)}
.bc-section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.bc-chart{user-select:none}
.btns{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}`;

const before = `<main><header><h1>blockcharts</h1><button id="theme" type="button">Light / dark</button></header>
<p id="lead"></p>`;

const after = `<script>
// custom tooltip content: a function that gets the row under the pointer and returns what to insert
BC.defineFn('personTip', function (d) {
  var box = document.createElement('div');
  var head = document.createElement('strong');
  head.textContent = 'Person #' + (d.row + 1) + ' (group ' + d.values.group + ')';
  var body = document.createElement('div');
  var bmi = d.values.weight / Math.pow(d.values.height / 100, 2);
  body.textContent = d.values.height + ' cm, ' + d.values.weight + ' kg, BMI ' + bmi.toFixed(1);
  box.appendChild(head);
  box.appendChild(body);
  return box;
});
</script>
<section class="bc-section"><h2>External control</h2>
<p>The same <code>setView</code> that the zoom interaction uses, driven from page code with <code>chart.setView('x', [from, to])</code>.</p>
<div class="btns"><button data-days="14">Last 14 days</button><button data-days="45">Last 45 days</button><button data-days="0">All</button><span id="ext-view" style="align-self:center;color:var(--muted);font-size:12px"></span></div>
<div id="ext"></div></section></main>
<script>
document.getElementById('theme').addEventListener('click', function () {
  var root = document.documentElement, dark = getComputedStyle(root).getPropertyValue('--bg').trim() === '#141312';
  root.setAttribute('data-theme', dark ? 'light' : 'dark');
});
window.addEventListener('DOMContentLoaded', function () {
  var end = Date.UTC(2024, 2, 30), DAY = ${DAY};
  var chart = BC.chart(document.getElementById('ext'), {
    data: 'traffic', size: [640, 260],
    scales: { x: { type: 'time' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
    guides: [{ type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, { type: 'legend', scale: 'color', position: 'top' }],
    marks: [{ type: 'line', x: 'date', y: 'visits', color: 'channel' }],
    interaction: [{ type: 'zoom' }]
  });
  var label = document.getElementById('ext-view');
  function show() { var v = chart.getView().x; label.textContent = new Date(v[0]).toISOString().slice(0, 10) + ' – ' + new Date(v[1]).toISOString().slice(0, 10); }
  document.querySelectorAll('button[data-days]').forEach(function (b) {
    b.addEventListener('click', function () {
      var n = +b.getAttribute('data-days');
      chart.setView('x', n ? [end - n * DAY, end] : null);
      setTimeout(show, 50);
    });
  });
  setTimeout(show, 50);
  var ext = document.getElementById('ext');
  ['wheel', 'pointerup', 'dblclick'].forEach(function (t) { ext.addEventListener(t, function () { setTimeout(show, 60); }); });
});
</script>`;

const result = compose({
  title: 'blockcharts showcase',
  data: { sales, regions, traffic, scatter, monthly, quarters, mix },
  charts,
  css,
  defaultCss: false,
  before,
  after,
  // the external-control chart is built by page code, so its blocks are not visible in any spec
  include: ['interaction.zoom', 'mark.line', 'guide.legend', 'scale.color', 'scale.time'],
  allowErrors: true,
});

// the lead line states what the page actually contains
const kb = (result.bytes / 1024).toFixed(0);
const html = result.html.replace('<p id="lead"></p>', `<p>Every chart below is a JSON spec in a <code>&lt;script&gt;</code> tag. The composer inlined the core and the ${result.blocks.length} blocks these specs need (${kb} KB, no network).</p>`);
const out = path.join(__dirname, '../dist/page.html');
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${result.blocks.length} blocks, compressed data: ${result.compressed.join(', ') || 'none'})`);
for (const d of result.diagnostics) console.log(`  ${d.level} ${d.path}: ${d.message}`);
