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
[
  ['web', [200, 260, 310, 290, 350, 420]],
  ['app', [120, 150, 210, 260, 280, 330]],
].forEach(([channel, values]) => {
  values.forEach((visits, i) => monthly.push({ month: MONTHS[i], channel, visits }));
});

const lineSpec = (data, x, extra) =>
  Object.assign(
    {
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
    },
    extra || {},
  );

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
  const items = Array.isArray(v)
    ? v.map((x) => inner + pretty(x, inner))
    : Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`);
  return Array.isArray(v) ? `[\n${items.join(',\n')}\n${indent}]` : `{\n${items.join(',\n')}\n${indent}}`;
};
const dataTag = (data, id) => `<script type="application/json" id="${id || 'bc-data'}">\n${json(data)}\n</script>`;
const chartTag = (spec) => `<script type="application/json" data-bc-chart>\n${pretty(spec)}\n</script>`;

/** Where jsDelivr serves the files of a published version: the release/ folder of the npm package. */
const cdnBase = (version) => `https://cdn.jsdelivr.net/npm/blockcharts@${version}/release/`;

const indent = (s, by) => s.replace(/\n/g, '\n' + by);

// four regions' sales: the rows of the app snippets, and of the charts of several pages
const sales = [
  { region: 'North', total: 42000 },
  { region: 'South', total: 58000 },
  { region: 'East', total: 31000 },
  { region: 'West', total: 66000 },
];

// ── the framework wrappers as an app uses them: the embed page and the landing page show the same code ──
// the spec of the snippets: short, as an app keeps it next to its component
const appSpec = `const spec = {
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  guides: [
    { type: 'axis', scale: 'x' },
    { type: 'axis', scale: 'y', format: 'compact' },
  ],
  marks: [{ type: 'rect', x: 'region', y: 'total' }],
  interaction: [{ type: 'tooltip' }],
};`;
/** Each wrapper in an app: `name` for a tab, `label` for a snippet, `lang` for the highlighter. */
const FRAMEWORKS = [
  {
    id: 'react',
    name: 'React',
    label: 'React',
    lang: 'jsx',
    code: `import 'blockcharts/kits/basic.mjs'; // once, before a chart mounts
import { useRef } from 'react';
import { BlockChart } from 'blockcharts/react';

${appSpec}

export function Regions({ rows, onPick }) {
  const chart = useRef(null); // chart.current.setView('x', null)
  return (
    <BlockChart
      ref={chart}
      spec={spec}
      data={rows}
      onClick={(d) => onPick(d.values.region)}
    />
  );
}`,
  },
  {
    id: 'vue',
    name: 'Vue',
    label: 'Vue',
    lang: 'vue',
    code: `<script setup>
import 'blockcharts/kits/basic.mjs';
import { BlockChart } from 'blockcharts/vue';

defineProps(['rows']);
const emit = defineEmits(['pick']);
${appSpec}
</script>

<template>
  <BlockChart
    :spec="spec"
    :data="rows"
    @click="(d) => emit('pick', d.values.region)"
  />
</template>`,
  },
  {
    id: 'svelte',
    name: 'Svelte',
    label: 'Svelte',
    lang: 'svelte',
    code: `<script>
  import 'blockcharts/kits/basic.mjs';
  import { blockchart } from 'blockcharts/svelte';

  let { rows, onpick } = $props();
  ${indent(appSpec, '  ')}
  const onClick = (d) => onpick(d.values.region);
</script>

<div use:blockchart={{ spec, data: rows, onClick }}></div>`,
  },
  {
    id: 'angular',
    name: 'Angular',
    label: 'TypeScript',
    lang: 'typescript',
    code: `import 'blockcharts/kits/basic.mjs';
import 'blockcharts/element';
import { Component, CUSTOM_ELEMENTS_SCHEMA, input, output } from '@angular/core';

@Component({
  selector: 'app-regions',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: \`
    <block-chart [spec]="spec" [data]="rows()"
      (bc-click)="pick.emit($event.detail.values.region)"></block-chart>
  \`,
})
export class RegionsComponent {
  rows = input.required<object[]>();
  pick = output<string>();
  spec = {
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    marks: [{ type: 'rect', x: 'region', y: 'total' }],
    interaction: [{ type: 'click' }],
  };
}`,
  },
];
// no framework: the runtime itself, as the module page shows it (the landing page's last tab)
FRAMEWORKS.push({
  id: 'js',
  name: 'JavaScript',
  label: 'JavaScript',
  lang: 'javascript',
  code: `import BC from 'blockcharts/kits/basic.mjs';

${appSpec}

BC.data('sales', rows); // named: several charts can share it
const chart = BC.chart(document.getElementById('chart'), {
  ...spec,
  data: 'sales',
  interaction: [{ type: 'click' }],
});
chart.host.addEventListener('bc-click', (e) => {
  openRegion(e.detail.values.region); // the clicked row
});`,
});
/** A wrapper's code as a section of an embed page. */
const framework = (id) => {
  const { code, label, lang } = FRAMEWORKS.find((f) => f.id === id);
  return { code, label, lang };
};

