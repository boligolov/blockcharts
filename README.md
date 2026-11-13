# blockcharts

**[blockcharts.online](https://blockcharts.online)** · [the principles](docs/spec/principles.md) · [the documentation](docs/README.md)

**Atomic charts for HTML dashboards: a page carries only the chart code it needs. Nothing more.**

blockcharts is a chart library cut into atoms — a scale, a bar, an axis, a tooltip, each a block of <!-- build:block-range -->0.4–12 KB<!-- /build -->.
A page gets the core (about <!-- build:core-gzip -->12 KB<!-- /build --> gzipped) and exactly the blocks its own charts use, never the whole library;
anything can be customized, down to blocks of your own. The agent skill turns a table or a CSV file into one
light `.html` report with interactive charts that opens offline and can be emailed.

## Install the skill

**Claude Code** — from this repository, which is a plugin marketplace:

```
/plugin marketplace add boligolov/blockcharts
/plugin install blockcharts@blockcharts
```

It updates by itself once auto-update is on for the marketplace (`/plugin` → *Marketplaces*), or by hand with
`claude plugin update blockcharts@blockcharts`.

**Claude.ai and Claude Desktop** — download **[blockcharts.skill](https://blockcharts.online/blockcharts.skill)**
and upload it under *Settings → Capabilities → Skills* (skills need code execution enabled).

**Any other agent that reads skill folders** — copy [`skills/blockcharts/`](skills/blockcharts/) into its
skills folder (`~/.claude/skills/` for Claude Code). It needs Node.js 22+.

Then ask — *"an HTML report of monthly revenue by region from sales.csv"*, *"a dashboard of these KPIs"*.
Scopes and details: [docs/skill.md](docs/skill.md).

## How it works

Charts are drawn by small independent **blocks** (`scale.time`, `mark.rect`, `guide.axis`,
`interaction.zoom`, …). A chart is a JSON spec that names them; the blocks a page needs are read from its
specs, closed over their dependencies, and only those go into the page: a bar chart with labels and a tooltip
carries <!-- build:bar -->10 of the 58 blocks, 71 KB of code instead of 214<!-- /build -->; a whole executive dashboard
(KPI tiles, a trend, a donut, a waterfall, a funnel, animated) carries <!-- build:dashboard-blocks -->24<!-- /build -->. Nobody lists blocks by hand, so the list is never too long.

The agent never writes chart code. It writes the JSON, and a composer bundled with the skill checks every
chart against the real data, reports each mistake with its place in the JSON, and only then writes the page.

**Customizable at every level**: block parameters (formats, locales, axes, tooltips), CSS variables and
classes (brand colors, dark mode, print), your own set of blocks (a kit per page, or the loader), functions
by name (`BC.defineFn`), and blocks of your own — a small script calling `BC.define`, the same contract the
built-in blocks use ([an example](https://blockcharts.online/embed/block/)).

## The principles behind it

[`docs/spec/principles.md`](docs/spec/principles.md) — *blockcharts principles v<!-- build:principles-version -->1.1<!-- /build -->*: how a report is built
from blocks so that a page carries exactly the code its charts need — and what follows from that.

- **Exactly what the charts need, nothing more** (§1): blocks are chosen mechanically from the specs, never by hand.
- **Blocks are atoms** (§2): one role, one job; a bar chart is `band + linear + rect`, a new chart is a recipe.
- **Customizable at every level** (§3): parameters, CSS, your own set of blocks, functions, your own blocks.
- **The page is the product** (§4): one HTML file that opens from disk, offline, anywhere.
- **The chart is data** (§5–6), **checked before it is written** (§7).
- **Heavy data stays light** (§8), **same input, same bytes** (§9), **nothing leaves the page** (§10).
- **One set of files, three ways in** (§11) and the **requirements** for pages, blocks and composers (§12).

## The library for your own pages

The same blocks work without the skill.

### Three ways to use it

| You want | Use | Files |
| --- | --- | --- |
| One report file, nothing to host | the **composer** | `node scripts/compose.js page.json report.html` |
| Charts in your own page, one `<script>` from a CDN | a **kit** | `release/kits/<name>.js` (or `.mjs`) |
| Fetch only what a page uses, from a CDN or a folder | the **loader** | `release/loader.js` + `core.js` + `blocks/*.js` |

#### 1. The composer: JSON in, one HTML file out

```sh
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

The composer works out which blocks the charts need, checks every spec against the data (unknown field, wrong scale type, ... each reported with its path in the JSON), builds each chart once in a sandbox to catch anything that only shows up when drawing, and writes the page. The same input always gives the same bytes. It writes nothing until every chart is valid. Because it has already checked everything, the page carries a lighter core without the checks (`BC.validate`, `BC.needs`), and without the data decoder unless a dataset is stored gzipped: about <!-- build:core-saving -->14 KB<!-- /build --> less per report. The kits for your own pages keep the full core.

Datasets can be rows, `{"columns": {...}}`, `{"csv": "text"}`, or `{"csvFile": "orders.csv"}` (next to `page.json`). Large datasets are stored gzipped automatically. For long numeric series from a pipeline, `scripts/encode-columns.js` stores columns as raw typed values (`{"columns": {"t": {"dtype": "float64", "encoding": "gzip+base64", "data": "..."}}}`), never lossy unless you ask for `float32`. Against the gzip a page gets anyway this saves about a third on small integers and a seventh on floats with every digit, and nothing on values rounded to a few decimals; `float32` takes floats to about a third.

A dashboard is the same file with a grid: `"layout": {"columns": 4}` and a `span` per chart (KPI tiles `span: 1`, a trend `span: 3`); `title` and `subtitle` head the page. Every chart sits in a card; on a phone the cards stack.

Ready-made pages to copy live in `skills/blockcharts/recipes/`, <!-- build:recipes -->48<!-- /build --> of them, among them an executive dashboard (KPI tiles in a grid), waterfall, funnel, bullet, treemap, bar, stacked and grouped bars, dot plot, boxplot, lines with zoom, a slope chart, a moving average and running totals, scatter, a hexbin and density contours of thousands of points, bubbles, dual axis, 100% stacked area, histogram, heatmap, pie, long series, and a CSV report with aggregation and currency formatting.

#### 2. Kits: core + blocks in one file

```sh
npm run release          # writes release/
```

```html
<script src="https://cdn.jsdelivr.net/npm/blockcharts@0.0.1/release/kits/timeseries.js"></script>

<script type="application/json" id="bc-data">{ "d": [ { "day": "2024-01-01", "v": 1200 }, { "day": "2024-02-01", "v": 3400 } ] }</script>
<script type="application/json" data-bc-chart>
  { "data": "d", "scales": { "x": { "type": "time" }, "y": { "type": "linear", "zero": true } },
    "guides": [ { "type": "axis", "scale": "x" }, { "type": "axis", "scale": "y", "format": "compact" } ],
    "marks": [ { "type": "line", "x": "day", "y": "v" } ] }
</script>
```

Charts mount themselves on `DOMContentLoaded`. Or call `BC.chart(element, spec)` yourself and keep the returned handle (`setView`, `getView`, `update`, `destroy`, `ready`).

<!-- build:kits -->

| Kit | Blocks | Contents | Minified (gzip) |
|---|---|---|---|
| `basic` | 19 | Bars, lines, points and areas on linear, log, time and band scales, with axes, grid, legend and tooltip, and fields calculated from the data. | 112 KB (42 KB) |
| `timeseries` | 29 | Long series over time: lines and areas with zoom, brush, legend filter, decimation, aggregation, wide tables and moving averages; also the canvas renderer for very large series. | 140 KB (51 KB) |
| `composition` | 33 | Parts of a whole and distributions: stacked bars and areas, pie, heatmap, histogram, boxplot, waterfall, funnel, treemap, aggregation. | 148 KB (54 KB) |
| `dashboard` | 31 | Business dashboards: KPI tiles with sparklines, bars, lines and areas, waterfall, funnel, treemap, bullet and target lines, donut, with axes, grid, legend, tooltip and legend filter. | 149 KB (55 KB) |
| `full` | 58 | Every block. | 226 KB (81 KB) |

<!-- /build -->

Everything in `release/` is minified (esbuild, ES2020) and stripped of the parameter docs, which a running chart never reads; `buildRelease({ minify: false })` keeps the readable code for debugging. Kits are defined in `kits.json`. A kit made for one page contains exactly the blocks that page uses:

```sh
node scripts/build-dist.js --page page.json=report     # adds release/kits/report.js
```

`kits/<name>.mjs` is the same code as an ES module with `export default BC` (browsers load modules over http/https only, not `file://`).

#### From npm

The package ships the minified files of `release/` (kits, blocks, loader, manifest, types) and resolves them through `exports`:

```js
import BC from 'blockcharts';                    // the full kit, typed
import BC from 'blockcharts/kits/basic.mjs';     // a smaller kit
import manifest from 'blockcharts/manifest.json' with { type: 'json' };
const BC = require('blockcharts');               // CommonJS: the same full kit
// a <script src> names the file where it is: node_modules/blockcharts/release/kits/timeseries.js (exports are for import/require)
```

Every kit has a `.d.mts` (and a `.d.ts` for `require`); `blockcharts/bc.d.ts` declares the global `BC` and every spec type. `npm pack` and `npm publish` build the release first (`prepack`).

#### 3. The loader: separate files, fetched on demand

```html
<script src="https://cdn.jsdelivr.net/npm/blockcharts@0.0.1/release/loader.js" data-auto></script>
<!-- your data and <script data-bc-chart> specs -->
```

The loader reads `manifest.json` next to it, loads the core, asks it which blocks the charts on the page need, loads those (and their dependencies), and mounts. Manual control:

```js
await BCLoader.load({
  base: 'https://cdn.jsdelivr.net/npm/blockcharts@0.0.1/release/', // default: the folder of loader.js
  blocks: ['interaction.zoom'],   // extra blocks besides the ones found in the page
  scan: true,                     // find charts on the page (default)
  mount: true,                    // mount them when loaded (default)
  integrity: true,                // put the manifest's SRI hashes on the script tags
});
```

#### From a CDN

jsDelivr and unpkg serve every file of the npm package on its own, at the path it has in the package:
`https://cdn.jsdelivr.net/npm/blockcharts@<version>/release/<file>` (or `https://unpkg.com/blockcharts@<version>/release/<file>`),
where `<file>` is `core.js`, `blocks/<role.type>.js`, `kits/<name>.js` or `.mjs`, `loader.js`, `manifest.json` or `bc.d.ts`.
The loader takes the core and the blocks from the folder it came from, so it needs nothing more than its own address.

#### Pinning with SRI

`release/manifest.json` lists a `sha384` hash for every file, ready for the `integrity` attribute:

```html
<script src="https://cdn.jsdelivr.net/npm/blockcharts@0.0.1/release/kits/basic.js" integrity="sha384-..." crossorigin="anonymous"></script>
```

Always pin an exact version in the CDN path (`@0.0.1`, not `@0` or `@latest`); files of a version never change.

## Spec anatomy

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

Scales are declared once and named. Marks read data through channels (`"x": "region"` means field `region` on the scale named `x`). Guides attach to scales, not marks; several scales per axis direction are fine (dual axis). A block is referred to by its `type`, so `{"type": "rect"}` is `mark.rect`.

## Blocks

The <!-- build:blocks -->58<!-- /build --> blocks, by role:

<!-- build:roles -->

| Role | Blocks |
|---|---|
| lib | `columns`, `curve`, `pointer`, `stats`, `ticks`, `view` (code other blocks share; a spec never names it) |
| scale | `band`, `color`, `linear`, `log`, `sequential`, `size`, `time` |
| transform | `aggregate`, `bin`, `calculate`, `calendar`, `contour`, `decimate`, `density`, `filter`, `fold`, `funnel`, `hexbin`, `highlight`, `marimekko`, `quartiles`, `sankey`, `sort`, `stack`, `treemap`, `waterfall`, `window` |
| mark | `arc`, `area`, `boxplot`, `candlestick`, `line`, `point`, `polygon`, `rect`, `rule`, `sankey`, `text`, `violin` |
| guide | `axis`, `grid`, `kpi`, `legend` |
| interaction | `animate`, `brush`, `crosshair`, `legend-filter`, `tooltip`, `zoom`, `zoom-controls` |
| renderer | `canvas`, `svg` |

<!-- /build -->

Every parameter of every block is documented in [`skills/blockcharts/reference/blocks.md`](skills/blockcharts/reference/blocks.md) (generated from the code by `npm run skill`).

Custom tooltip content is a function registered in a script with `BC.defineFn(name, fn)` and referenced from the spec by name (`"content": "name"`), so specs stay plain JSON.

## Website

`site/` is an [Astro](https://astro.build) project: a gallery with every recipe live (its JSON, the composed report, the HTML to embed it), demos of every way to embed (one script tag, the loader, an ES module, the handle API with a custom tooltip, themes, data forms), a guide, and the block reference generated from the code. Every snippet shown is the code that runs above it.

```sh
npm run site                       # builds the library, the release and the site -> site/dist, then checks links and charts
SITE_BASE=/blockcharts/ npm run site   # for a site served from a subfolder (GitHub Pages)
npm run dev -w site                # develop it (run npm run build and npm run manifest first)
```

The site has its own `package.json` and is an npm workspace of the root: one `npm install` at the root installs both, into one `node_modules`, from one lockfile (Node 22.22.1 or later for the site). The library has no runtime dependencies, nor has the composer; the dev dependencies are the tools that build and test it: TypeScript, esbuild (minifying), fflate (the `.skill` zip, gzip sizes), Prettier and playwright-core (the Chrome checks, with the system Chrome). `scripts/check-site.js` checks the result without a browser: every link, script and anchor resolves, and every chart spec on every page is valid against the data on that page.

## Development

```sh
npm install
npm test          # build, manifest, then core/blocks, canvas, composer, CSV, skill and release tests
npm run test:chrome  # layout in a real browser (the system Chrome)
npm run skill     # refresh the skill's generated parts (skills/blockcharts) and the figures this README quotes, write dist/blockcharts.skill
npm run release   # CDN files, kits, loader -> release/ (minified)
npm run site      # the website -> site/dist
npm run test:site # every page of it in Chrome at phone widths
```

Layout, tests and releasing: [docs/development.md](docs/development.md). What is left to do:
[ROADMAP.md](ROADMAP.md). Design decisions: [docs/Design.md](docs/Design.md).

## Browser support

Chrome and Edge 80, Firefox 74, Safari 14.1 or later: the code is ES2020, and compact numbers (`12K`) are `Intl`'s. A
dataset stored gzipped, which the composer does with a large one, is read with `DecompressionStream`: Firefox 113 and
Safari 16.4 (Chrome and Edge 80); an older browser shows a message in the chart's place. The composer needs Node 22+.

## Versions

The skill and the library are versioned apart. The skill's version (`metadata.version` in `SKILL.md`, `version` in
its `plugin.json`) goes up with every change to `skills/blockcharts/`, the composer and the code it carries included,
so that Claude Code offers the update. The library's (`package.json`, the path of the CDN files, `BC.version`) goes up
with a release of the npm package.

## License

[MIT](LICENSE).
