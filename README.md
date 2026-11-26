# blockcharts

[![npm](https://img.shields.io/npm/v/blockcharts?color=2563eb)](https://www.npmjs.com/package/blockcharts)
[![CI](https://github.com/boligolov/blockcharts/actions/workflows/ci.yml/badge.svg)](https://github.com/boligolov/blockcharts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)

**Atomic charts for apps, pages and reports: each carries only the chart code it needs. Nothing more.**

blockcharts is a chart library cut into atoms — a scale, a bar, an axis, a tooltip, each a block of <!-- build:block-range -->0.4–12 KB<!-- /build -->.
Wherever the charts go, they bring the core (about <!-- build:core-gzip -->12 KB<!-- /build --> gzipped) and the blocks they use, never the whole library.
Charts are described in JSON, drawn in SVG or on a canvas, and every part can be customized, down to blocks of your own.

One chart spec goes anywhere: a ready component in a React, Vue, Svelte or Angular app, one `<script>` in a page of
your own, or a standalone HTML report that opens from disk, made by a script or by Claude with the blockcharts skill.

**[Website](https://blockcharts.online)** · **[Gallery](https://blockcharts.online/examples/)** · **[Guide](https://blockcharts.online/guide/)** · **[Blocks](https://blockcharts.online/blocks/)** · **[Benchmarks](https://blockcharts.online/benchmarks/)** · [Principles](docs/spec/principles.md)

[![An executive dashboard made with blockcharts: KPI tiles with sparklines, revenue against plan, revenue by channel, a waterfall and a checkout funnel](https://raw.githubusercontent.com/boligolov/blockcharts/main/docs/images/executive-dashboard.png)](https://blockcharts.online/examples/executive-dashboard/)

*KPI tiles, a trend against plan, a donut, a waterfall and a funnel,
[live in the gallery](https://blockcharts.online/examples/executive-dashboard/).*

## Quick start

In an app: install the package, import a kit once (the blocks your app carries) and use a component.

```sh
npm install blockcharts
```

```jsx
import 'blockcharts/kits/basic.mjs'; // once, before a chart mounts
import { BlockChart } from 'blockcharts/react';

const spec = {
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
  marks: [{ type: 'rect', x: 'region', y: 'total' }],
  interaction: [{ type: 'tooltip' }],
};

// rows: [{ region: 'North', total: 42 }, { region: 'South', total: 58 }, …]
export const Regions = ({ rows }) => <BlockChart spec={spec} data={rows} />;
```

Vue, Svelte and Angular have theirs ([below](#react-vue-svelte-and-block-chart)). Without a framework:

```js
import BC from 'blockcharts/kits/basic.mjs';

BC.data('sales', rows); // named: several charts can share it
const chart = BC.chart(document.getElementById('chart'), { ...spec, data: 'sales' }); // update, setView, getView, destroy, ready
```

In a page of your own, with no build: one script tag, and the chart in JSON where it should appear.

```html
<script src="https://cdn.jsdelivr.net/npm/blockcharts@0.0.5/release/kits/basic.js"></script>

<script type="application/json" id="bc-data">
  { "sales": [ { "region": "North", "total": 42 }, { "region": "South", "total": 58 }, { "region": "East", "total": 31 } ] }
</script>
<script type="application/json" data-bc-chart>
  { "data": "sales",
    "scales": { "x": { "type": "band" }, "y": { "type": "linear", "zero": true } },
    "guides": [ { "type": "axis", "scale": "x" }, { "type": "axis", "scale": "y" } ],
    "marks": [ { "type": "rect", "x": "region", "y": "total" } ],
    "interaction": [ { "type": "tooltip" } ] }
</script>
```

Charts draw themselves when the page loads. And a report to send around, one HTML file that opens anywhere, comes
from [the composer](#the-composer-one-standalone-report), or from Claude with
[the blockcharts skill](#for-ai-agents-the-blockcharts-skill).

## Why blockcharts

- **Only the code your charts use.** An app imports a [kit](#kits), the core and the blocks for a kind of chart. The
  loader and the composer go further and read the blocks a page needs from its specs, closed over their
  dependencies: a bar chart with labels and a tooltip carries <!-- build:bar -->10 of the 59 blocks, 71 KB of code instead of 216<!-- /build -->; a whole
  executive dashboard (KPI tiles, a trend, a donut, a waterfall, a funnel, animated) carries <!-- build:dashboard-blocks -->24<!-- /build -->. Nobody lists
  blocks by hand, so the list is never too long.
- **One chart, wherever it lives.** The same JSON spec draws in a component of a React, Vue, Svelte or Angular app
  (rendered on a server too: the chart is drawn in the browser), in a page with one script tag, and in a report
  file that opens from disk, offline, can be emailed or printed, and loads nothing from the network. The components
  are tested in real apps, each built by its own tools: Vite, SvelteKit, Next.js and the Angular CLI.
- **Charts are data, checked before they are drawn.** A chart is a plain JSON spec, not code. Its
  [JSON Schema](#json-schema) lets an editor complete and check it as you type; it is checked against the real data,
  and every mistake comes back with its place in the JSON.
- **Customizable at every level.** Block parameters (formats, locales, axes, tooltips), CSS variables and classes
  (brand colors, dark mode, print), your own set of blocks, functions by name (`BC.defineFn`), and blocks of your
  own — a small script calling `BC.define`, the same contract the built-in blocks use
  ([an example](https://blockcharts.online/embed/block/)).
- **Fast, and light with heavy data.** A canvas renderer for tens of thousands of points, decimation, aggregation,
  and large datasets stored gzipped in a report. [The benchmarks](https://blockcharts.online/benchmarks/) time it
  against Chart.js, ECharts, uPlot, Observable Plot, Recharts, ApexCharts and Plotly drawing the same charts.
- **No dependencies.** Plain ES2020 in every modern browser, typed for TypeScript, MIT-licensed.

What it is built on: [the blockcharts principles](docs/spec/principles.md), v<!-- build:principles-version -->1.1<!-- /build -->.

## What it draws

Bars (stacked, grouped, 100%), lines and areas, scatter and bubbles, hexbins and density contours, pie and donut,
heatmaps and calendars, histograms, boxplots and violins, waterfalls, funnels, treemaps, sankey and marimekko
diagrams, candlesticks, KPI tiles with sparklines, bullet and target lines — with tooltips, a crosshair, zoom and
brush, legend filters and animation.

Every kind is live in the [gallery](https://blockcharts.online/examples/), with its JSON and the HTML to embed it. The
<!-- build:recipes -->48<!-- /build --> ready-made pages behind it are in [`skills/blockcharts/recipes/`](skills/blockcharts/recipes/), to copy.

## Ways to ship it

| You want | Use |
| --- | --- |
| Charts in a React, Vue, Svelte or Angular app | the **npm package** and its **components**: `blockcharts/react`, `/vue`, `/svelte`, `/element` |
| Charts in an app with no framework, from a bundler | the **npm package**: `import BC from 'blockcharts/kits/basic.mjs'`, `BC.chart` |
| Charts in your own page, one `<script>` | a **kit**: the core and a set of blocks in one file |
| Each page to fetch only what it uses | the **loader**: `loader.js`, the core and single block files |
| One report file, nothing to host | the **composer**: JSON and data in, one HTML file out (the Claude skill runs it for you) |

### npm

```sh
npm install blockcharts
```

```js
import BC from 'blockcharts';                    // the full kit, typed
import BC from 'blockcharts/kits/basic.mjs';     // a smaller kit
import manifest from 'blockcharts/manifest.json' with { type: 'json' };
const BC = require('blockcharts');               // CommonJS: the same full kit
```

The package carries the built files: kits, single blocks, the loader, the manifest, the types, the JSON Schemas and
the framework wrappers. Every kit has a
`.d.mts` (and a `.d.ts` for `require`); `blockcharts/bc.d.ts` declares the global `BC` and every spec type. A
`<script src>` names the file where it is: `node_modules/blockcharts/release/kits/basic.js`.

### React, Vue, Svelte and `<block-chart>`

A wrapper is a subpath of the package with no blocks of its own: it draws with the kit the app imported once, so the
app carries only the blocks it chose.

```jsx
import 'blockcharts/kits/basic.mjs'; // once, before a chart mounts
import { BlockChart } from 'blockcharts/react';

<BlockChart spec={spec} data={rows} onClick={(d) => openRegion(d.values.region)} />;
```

```vue
<script setup>
import 'blockcharts/kits/basic.mjs';
import { BlockChart } from 'blockcharts/vue';
</script>

<template>
  <BlockChart :spec="spec" :data="rows" @click="(d) => openRegion(d.values.region)" />
</template>
```

```svelte
<script>
  import 'blockcharts/kits/basic.mjs';
  import { blockchart } from 'blockcharts/svelte';
</script>

<div use:blockchart={{ spec, data: rows, onClick: (d) => openRegion(d.values.region) }}></div>
```

```js
// Angular (with CUSTOM_ELEMENTS_SCHEMA), Lit, Solid or a plain page
import 'blockcharts/kits/basic.mjs';
import 'blockcharts/element'; // defines <block-chart>

const el = document.createElement('block-chart');
el.spec = spec; // or <block-chart spec='{"data": "sales", ...}'>
el.data = rows;
el.addEventListener('bc-click', (e) => openRegion(e.detail.values.region)); // with {"type": "click"} in the spec
```

- `spec` is a chart spec. `data` is the chart's own rows, `{"columns": {...}}` or an encoded dataset, kept under a
  name of its own while the chart lives and taken away after; left out, the spec's `data` names a dataset given to
  `BC.data`.
- The chart is drawn again only when the spec changes in content or `data` is a new array or object. Rendering the
  same spec again costs nothing, and rows changed in place are not seen: give a new array.
- `onClick` (`@click` in Vue) gets the clicked row ([Clicks](#clicks)) and adds `{"type": "click"}` to the spec when it
  has none; the kit must have that block (all of them do).
- The React ref and the Vue component's ref have `chart` (the handle: `diagnostics`, `getView`), `setView` and
  `getView`; `<block-chart>` has `el.chart`.
- On a server a component renders an empty `<div>`, and the chart is drawn after mount. Without a kit on the page the
  chart's place says which one to import, and the app goes on.
- React 18 and later, Vue 3.3 and later, Svelte 4 and 5 (the action is plain JavaScript): optional peer
  dependencies. The custom element needs no framework.

### Kits

A kit is the core and a set of blocks in one file: a classic script (`kits/<name>.js`) or an ES module
(`kits/<name>.mjs`, `export default BC`; browsers load modules over http and https only, not from `file://`). An app
imports one from the package, a page loads one with a script tag.

<!-- build:kits -->

| Kit | Blocks | Contents | Minified (gzip) |
|---|---|---|---|
| `basic` | 20 | Bars, lines, points and areas on linear, log, time and band scales, with axes, grid, legend, tooltip and click events, and fields calculated from the data. | 114 KB (43 KB) |
| `timeseries` | 30 | Long series over time: lines and areas with zoom, brush, legend filter, decimation, aggregation, wide tables, moving averages and click events; also the canvas renderer for very large series. | 142 KB (52 KB) |
| `composition` | 34 | Parts of a whole and distributions: stacked bars and areas, pie, heatmap, histogram, boxplot, waterfall, funnel, treemap, aggregation, click events. | 150 KB (55 KB) |
| `dashboard` | 32 | Business dashboards: KPI tiles with sparklines, bars, lines and areas, waterfall, funnel, treemap, bullet and target lines, donut, with axes, grid, legend, tooltip, legend filter and click events. | 151 KB (56 KB) |
| `full` | 59 | Every block. | 228 KB (82 KB) |

<!-- /build -->

Everything is minified (esbuild, ES2020) and stripped of the parameter docs, which a running chart never reads.
Charts mount themselves on `DOMContentLoaded`; or call `BC.chart(element, spec)` and keep the handle.

### The loader

```html
<script src="https://cdn.jsdelivr.net/npm/blockcharts@0.0.5/release/loader.js" data-auto></script>
<!-- your data and <script data-bc-chart> specs -->
```

The loader reads `manifest.json` next to it, loads the core, asks it which blocks the charts on the page need, loads
only those (with their dependencies) and draws. By hand:

```js
await BCLoader.load({
  base: 'https://cdn.jsdelivr.net/npm/blockcharts@0.0.5/release/', // default: the folder of loader.js
  blocks: ['interaction.zoom'],   // extra blocks besides the ones found in the page
  scan: true,                     // find charts on the page (default)
  mount: true,                    // draw them when loaded (default)
  integrity: true,                // put the manifest's SRI hashes on the script tags
});
```

### CDN and integrity

jsDelivr and unpkg serve every file of the package at its path in it:
`https://cdn.jsdelivr.net/npm/blockcharts@<version>/release/<file>` (or `https://unpkg.com/blockcharts@<version>/release/<file>`),
where `<file>` is `core.js`, `blocks/<role.type>.js`, `kits/<name>.js` or `.mjs`, `loader.js`, `manifest.json`,
`bc.d.ts`, `schema/chart.schema.json` or `schema/page.schema.json`. Pin an exact version (`@0.0.5`, not `@0` or
`@latest`): files of a version never change, and `manifest.json` lists a `sha384` hash of every file for the
`integrity` attribute:

```html
<script src="https://cdn.jsdelivr.net/npm/blockcharts@0.0.5/release/kits/basic.js" integrity="sha384-..." crossorigin="anonymous"></script>
```

### The composer: one standalone report

The composer is a script of this repository, not part of the npm package: run it in a clone.

```sh
git clone https://github.com/boligolov/blockcharts.git
cd blockcharts
npm install
npm run build && npm run manifest
node scripts/compose.js skills/blockcharts/recipes/report-from-csv.json report.html
```

`page.json`:

```json
{
  "title": "Sales",
  "data": { "sales": [ { "region": "North", "total": 42 }, { "region": "South", "total": 58 } ] },
  "charts": [
    {
      "title": "Sales by region",
      "spec": {
        "data": "sales",
        "scales": { "x": { "type": "band" }, "y": { "type": "linear", "zero": true } },
        "guides": [ { "type": "grid", "scale": "y" }, { "type": "axis", "scale": "x" }, { "type": "axis", "scale": "y" } ],
        "marks": [ { "type": "rect", "x": "region", "y": "total" } ],
        "interaction": [ { "type": "tooltip" } ]
      }
    }
  ]
}
```

The composer works out which blocks the charts need, checks every spec against the data (an unknown field, a wrong
scale type, … each reported with its path in the JSON), draws each chart once in a sandbox to catch what only shows
up when drawing, and writes the page; nothing is written until every chart is valid. Having checked everything, the
page carries a lighter core, without the checks and, unless a dataset is stored gzipped, without the data decoder:
about <!-- build:core-saving -->14 KB<!-- /build --> less per report. The same input always gives the same bytes.

Datasets can be rows, `{"columns": {...}}`, `{"csv": "text"}`, or `{"csvFile": "orders.csv"}` (next to `page.json`);
large ones are stored gzipped automatically. A dashboard is the same file with a grid: `"layout": {"columns": 4}` and
a `span` per chart (KPI tiles `span: 1`, a trend `span: 3`), with a `title` and a `subtitle` on top. Every chart sits
in a card, and on a phone the cards stack.

## How a chart is described

```json
{
  "data": "sales",
  "size": [640, 320],
  "transforms": [ { "type": "aggregate", "groupby": ["region"], "measures": [ { "op": "sum", "field": "total", "as": "sum" } ] } ],
  "scales": { "x": { "type": "band" }, "y": { "type": "linear", "zero": true } },
  "guides": [ { "type": "axis", "scale": "y", "title": "Revenue", "format": { "style": "currency", "currency": "USD" } } ],
  "marks": [ { "type": "rect", "x": "region", "y": "sum" } ],
  "interaction": [ { "type": "tooltip" }, { "type": "zoom" } ]
}
```

Scales are declared once and named. Marks read data through channels (`"x": "region"` means the field `region` on
the scale named `x`). Guides attach to scales, not to marks, and several scales per direction are fine (a dual axis).
A block is named by its `type`, so `{"type": "rect"}` is `mark.rect`. Custom tooltip content is a function registered
with `BC.defineFn(name, fn)` and named in the spec (`"content": "name"`), so specs stay plain JSON.

### Clicks

`{"type": "click"}` among the interactions makes the data clickable: a click or a tap on a bar, a point, a slice or a
cell sends `bc-click` from the chart's element. It bubbles, so one listener can serve every chart of a page:

```js
document.addEventListener('bc-click', (e) => {
  const { values, row, mark, event } = e.detail; // values: { region: 'North', total: 42 }
  if (event.metaKey || event.ctrlKey) window.open('/regions/' + values.region);
});
```

`values` is the row with every column, not only the ones the mark reads; `row` is its index in the chart's table
(`table`), and `rows` every row a shape stands for (a line, a hexbin). `mark` and `markIndex` say which mark was hit,
`x` and `y` where it is in the chart, and `event` is the browser's click with its modifier keys. What a click hits is
what the tooltip shows there. A drag (a pan, a brush) is not a click, a double click sends one, a click on a legend
item stays the legend filter's, and the pointer is a hand over what can be clicked (`"cursor": false` keeps it as
it is). In TypeScript the event is typed: `HTMLElementEventMap['bc-click']` is `CustomEvent<BC.ClickDetail>`.

A report made by the composer has no script of its own to receive the event, so there the block is a warning.

### JSON Schema

A spec and a `page.json` have a JSON Schema each, made from the blocks themselves: every block, parameter, channel
and value it may take, with its documentation. Name it in the file, and an editor completes keys and block types,
explains each on hover, and underlines a mistake while you type:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/blockcharts@0.0.5/release/schema/page.schema.json",
  "title": "Sales",
  "data": { "sales": [ { "region": "North", "total": 42 } ] },
  "charts": [ { "spec": { "data": "sales", "marks": [ { "type": "rect", "x": "region", "y": "total" } ] } } ]
}
```

A chart spec on its own takes `schema/chart.schema.json`. The core and the composer accept the `$schema` key and
ignore it. Both schemas are draft-07, also in the package (`blockcharts/schema/chart.schema.json`) for a validator
such as Ajv. They catch what has no data behind it (an unknown block or key, a wrong value); a field missing from
the data is caught only by `BC.validate` and the composer, which read the data.

## Blocks

The <!-- build:blocks -->59<!-- /build --> blocks, by role:

<!-- build:roles -->

| Role | Blocks |
|---|---|
| lib | `columns`, `curve`, `pointer`, `stats`, `ticks`, `view` (code other blocks share; a spec never names it) |
| scale | `band`, `color`, `linear`, `log`, `sequential`, `size`, `time` |
| transform | `aggregate`, `bin`, `calculate`, `calendar`, `contour`, `decimate`, `density`, `filter`, `fold`, `funnel`, `hexbin`, `highlight`, `marimekko`, `quartiles`, `sankey`, `sort`, `stack`, `treemap`, `waterfall`, `window` |
| mark | `arc`, `area`, `boxplot`, `candlestick`, `line`, `point`, `polygon`, `rect`, `rule`, `sankey`, `text`, `violin` |
| guide | `axis`, `grid`, `kpi`, `legend` |
| interaction | `animate`, `brush`, `click`, `crosshair`, `legend-filter`, `tooltip`, `zoom`, `zoom-controls` |
| renderer | `canvas`, `svg` |

<!-- /build -->

Every parameter of every block: [the block reference](https://blockcharts.online/blocks/), also in
[`skills/blockcharts/reference/blocks.md`](skills/blockcharts/reference/blocks.md).

## Browser support

Chrome and Edge 80, Firefox 74, Safari 14.1 or later: the code is ES2020, and compact numbers (`12K`) are `Intl`'s. A
dataset stored gzipped, which the composer does with a large one, is read with `DecompressionStream`: Firefox 113 and
Safari 16.4 (Chrome and Edge 80); an older browser shows a message in the chart's place. The composer needs Node 22+.

## Development

```sh
npm install
npm test                # build, then the core, blocks, canvas, composer, CSV, skill and release tests
npm run test:chrome     # layout in a real browser (the system Chrome)
npm run test:frameworks # the components with React, Vue and Svelte, in Chrome
npm run test:apps       # six real apps, each built by its own tools (npm ci --prefix test/apps first)
npm run bench           # blockcharts and seven other libraries, timed (npm ci --prefix test/bench first)
npm run release         # kits, single blocks and the loader -> release/
npm run skill           # the skill's generated parts and the figures this README quotes
```

Layout, tests, the website and releasing: [docs/development.md](docs/development.md). What is left to do:
[ROADMAP.md](ROADMAP.md). Design decisions: [docs/Design.md](docs/Design.md).

## For AI agents: the blockcharts skill

An agent skill turns a table or a CSV file into one light `.html` report with interactive charts. The agent writes
only the JSON; the composer bundled with the skill checks every chart against the data and writes the page.

**Claude Code** — from this repository, which is a plugin marketplace:

```
/plugin marketplace add boligolov/blockcharts
/plugin install blockcharts@blockcharts
```

It updates by itself once auto-update is on for the marketplace (`/plugin` → *Marketplaces*), or by hand with
`claude plugin update blockcharts@blockcharts`.

**Claude.ai and Claude Desktop** — download **[blockcharts.skill](https://blockcharts.online/blockcharts.skill)**
and upload it under *Settings → Capabilities → Skills* (skills need code execution enabled).

**Any other agent that reads skill folders** — copy [`skills/blockcharts/`](skills/blockcharts/) into its skills
folder (`~/.claude/skills/` for Claude Code). It needs Node.js 22+.

Then ask — *"an HTML report of monthly revenue by region from sales.csv"*, *"a dashboard of these KPIs"*. Scopes and
details: [docs/skill.md](docs/skill.md). The skill is versioned apart from the library (`metadata.version` in
`SKILL.md`, `version` in its `plugin.json`), so that Claude Code offers each update.

## License

[MIT](LICENSE).