/** Each function returns { file, title, lead, sections: [{ h, p, html?, code?, label?, extra? }] }; `html` is live AND shown.
 *  `release` is the release manifest the pages load, for the sizes they name. */
function embedPages(root, release) {
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
        note: `Click a legend item to hide a series. From the CDN the first line is <code>&lt;script src=&quot;${cdnBase(release.version)}kits/timeseries.js&quot;&gt;&lt;/script&gt;</code>, pinned to a version; from your own site, the path you serve the file at.`,
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
    lead: `The loader is ${(release.loader.bytes / 1024).toFixed(1)} KB. It reads the specs on the page, asks the core which blocks they need, and downloads just those files.`,
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
        code: `await BCLoader.load({\n  base: '${cdnBase(release.version)}', // default: the folder of loader.js\n  blocks: ['interaction.zoom'],  // extra blocks besides the ones the page uses\n  scan: true,                    // read the specs on the page (default)\n  mount: true,                   // draw them when loaded (default)\n  integrity: true,               // put the SRI hashes of manifest.json on the script tags\n});`,
        label: 'JavaScript',
      },
    ],
  });

  // ── 3. ES module ──
  const moduleSpec = {
    data: 'sales',
    size: [720, 280],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } },
    ],
    marks: [
      { type: 'rect', x: 'region', y: 'total', radius: 3 },
      { type: 'text', x: 'region', y: 'total', text: 'total', format: 'compact', baseline: 'auto', dy: -5 },
    ],
    interaction: [{ type: 'tooltip', formats: { total: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } } }],
  };
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
        p: `A component draws in its mount hook and cleans up in its unmount hook. <code>destroy()</code> removes the listeners and the elements the chart made; <code>update(spec)</code> redraws with a new spec and keeps the zoom. For React, Vue, Svelte and Angular that component is written already: <a href="${root}embed/frameworks/">the wrappers</a>.`,
        code: `import BC from 'blockcharts/kits/basic.mjs';\n\nexport function mountChart(element, rows, spec) {\n  BC.data('rows', rows);            // last call for a name wins\n  const chart = BC.chart(element, { ...spec, data: 'rows' });\n  return {\n    update: (next) => chart.update({ ...next, data: 'rows' }),\n    destroy: () => chart.destroy(),\n  };\n}`,
        label: 'JavaScript',
      },
    ],
  });

  // ── 3b. the framework wrappers ──
  // the module page's chart without a dataset name (the element is given its rows) and with clicks
  const elementSpec = { ...moduleSpec, size: [720, 260], interaction: moduleSpec.interaction.concat([{ type: 'click' }]) };
  delete elementSpec.data;
  pages.push({
    file: 'frameworks.html',
    title: 'React, Vue, Svelte and <block-chart>',
    description:
      'blockcharts charts as components: wrappers for React, Vue 3 and Svelte, and a custom element for Angular or any page, with clicks on the data and server rendering.',
    lead: 'Each wrapper is a subpath of the npm package with no blocks of its own: it draws with the kit your app imports once, so the app carries only the blocks it chose. React, Vue and Svelte are optional peer dependencies; the custom element needs no framework.',
    sections: [
      {
        h: 'Any framework, or none: the custom element',
        p: "Importing <code>blockcharts/element</code> defines <code>&lt;block-chart&gt;</code>. Give it a spec and the chart's own rows as properties (or the spec as JSON in a <code>spec</code> attribute) and listen for <code>bc-click</code>. Click a bar:",
        html: `<block-chart id="regions"></block-chart>
<pre class="out" id="picked">Click a bar.</pre>

<script type="module">
  import '${kit('basic.mjs')}';
  import '${root}release/frameworks/element.mjs';

  const chart = document.getElementById('regions');
  chart.spec = ${indent(pretty(elementSpec), '  ')};
  chart.data = ${json(sales)};
  chart.addEventListener('bc-click', (e) => {
    document.getElementById('picked').textContent = JSON.stringify(e.detail.values);
  });
</script>`,
        note: 'In an app the two imports are <code>blockcharts/kits/basic.mjs</code> and <code>blockcharts/element</code>. The element has no shadow DOM, so your <code>--bc-*</code> variables and <code>.bc-*</code> styles reach the chart.',
      },
      {
        h: 'React',
        p: '<code>onClick</code> gets the clicked row and adds <code>{"type": "click"}</code> to the spec when it has none. The ref has <code>setView</code>, <code>getView</code> and <code>chart</code>, the chart as drawn now. React 18 and later; on a server the component renders an empty <code>&lt;div&gt;</code>.',
        ...framework('react'),
      },
      {
        h: 'Vue 3',
        p: '<code>@click</code> is a click on the data, with the row. A reactive spec may be changed in place: the chart follows it. Vue 3.3 and later.',
        ...framework('vue'),
      },
      {
        h: 'Svelte',
        p: 'An action, plain JavaScript: nothing has to compile it, and it works in Svelte 4 and 5.',
        ...framework('svelte'),
      },
      {
        h: 'Angular',
        p: 'Angular sets properties on custom elements and listens to their events, so <code>&lt;block-chart&gt;</code> is the component; <code>CUSTOM_ELEMENTS_SCHEMA</code> lets the template use it.',
        ...framework('angular'),
      },
      {
        h: 'What every wrapper does',
        p: "The chart is drawn again only when the spec changes in content or <code>data</code> is a new array: rendering the same spec again costs nothing, and rows changed in place are not seen, so give a new array. The rows are kept in the data lake under a name of the chart's own and taken away with it; without <code>data</code>, the spec's <code>data</code> names a dataset given to <code>BC.data</code>, which several charts can share. A page with no kit gets a message in the chart's place, not an exception. Types come with every wrapper.",
      },
    ],
  });

  // ── 4. the API ──
  const days = 90;
  const apiSpec = lineSpec('visits', 'day', {
    size: [720, 320],
    interaction: [
      { type: 'zoom', fit: ['y'] },
      { type: 'brush', fit: ['y'] },
      { type: 'legend-filter' },
      { type: 'tooltip', content: 'tip' },
    ],
  });
  // the embedding page's card: the same 90 days (the same numbers as makeRows below), made here
  const apiNext = rng(7);
  const apiRows = [];
  ['web', 'app', 'email'].forEach((channel, c) => {
    let level = 200 - c * 60;
    for (let d = 0; d < days; d++) {
      level = Math.max(20, level + (apiNext() - 0.47) * 24);
      apiRows.push({ day: new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10), channel, visits: Math.round(level) });
    }
  });
  const apiCardSpec = lineSpec('days90', 'day', {
    size: [440, 200],
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y' },
      { type: 'legend', scale: 'color', position: 'top' },
    ],
    interaction: [{ type: 'zoom', fit: ['y'] }, { type: 'tooltip' }],
  });
  pages.push({
    file: 'api.html',
    title: 'Control a chart from your code',
    lead: 'BC.chart returns a handle. Use it to move the visible window, swap the spec while keeping the zoom, and put your own content in the tooltip.',
    card: {
      lead: 'The handle <code>BC.chart</code> returns moves the visible window and swaps the spec, keeping the zoom. Try the buttons:',
      data: { days90: apiRows },
      html: `<div id="e-api"></div>
<div class="bar"><button type="button" id="e-api-march">Zoom to March</button><button type="button" id="e-api-kind">Points / lines</button><button type="button" id="e-api-reset">Reset</button></div>`,
      script: `var spec = ${json(apiCardSpec)};
var chart = BC.chart(document.getElementById('e-api'), spec);
document.getElementById('e-api-march').onclick = function () { chart.setView('x', [Date.UTC(2024, 2, 1), Date.UTC(2024, 2, 31)]); };
document.getElementById('e-api-reset').onclick = function () { chart.setView('x', null); };
document.getElementById('e-api-kind').onclick = function () {
  var mark = spec.marks[0];
  mark.type = mark.type === 'line' ? 'point' : 'line';
  chart.update(spec);
};`,
      code: `const chart = BC.chart(element, spec);
chart.setView('x', [march1, march31]);
chart.update(nextSpec); // keeps the zoom`,
      lang: 'javascript',
    },
    sections: [
      {
        h: 'The handle',
        p: 'The buttons call <code>setView</code>, <code>update</code> and <code>getView</code>. With a mouse or a trackpad, scroll with Ctrl held, or drag, to zoom on the chart itself, then press <em>Log view</em>. Press <em>Points / lines</em> while zoomed: <code>update</code> keeps the zoom.',
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

  // ── 4b. clicks ──
  const REGIONS = ['North', 'South', 'East', 'West'];
  const next = rng(11);
  const orders = [];
  REGIONS.forEach((region, i) => {
    let level = 40 + i * 9;
    for (const month of MONTHS) {
      level = Math.round(level * (0.88 + next() * 0.3));
      orders.push({ month, region, orders: level });
    }
  });
  const totals = REGIONS.map((region) => ({
    region,
    orders: orders.filter((r) => r.region === region).reduce((a, r) => a + r.orders, 0),
  }));
  const clickBars = {
    data: 'totals',
    size: [720, 240],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y', title: 'Orders, first half' },
    ],
    marks: [{ type: 'rect', x: 'region', y: 'orders', radius: 3 }],
    interaction: [{ type: 'tooltip' }, { type: 'click' }],
  };
  const clickLine = {
    data: 'picked',
    size: [720, 220],
    scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x', format: 'month' },
      { type: 'axis', scale: 'y' },
    ],
    marks: [
      { type: 'line', x: 'month', y: 'orders' },
      { type: 'point', x: 'month', y: 'orders', fill: 'var(--bc-c0, #3a6fe4)' },
    ],
    interaction: [{ type: 'tooltip' }],
  };
  pages.push({
    file: 'clicks.html',
    title: 'Clicks on the data',
    description:
      'Make a chart clickable: a click on a bar, a point or a slice sends a bc-click event with the row, and your code opens a page, filters another chart or shows details.',
    lead: 'With <code>{"type": "click"}</code> among the interactions, a click on a bar, a point, a slice or a cell sends a <code>bc-click</code> event with its row. What happens next is your code: open a page, filter another chart, show the details.',
    card: {
      lead: 'A click on a bar sends <code>bc-click</code> with its row. Here it picks the region the line below shows:',
      data: { totals },
      html: `<div id="e-clicks">
${chartTag({
  ...clickBars,
  size: [440, 150],
  guides: [
    { type: 'grid', scale: 'y' },
    { type: 'axis', scale: 'x' },
    { type: 'axis', scale: 'y' },
  ],
})}
<div id="e-clicks-detail"></div>
</div>`,
      script: `var orders = ${json(orders)};
var spec = ${json({ ...clickLine, size: [440, 130] })};
function region(name) {
  BC.data('picked', orders.filter(function (r) { return r.region === name; }));
  spec.title = name + ', orders by month';
  return spec;
}
var detail = BC.chart(document.getElementById('e-clicks-detail'), region('North'));
document.getElementById('e-clicks').addEventListener('bc-click', function (e) {
  detail.update(region(e.detail.values.region));
});`,
      code: `host.addEventListener('bc-click', (e) => {
  const row = e.detail.values;
  showRegion(row.region);
});`,
      lang: 'javascript',
    },
    sections: [
      {
        h: 'One chart picks what another shows',
        p: 'Click a bar: the line below shows that region by month. The event bubbles, so one listener on the document serves every chart of the page.',
        html: `<script src="${kit('basic.js')}"></script>

${dataTag({ totals, orders })}

${chartTag(clickBars)}

<div id="detail"></div>
<pre class="out" id="clicked">Click a bar.</pre>

<script>
  var lake = JSON.parse(document.getElementById('bc-data').textContent);
  var spec = ${indent(pretty(clickLine), '  ').trimStart()};
  function region(name) {
    BC.data('picked', lake.orders.filter(function (r) { return r.region === name; }));
    spec.title = name + ', orders by month';
    return spec;
  }
  var detail = BC.chart(document.getElementById('detail'), region('North'));

  document.addEventListener('bc-click', function (e) {
    var row = e.detail.values;              // { region: 'South', orders: 312 }
    detail.update(region(row.region));
    document.getElementById('clicked').textContent = JSON.stringify(row) + (e.detail.event.shiftKey ? ', with Shift' : '');
  });
</script>`,
        note: 'A drag (a pan, a brush) is not a click, a double click sends one, and a click on a legend item stays the legend filter\'s. Over what can be clicked the pointer is a hand; <code>{"type": "click", "cursor": false}</code> keeps it as it is.',
      },
      {
        h: 'What the event carries',
        p: "<code>values</code> is the row with every column, not only the ones the mark reads. <code>row</code> is its index in the chart's table (<code>table</code>, after the transforms) and <code>rows</code> every row a shape stands for (a line, a hexbin). <code>mark</code> and <code>markIndex</code> say which mark of the spec was hit, <code>x</code> and <code>y</code> where it is in the chart, and <code>event</code> is the browser's click, with its modifier keys. What a click hits is what the tooltip shows there. In TypeScript the event is typed by <code>bc.d.ts</code>.",
        code: `chart.host.addEventListener('bc-click', (e) => {
  // e: CustomEvent<BC.ClickDetail>
  const { values, row, rows, mark, markIndex, x, y, table, event } = e.detail;
  if (event.metaKey || event.ctrlKey) window.open('/regions/' + encodeURIComponent(String(values.region)));
});`,
        label: 'JavaScript',
      },
      {
        h: 'Not in a report file',
        p: `A report made by the composer from a <code>page.json</code> has no script of yours to receive the event, so there the block is a warning. In React, Vue and Svelte the wrappers take an <code>onClick</code> instead: <a href="${root}embed/frameworks/">the wrappers</a>.`,
      },
    ],
  });

  // ── 5. themes ──
  const themeSpec = {
    data: 'sales',
    size: [520, 220],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y', format: 'compact' },
    ],
    marks: [{ type: 'rect', x: 'region', y: 'total', radius: 2 }],
    interaction: [{ type: 'tooltip' }],
  };
  pages.push({
    file: 'theme.html',
    title: 'Colors and themes',
    lead: 'Every color of a chart comes from CSS variables, on SVG and on canvas alike: one stylesheet themes them, dark mode is a media query, and print works.',
    card: {
      lead: 'Every color is a CSS variable, on SVG and on canvas alike. Pick a theme: only a class on the box changes.',
      data: { sales },
      html: `<div class="e-theme" id="e-theme">
${chartTag({ ...themeSpec, size: [440, 190] })}
</div>
<div class="bar" id="e-theme-pick"><button type="button" aria-pressed="true" data-class="">This site</button><button type="button" aria-pressed="false" data-class="theme-warm">Warm</button><button type="button" aria-pressed="false" data-class="theme-mono">Mono</button><button type="button" aria-pressed="false" data-class="theme-neon">Neon</button></div>`,
      script: `var box = document.getElementById('e-theme');
var buttons = Array.prototype.slice.call(document.querySelectorAll('#e-theme-pick button'));
buttons.forEach(function (b) {
  b.onclick = function () {
    box.className = ('e-theme ' + b.getAttribute('data-class')).trim();
    buttons.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
  };
});`,
      code: `.warm {
  --bc-c0: #c1440e; /* first color */
  --bc-grid: #f0e2d0;
  --bc-text: #5b3a1e;
}`,
      lang: 'css',
    },
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
        code: `.my-theme {\n  --bc-text: #5b3a1e;        /* text in the chart and its tooltip */\n  --bc-label: #7a5634;       /* quieter labels: ticks, legend (default: --bc-text) */\n  --bc-axis: #b08968;        /* axis lines and ticks */\n  --bc-grid: #f0e2d0;        /* grid lines */\n  --bc-tooltip-bg: #fff8ee;  /* tooltip background */\n  --bc-c0: #c1440e;          /* category colors, --bc-c0 ... --bc-c7 */\n  --bc-c1: #e29a3b;\n  --bc-c2: #7a4e2d;\n  --bc-brush-fill: rgba(43, 108, 176, .15);  /* selection rectangle of the brush */\n  --bc-brush-line: #2b6cb0;\n}\n\n@media (prefers-color-scheme: dark) {\n  .my-theme { --bc-text: #d6d3d1; --bc-grid: #2a2826; /* ... */ }\n}`,
        label: 'CSS',
      },
    ],
  });

  // ── 5b. your own block ──
  const targetSpec = {
    data: 'sales',
    size: [640, 260],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true, domain: [0, 80000] } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y', format: 'compact' },
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
          { type: 'text', x: x + w, y: y - 6, text: spec.label || String(spec.value), anchor: 'end', size: 11, weight: 600, style: { fill: 'var(--bc-text, #444)' } },
        ],
      };
    },
  });
