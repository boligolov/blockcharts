# blockcharts

**[blockcharts.online](https://blockcharts.online)** · [the principles](docs/spec/principles.md) · [the documentation](docs/README.md)

**Atomic charts for HTML dashboards: a page carries only the chart code it needs. Nothing more.**

blockcharts is a chart library cut into atoms — a scale, a bar, an axis, a tooltip, each a block of 0.4–6 KB.
A page gets the core (10 KB gzipped) and exactly the blocks its own charts use, never the whole library;
anything can be customized, down to blocks of your own. The agent skill turns a table or a CSV file into one
light `.html` report with interactive charts that opens offline and can be emailed.

## Install the skill

**Claude Code** — from this repository, which is a plugin marketplace:

```
/plugin marketplace add boligolov/blockcharts
/plugin install blockcharts@blockcharts
```

**Claude.ai and Claude Desktop** — download **[blockcharts.skill](https://blockcharts.online/blockcharts.skill)**
and upload it under *Settings → Capabilities → Skills* (skills need code execution enabled).

**Any other agent that reads skill folders** — copy [`skills/blockcharts/`](skills/blockcharts/) into its
skills folder (`~/.claude/skills/` for Claude Code). It needs Node.js 18+.

Then ask — *"an HTML report of monthly revenue by region from sales.csv"*, *"a dashboard of these KPIs"*.
Scopes and details: [docs/skill.md](docs/skill.md).

## How it works

Charts are drawn by small independent **blocks** (`scale.time`, `mark.rect`, `guide.axis`,
`interaction.zoom`, …). A chart is a JSON spec that names them; the blocks a page needs are read from its
specs, closed over their dependencies, and only those go into the page: a bar chart with a tooltip carries
8 of the 27 blocks, 43 KB of code instead of 92. Nobody lists blocks by hand, so the list is never too long.

The agent never writes chart code. It writes the JSON, and a composer bundled with the skill checks every
chart against the real data, reports each mistake with its place in the JSON, and only then writes the page.

**Customizable at every level**: block parameters (formats, locales, axes, tooltips), CSS variables and
classes (brand colors, dark mode, print), your own set of blocks (a kit per page, or the loader), functions
by name (`BC.defineFn`), and blocks of your own — a small script calling `BC.define`, the same contract the
built-in blocks use ([an example](https://blockcharts.online/embed/block/)).

## The principles behind it

[`docs/spec/principles.md`](docs/spec/principles.md) — *blockcharts principles v1.0*: how a report is built
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

The composer works out which blocks the charts need, checks every spec against the data (unknown field, wrong scale type, ... each reported with its path in the JSON), builds each chart once in a sandbox to catch anything that only shows up when drawing, and writes the page. The same input always gives the same bytes. It writes nothing until every chart is valid.

Datasets can be rows, `{"columns": {...}}`, `{"csv": "text"}`, or `{"csvFile": "orders.csv"}` (next to `page.json`). Large datasets are stored gzipped automatically. For long numeric series from a pipeline, `scripts/encode-columns.js` stores columns as raw typed values (`{"columns": {"t": {"dtype": "float64", "encoding": "gzip+base64", "data": "..."}}}`): far smaller than JSON text, and never lossy unless you ask for `float32`.

Ready-made pages to copy live in `skills/blockcharts/recipes/`: bar, stacked bar, lines with zoom, scatter, dual axis, 100% stacked area, histogram, heatmap, pie, long series, dashboard, and a CSV report with aggregation and currency formatting.

#### 2. Kits: core + blocks in one file

```sh
npm run release          # writes release/
```

```html
<script src="https://cdn.example.com/blockcharts/0.1.0/kits/timeseries.js"></script>

<script type="application/json" id="bc-data">{ "d": [ { "day": "2024-01-01", "v": 1200 }, { "day": "2024-02-01", "v": 3400 } ] }</script>
<script type="application/json" data-bc-chart>
  { "data": "d", "scales": { "x": { "type": "time" }, "y": { "type": "linear", "zero": true } },
    "guides": [ { "type": "axis", "scale": "x" }, { "type": "axis", "scale": "y", "format": "compact" } ],
    "marks": [ { "type": "line", "x": "day", "y": "v" } ] }
</script>
```

Charts mount themselves on `DOMContentLoaded`. Or call `BC.chart(element, spec)` yourself and keep the returned handle (`setView`, `getView`, `update`, `destroy`, `ready`).

| Kit | Contents | Minified (gzip) |
| --- | --- | --- |
| `basic` | bars, lines, points, areas, text; linear/time/band/color scales; axis, grid, legend, tooltip | 53 KB (19 KB gzip) |
| `timeseries` | lines, areas; zoom, brush, zoom buttons, legend filter, decimate, aggregate, stack; canvas | 74 KB (26 KB) |
| `composition` | stacked bars/areas, pie, heatmap, histogram, boxplot, aggregate, legend filter | 72 KB (25 KB) |
| `full` | every block | 92 KB (32 KB) |

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
// <script src="node_modules/blockcharts/kits/timeseries.js"> or through a CDN: unpkg / jsdelivr serve the same files
```

Every kit has a `.d.mts`; `blockcharts/bc.d.ts` declares the global `BC` and every spec type. `npm pack` and `npm publish` build the release first (`prepack`).

#### 3. The loader: separate files, fetched on demand

```html
<script src="https://cdn.example.com/blockcharts/0.1.0/loader.js" data-auto></script>
<!-- your data and <script data-bc-chart> specs -->
```

The loader reads `manifest.json` next to it, loads the core, asks it which blocks the charts on the page need, loads those (and their dependencies), and mounts. Manual control:

```js
await BCLoader.load({
  base: 'https://cdn.example.com/blockcharts/0.1.0/', // default: the folder of loader.js
  blocks: ['interaction.zoom'],   // extra blocks besides the ones found in the page
  scan: true,                     // find charts on the page (default)
  mount: true,                    // mount them when loaded (default)
  integrity: true,                // put the manifest's SRI hashes on the script tags
});
```

#### Pinning with SRI

`release/manifest.json` lists a `sha384` hash for every file, ready for the `integrity` attribute:

```html
<script src=".../kits/basic.js" integrity="sha384-..." crossorigin="anonymous"></script>
```

Always pin a version in the CDN path; files of a version never change.

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

| Role | Blocks |
| --- | --- |
| scale | `linear`, `time`, `band`, `color`, `sequential` |
| transform | `stack`, `bin`, `decimate`, `aggregate`, `quartiles` |
| mark | `point`, `line`, `rect`, `area`, `text`, `arc`, `boxplot` |
| guide | `axis`, `grid`, `legend` |
| interaction | `zoom`, `zoom-controls`, `tooltip`, `legend-filter`, `brush` |
| renderer | `svg`, `canvas` |

Every parameter of every block is documented in [`skills/blockcharts/reference/blocks.md`](skills/blockcharts/reference/blocks.md) (generated from the code by `npm run skill`).

Custom tooltip content is a function registered in a script with `BC.defineFn(name, fn)` and referenced from the spec by name (`"content": "name"`), so specs stay plain JSON.

## Website

`site/` is an [Astro](https://astro.build) project: a gallery with every recipe live (its JSON, the composed report, the HTML to embed it), demos of every way to embed (one script tag, the loader, an ES module, the handle API with a custom tooltip, themes, data forms), a guide, and the block reference generated from the code. Every snippet shown is the code that runs above it.

```sh
npm run site                       # builds the library, the release and the site -> site/dist, then checks links and charts
SITE_BASE=/blockcharts/ npm run site   # for a site served from a subfolder (GitHub Pages)
cd site && npm install && npm run dev  # develop it (run npm run build and npm run manifest in the repo root first)
```

The site has its own `package.json`, so the library itself keeps no dependencies except esbuild for the release. `scripts/check-site.js` checks the result without a browser: every link, script and anchor resolves, and every chart spec on every page is valid against the data on that page.

## Development

```sh
npm install
npm test          # build, manifest, then core/blocks, canvas, composer, CSV, skill and release tests
npm run skill     # refresh the skill's generated parts (skills/blockcharts), write dist/blockcharts.skill
npm run release   # CDN files, kits, loader -> release/ (minified)
npm run site      # the website -> site/dist
```

Layout, tests and releasing: [docs/development.md](docs/development.md). What is left to do:
[ROADMAP.md](ROADMAP.md). Design decisions: [docs/Design.md](docs/Design.md).

## Browser support

Modern evergreen browsers. The composer needs Node 18+. Gzipped datasets use `DecompressionStream`.

## License

[MIT](LICENSE).