</script>`;
  pages.push({
    file: 'block.html',
    title: 'Your own block',
    description:
      'Write a chart block of your own: a small script that registers with BC.define, is named by type in the spec, and is carried only by the pages that use it.',
    lead: 'A block is a small classic script that registers itself with BC.define. The built-in ones are made exactly this way, so a block of your own is a first-class part of the chart: the spec names it by type, and only the pages that use it carry it.',
    card: {
      lead: 'A block is a small script calling <code>BC.define</code>, as the built-in ones are. This dashed target line is twenty lines in the page:',
      data: { sales },
      html: `${targetBlock}
${chartTag({ ...targetSpec, size: [440, 200], transforms: [{ type: 'sort', field: 'total', order: 'desc' }] })}`,
      code: `BC.define({
  role: 'guide',
  type: 'target',
  version: 1,
  params: { value: { kind: 'number' } },
  render(spec, ctx) { /* shapes */ },
});`,
      lang: 'javascript',
    },
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
        p: 'Six roles, one contract (<code>src/bc.d.ts</code>): a <b>scale</b> maps values, a <b>transform</b> reshapes rows, a <b>mark</b> turns rows into shapes, a <b>guide</b> explains a scale, an <b>interaction</b> listens to the reader, a <b>renderer</b> draws. Marks and guides return plain shapes (path, rect, circle, text, group) with CSS-variable colors, so a block of your own follows themes and dark mode, and works on the canvas renderer too. A scale says what it makes of a value and what it takes (<code>output: "position"</code>, <code>input: "number"</code>), and each channel of a mark accepts scales by these, never by name: a scale of your own is drawn by every mark, axis, legend and zoom that takes what it declares. Give it <code>requires</code> and the composer and the loader bring its dependencies along. Defining the same block twice is harmless.',
      },
    ],
  });

  // ── 6. data forms ──
  const rnd = rng(11);
  const N = 2000;
  const xs = [],
    ys = [];
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
    [
      'gzip + base64',
      gzB64,
      'The JSON of rows or columns, gzipped and base64-encoded. The composer does this by itself for big datasets. Needs DecompressionStream: Chrome and Edge 80, Firefox 113, Safari 16.4.',
    ],
    [
      'Binary columns',
      binary,
      'Numeric columns as raw values, gzipped, base64: what a data pipeline can write. Integers use the smallest integer type; floats stay 64-bit, so nothing is lost.',
    ],
  ];
  const dataSpec = (name) => ({
    data: name,
    size: [520, 200],
    scales: { x: { type: 'linear' }, y: { type: 'linear' } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y' },
    ],
    marks: [{ type: 'line', x: 't', y: 'v' }],
    interaction: [{ type: 'tooltip' }],
  });
  const dataHtml = `<script src="${kit('basic.js')}"></script>
<script type="application/json" id="bc-data">${json({ rows, columns: columns, gz: gzB64, binary })}</script>
<div class="cols">
${forms.map(([label, ,], i) => `  <div class="demo"><p class="muted" style="margin:0 0 4px">${label}</p>${chartTag(dataSpec(['rows', 'columns', 'gz', 'binary'][i])).replace(/\n/g, ' ')}</div>`).join('\n')}
</div>`;
  pages.push({
    file: 'data.html',
    title: 'Ways to hand over data',
    lead: 'The same 2000-point series, four ways. They draw the same picture; they differ in how many bytes the page carries.',
    card: {
      lead: 'Rows, columns, gzip or binary columns: the same 2000 points draw the same picture. What each form costs the page:',
      data: { forms: forms.map(([form, value]) => ({ form, kb: Math.round((size(value) / 1024) * 10) / 10 })) },
      html: chartTag({
        data: 'forms',
        size: [440, 190],
        padding: { right: 64 },
        scales: { y: { type: 'band' }, x: { type: 'linear', zero: true, nice: true } },
        guides: [{ type: 'axis', scale: 'y' }],
        marks: [
          { type: 'rect', y: 'form', x: 'kb', radius: 2 },
          { type: 'text', y: 'form', x: 'kb', text: 'kb', format: { maximumFractionDigits: 1, suffix: ' KB' }, anchor: 'start', dx: 6 },
        ],
        interaction: [{ type: 'tooltip', labels: { kb: 'In the page' }, formats: { kb: { maximumFractionDigits: 1, suffix: ' KB' } } }],
      }),
      code: `{ "columns": {
    "t": [0, 1, 2],
    "v": [50.2, 50.9, 51.4]
} }`,
      lang: 'json',
    },
    sections: [
      {
        h: 'Four datasets, one result',
        p: 'All four charts below read a dataset of 2000 rows. Datasets that are encoded are decoded in the background; a chart shows a placeholder until its data is ready, and reports a clear error (naming the column) if the data is broken.',
        htmlLiveOnly: dataHtml,
        extraAfter: `<table class="stack"><thead><tr><th>Form</th><th>Size in the page</th><th>What it is</th></tr></thead><tbody>
${forms.map(([label, value, what]) => `<tr><td>${label}</td><td data-label="in the page">${kb(size(value))}</td><td class="doc">${what}</td></tr>`).join('\n')}
<tr><td>Binary, v as float32</td><td data-label="in the page">${kb(size(binary32))}</td><td class="doc">Halves the values that are not integers, keeps about 7 digits. Only when you ask for it.</td></tr>
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
    let u = 0,
      v = 0;
    while (!u) u = brng();
    while (!v) v = brng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const bx = [],
    by = [];
  [
    [1200, 1300, 380, 260],
    [2600, 2500, 300, 420],
    [3000, 1000, 240, 240],
  ].forEach(([cx, cy, sx, sy]) => {
    for (let i = 0; i < 7000; i++) {
      bx.push(Math.max(0, Math.min(4095, Math.round(cx + gauss() * sx))));
      by.push(Math.max(0, Math.min(4095, Math.round(cy + gauss() * sy))));
    }
  });
  const bigData = { points: encodeColumns({ x: bx, y: by }) };
  const bigSpec = (renderer) => ({
    data: 'points',
    renderer,
    size: [520, 360],
    scales: { x: { type: 'linear', nice: true }, y: { type: 'linear', nice: true } },
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y' },
    ],
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
    description:
      'Draw tens of thousands of points: the same chart spec on one canvas instead of an SVG element per mark, with zoom and tooltips as before.',
    lead: 'An SVG chart makes a DOM element for every mark. Fine for thousands, slow for tens of thousands. Add <code>"renderer": "canvas"</code> to the spec and the same chart is drawn on one canvas.',
    card: {
      lead: '21,000 points on one canvas instead of an element each, with zoom (Ctrl and the wheel) and a tooltip as on SVG:',
      data: bigData,
      html: chartTag({ ...bigSpec('canvas'), size: [440, 240] }),
      code: `{
  "data": "points",
  "renderer": "canvas",
  "marks": [{ "type": "point", ... }]
}`,
      lang: 'json',
    },
    sections: [
      {
        h: 'The same 21,000 points, two renderers',
        p: 'Both charts read one dataset and have the same spec except <code>renderer</code>. Zoom, pan, tooltip, legend filter, colors and dark mode work the same. Time the redraws on your machine:',
        html: canvasHtml(json(bigData)),
        shown: canvasHtml('{"points": {"columns": {"x": {...}, "y": {...}}}}  /* two binary columns, see "Ways to hand over data" */'),
        note: 'Numbers depend on the machine; on the one this page was made on, Chrome redraws these 21,000 points 5 to 6 times faster on the canvas (about 190 ms against 35). A single long <em>line</em> is one path element either way, so it gains little from a canvas: reduce it with the <code>decimate</code> transform instead.',
      },
      {
        h: 'What is different on a canvas',
        p: "A canvas has no elements, so a few things that come from elements do not exist: CSS classes on marks, the browser's native hover title, and text selection inside the chart. Colors still come from your CSS variables, and the chart repaints when the color scheme or the container width changes. Charts are sharp on high-density screens (the backing store follows <code>devicePixelRatio</code>, up to 3). The renderer is a block like any other: kits that include it are <code>timeseries</code> and <code>full</code>.",
      },
    ],
  });

  return pages;
}

/** The embedding page: one live chart and the code that draws it in each way in (the app snippets, a kit, the loader),
 *  then a card for each page that shows more, with a live piece of its demo. `lake` is every dataset the page draws. */
function embedIndex(root, release) {
  const pages = embedPages(root, release);
  const page = (file) => {
    const p = pages.find((x) => x.file === file);
    if (!p) throw new Error(`no embed page ${file}`);
    return p;
  };
  const href = (file) => `${root}embed/${file.replace(/\.html$/, '')}/`;
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  // the chart of the app snippets (appSpec), with the dataset of a page and the click their onClick adds
  const spec = {
    data: 'sales',
    size: [460, 380],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y', format: 'compact' },
    ],
    marks: [{ type: 'rect', x: 'region', y: 'total' }],
    interaction: [{ type: 'tooltip' }, { type: 'click' }],
  };
  const inPage = (first) => `${first}

${dataTag({ sales })}

${chartTag(spec)}

<script>
  document.addEventListener('bc-click', (e) => openRegion(e.detail.values.region));
</script>`;
  const app = (id) => {
    const { name, code, lang } = FRAMEWORKS.find((f) => f.id === id);
    return { id, name, code, lang };
  };
  const wrappers = page('frameworks.html');
  const ways = [
    {
      ...app('react'),
      note: 'A ready component from <code>blockcharts/react</code>: a spec, your rows, and <code>onClick</code> with the clicked row. On a server it renders an empty element, and the chart is drawn in the browser.',
      page: wrappers,
    },
    {
      ...app('vue'),
      note: 'A ready component from <code>blockcharts/vue</code>; <code>@click</code> gets the clicked row. A reactive spec may be changed in place: the chart follows it.',
      page: wrappers,
    },
    { ...app('svelte'), note: 'An action from <code>blockcharts/svelte</code>, plain JavaScript: Svelte 4 and 5.', page: wrappers },
    {
      ...app('angular'),
      note: 'The custom element <code>&lt;block-chart&gt;</code> from <code>blockcharts/element</code>: for Angular, Lit, Solid or any page.',
      page: wrappers,
    },
    {
      ...app('js'),
      note: 'No framework: import a kit as an ES module. <code>BC.chart(element, spec)</code> draws and returns a handle to update, zoom or destroy the chart.',
      page: page('module.html'),
    },
    {
      id: 'kit',
      name: 'Script tag',
      note: `No build: a kit is the core and a set of blocks in one file, ${kb(release.kits.basic.js.gzip)} gzipped for bars, lines and areas. The chart is JSON in the HTML.`,
      code: inPage(`<script src="${cdnBase(release.version)}kits/basic.js"></script>`),
      lang: 'html',
      page: page('kit.html'),
    },
    {
      id: 'loader',
      name: 'Loader',
      note: `A ${kb(release.loader.bytes)} script reads the specs on the page and fetches the core and only the blocks they use.`,
      code: inPage(`<script src="${cdnBase(release.version)}loader.js" data-auto></script>`),
      lang: 'html',
      page: page('loader.html'),
    },
  ].map(({ page: p, ...w }) => ({ ...w, href: href(p.file), more: p.title }));

  const cards = pages.filter((p) => p.card).map((p) => ({ ...p.card, title: p.title, href: href(p.file) }));
  // one lake for the page: a name two cards share must hold the same rows
  const lake = { sales };
  for (const c of cards)
    for (const [name, rows] of Object.entries(c.data)) {
      if (name in lake && json(lake[name]) !== json(rows)) throw new Error(`embedding page: two cards name different data "${name}"`);
      lake[name] = rows;
    }
  return { lake, start: { spec, ways }, cards };
}

module.exports = { embedPages, embedIndex, monthly, lineSpec, cdnBase, FRAMEWORKS };
