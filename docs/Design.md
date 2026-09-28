# blockcharts — design notes

The design journal: every decision and why, in the order they were made. Started 2026-09-19 with only the
contracts (`src/bc.d.ts`); the current state is at the end of each section. Principles for users of the
library are in [spec/principles.md](spec/principles.md); how to work on the repository is in
[development.md](development.md).

## Goal

A modular chart framework for **standalone HTML** pages assembled by agents (a skill with the sources). The
point: never drag a 200 KB framework into a page, but embed exactly the logical blocks it needs.

## Decisions

| # | Decision |
|---|---|
| 1 | Sources in **TypeScript** (TS 7.0.2, no third-party dependencies). The developer builds them to JS; the built JS is the product. |
| 2 | No Python in the project. There is an abstract "composer" (an agent with the skill, or anyone) that assembles a page from blocks. |
| 3 | The agent writes **only a JSON spec**, never JS. Blocks are JS files with the logic, embedded into the page. |
| 4 | The main mode is **inline** (many small `<script>`s in the HTML). A CDN is the user's choice, not the priority. Bundles for specific charts come later. Hence blocks are as **idempotent** as possible. |
| 5 | **SVG** renderer only at first. Canvas later, as a separate block. |
| 6 | Data is a **data lake**: `<script type="application/json" id="bc-data">` with named datasets; charts refer to them by name. |
| 7 | Block naming: `<role>.<type>` (`scale.time`, `mark.rect`); the type in a spec is the second part of the name. |
| 8 | The core: the block registry, data loading, validation, the pipeline (spec → table → scales → layout → marks → renderer). Everything else is a block. |

## Block format

- Classic scripts **without `import`/`export`**: `<script type="module">` does not work from `file://`, and
  reports are opened from disk.
- Types are a global ambient namespace `BC` in `src/bc.d.ts`, so `tsc` emits a block as it is:
  `"use strict"; (function(){ BC.define({...}) })();`.
- Registration: `BC.define({ role, type, version, requires, params, ... })`. The name is derived from
  `role` + `type`.
- **Load order does not matter**: dependencies are resolved lazily at `BC.chart(...)`. A composer can simply
  concatenate files. A missing block gives a clear error such as `mark.rect requires scale.band`.
- **Idempotence**: `define` with the same name and version is a no-op; with another version, a warning, and
  the first one stays.

## Block roles

Blocks are split by **role**, not by chart type.

| Role | Examples |
|---|---|
| scale | linear, log, time, band, color |
| transform | stack, bin, aggregate |
| mark | line, area, point, rect, arc, text |
| guide | axis, grid, legend |
| interaction | tooltip, hover, zoom |
| renderer | svg (later canvas) |

`bar`, `pie`, `heatmap`, `histogram` are **not blocks** but recipes in the skill's documentation:
`bar = band + linear + rect`, `scatter = linear + linear + point`, `heatmap = band + band + rect + color`,
`pie = arc` (polar), `stacked bar = stack transform + rect`. That keeps the framework from turning into
"ECharts 2".

## The spec: fighting duplication

Inside a chart:
- **Scales are declared once** per chart and have names (`scales`).
- **Marks refer to scales by name** and create nothing of their own.
- **Guides (axes, grid, legend) attach to scales**, not to marks → a line and its points share the axes.
- The channel `"x": "date"` is the field `date` on the scale named after the channel (`x`). Explicitly:
  `{field, scale}`; a constant: `{value}`. A scale's domain is gathered automatically from every channel
  that refers to it.

Example:

```json
{
  "data": "sales",
  "scales": { "x": {"type":"time"}, "y": {"type":"linear"} },
  "guides": [ {"type":"axis","scale":"x"}, {"type":"axis","scale":"y"} ],
  "marks":  [ {"type":"line","x":"date","y":"revenue"},
              {"type":"point","x":"date","y":"revenue"} ]
}
```

### Several scales in one direction

A chart can have more than two scales: a second Y axis (other units), a second X axis, separate scales for
`color`/`size`. Scale names are free; marks refer to them explicitly with `{field, scale}`, and each scale's
domain is gathered only from the channels that name it. This works out of the box, with no duplication.

A separate question is **guides on one side**: two `guide.axis` bound to two `y` scales must not be drawn
on top of each other. For this `GuideSpec` has `position` (`top`/`right`/`bottom`/`left`); by default the
side follows the scale's `range` (`height` → `left`, `width` → `bottom`), and the second axis sets it
explicitly. The core runs `measure` over the guides in the order of `spec.guides`, sums the insets per side
for the final `plot` rectangle, and passes each guide's `render` the inset already claimed on its side
(`offset`) — so the second axis is drawn outside the first one, not over it.

A dual-axis chart:

```json
{
  "data": "sales",
  "scales": { "x": {"type":"time"}, "y": {"type":"linear"}, "y2": {"type":"linear"} },
  "guides": [
    {"type":"axis","scale":"x"},
    {"type":"axis","scale":"y"},
    {"type":"axis","scale":"y2","position":"right"}
  ],
  "marks": [
    {"type":"line","x":"date","y":"revenue"},
    {"type":"line","x":"date","y":{"field":"units","scale":"y2"}}
  ]
}
```

On a page:
- The blocks a page's charts need are found **mechanically** (`BC.needs(spec)` → names; the composer takes
  the union of the `closure`s from the manifest): the agent does not choose blocks and cannot get the list of
  dependencies wrong.
- Five charts with `guide.axis` put one `guide.axis` into the HTML.
- `define` is idempotent — insurance in case something is included twice.

## The manifest

`manifest.json` is **generated by the build**, never edited by hand:

- name, file, size, version, `requires`, `closure` (the transitive closure including the block itself), the
  parameter schema, channels, doc;
- `requires` is written once — in the `BC.define` call; the build script runs the built blocks against a
  stub `BC` that records the registration (no source parsing needed);
- the skill gives the agent the **manifest**, not the code of the blocks.

Risk: if an LLM copies 30 KB of JS into its answer, that is expensive and fragile. Assembly must be
**mechanical** (closures from the manifest + concatenating files), without the model.

**Implemented** (`scripts/build-manifest.js`, `scripts/compose.js`, `npm run manifest`):
- The manifest is built by running every block against a stub `BC` (in `vm`, with a timeout). The build fails
  with a clear list of all problems at once: a dependency cycle, `requires` of a block that does not exist, a
  file not named after its block (`<role>.<type>.js`), not exactly one `BC.define` in a file, a bad version, a
  syntax error, and `</script` or `<!--` inside a block's code (which would break an inline page).
- The composer is a pure function "JSON → HTML": `BC.needs` of every spec → union of closures from the
  manifest → exactly those blocks are loaded → **every spec is validated against the real data before the
  page is written** (spec errors = a `ComposeError` with paths, `allowErrors` for deliberate exceptions) →
  concatenation in a fixed order (core, blocks by role, data), so the same input gives a byte-identical file.
- Data, specs, titles and CSS cannot escape their tag: JSON in `<script>` escapes `<`, `>`, `&`, U+2028/2029;
  text is HTML-escaped; `</style` in CSS is neutralized. A test checks that data containing
  `</script><script>alert(1)` survives the round trip into the page and back unchanged.
- `include` adds blocks for hand-written scripts on the page that call `BC.chart` themselves (the composer
  does not see their specs). CLI: `node scripts/compose.js page.json out.html`.
- **Data compression:** `compress: "auto"` (the default) stores a dataset as base64(gzip(JSON)) when it is at
  least 2 KB and the encoded form is at most 75% of the original; `true` — always, `false` — never. Datasets
  that are already encoded pass through as they are, and specs are checked against their decoded content.
  gzip is deterministic, so the page stays byte-reproducible. The demo page went from 137 KB to 125 KB.
- **A spec is JSON only:** a function (and `NaN`/`Infinity`, a symbol, a bigint, a cycle) in a spec is a
  `ComposeError` with its path rather than a silent loss in `JSON.stringify`; the message points to
  `BC.defineFn`.
- **Default CSS:** typography and the chart theme variables (light and dark by `prefers-color-scheme`), in
  one `<style>` together with the caller's `css` (which comes after and wins); `defaultCss: false` turns it
  off.

## The display-list contract

Marks know nothing about SVG; they return primitives, and the renderer draws them.

- Primitives: `path`, `rect`, `circle`, `text`, `g`. Arcs and complex shapes go through `path` with an SVG
  `d` string (`Path2D` understands it too, so the canvas renderer reuses it).
- Layers from the bottom up: `grid`, `marks`, `axes`, `overlay`.
- Every primitive can carry `ref: {mark, row}` — an interaction uses it to find the data row from a DOM event.
- Colors are any CSS values, CSS variables included (theming).

## Cross-cutting principles

- The agent writes only JSON → no hallucinated JS APIs, no syntax errors, no security problems; the result is
  reproducible.
- The composer and the agent need not know about SVG/Canvas — that is the renderer's decision.
- Spec errors are caught by the core's validation (`BC.validate`), which throws nothing and returns
  diagnostics (`level`, `path`, `message`).
- Scaling is through `viewBox` (the SVG stretches to its container). The price: text scales with the chart.
  Acceptable for reports; the alternative (several layouts / recomputing layout in JS) is expensive and
  postponed.

## Known rough edges

1. **Two-pass layout.** Axes take space (`GuideDef.measure`), then `Scale.setRange` recomputes the range. The
   width of labels is estimated (`ctx.measure` without the DOM), so small misalignments are possible. With
   several guides on one side (`position`) the insets add up in the order of `spec.guides`, and each guide's
   `render` gets the inset already claimed on its side (`offset`) — see "Several scales in one direction".
   The labels of the outermost ticks stick out past the plot (they are centered on the tick): `measure`
   returns `overhang`, the core takes the maximum over the guides and widens the margin only where the inset
   and the space already taken are not enough; neighbouring guides do not move.
2. **`Scale<any, any>`.** Typing the domain per kind of scale with generics is too heavy; the core checks
   `ChannelDef.scales` at run time.
3. **Scales are not inferred:** a mark that refers to an undeclared scale gets a diagnostic. Defaults would be
   friendlier for an agent — can be decided later.
4. **Data:** the format of large columns (base64 `Float32Array`) for a future canvas was not described yet.
   (Since solved: binary columns, see "Aggregation, CSV, formatting".)
5. **Culling and decimation need order.** A column sorted by `x` (either way) is cut by binary search; an
   unsorted one, one with a gap in `x`, or the "long" format of several series in a row in one column is
   drawn whole (correct, but with no gain). For long-format series, `decimate` with `group` helps: it splits
   the series itself.

## The recompute layer for zoom/pan (level 1 implemented)

A pipeline with stages:

```
1 table  →  2 transforms  →  3 domains  →  4 layout  →  5 ticks  →  6 marks  →  7 render
```

- **Zoom changes only a scale's domain** (the view) and invalidates stages 3, 5, 6, 7. Stages 1, 2 (except
  view-dependent ones) and 4 are left alone. The layout is **frozen** after the first pass, so the chart does
  not jump as the width of the labels changes.
- **The view is first-class state**: `{ spec, table, view: Record<scaleName, domain> }`. An interaction draws
  nothing; it calls `live.setView('x', [a, b])`; the core merges calls through `requestAnimationFrame` and
  recomputes from stage 3. One mechanism for zoom, pan, brush and external control.
- The core caches the result of each stage and can `invalidate(fromStage)`. Layers are cached separately;
  hover and selection live in `overlay` and do not rebuild the marks.

Three levels of cost:
1. **A full recompute every frame** — enough for report charts (up to a few thousand primitives). **Start
   here.**
2. **Gesture preview:** during a gesture a CSS/SVG `transform` is put on the group of marks, with no
   recompute; at the end (or after a debounce), a real recompute. Needs
   `vector-effect: non-scaling-stroke`. Only pan and one-axis zoom in the preview (circles distort when
   scaled).
3. **DOM patching:** `Rendered.update(list)` reuses elements by their `ref` key instead of recreating them.

**View-dependent data** (the one real complication):
- culling (only the points in the domain, binary search over a sorted `x`);
- level of detail for lines (min/max per pixel column, LTTB);
- bin/heatmap whose binning gets finer when zooming in;
- `y` following the visible window (`zoom: { x: true, y: "auto" }`).

Proposed: make them `TransformDef`s with a `viewDependent: true` flag and the signature
`apply(table, spec, view)`; on zoom only they rerun. Culling is **automatic** (the core cuts the rows to the
visible domain for a sorted `x`), with a flag to turn it off. *A proposal, not yet final.*

**Implemented (`bc.d.ts`, the core, blocks):**
- `Scale.setDomain(d | null)` and `baseDomain()`; `domain()` is the current (view) domain. All scales work
  this way: linear, time, band.
- `LiveCtx.setView` / `getView`, the same methods on `ChartHandle` (external control); `ChartSpec.view` — the
  starting zoom. `getView()` returns the *requested* view (it is applied at the next frame), `baseDomain()`
  for scales that are not zoomed. Interactions compute from it, so several events within one frame add up
  correctly.
- `Rendered.update(list)` is required, and `root` does not change on update: interactions attach their
  listeners to it once. `renderer.svg` redraws the content of the `<svg>` whole (level 3, patching by `ref`, is
  not done).
- Stages 1–4 (table, transforms, scales, layout) run once; the layout is frozen. A change of view:
  `applyView` → stages 5–7 (ticks, marks and guides, `update`), calls merged per frame.
- `ChartCtx.ticks(scale)`: the core computes ticks, once per frame, and gives them to every guide, so an axis
  and its grid always match. The default count follows the plot size (`h/40` vertically, `w/80`
  horizontally).
- `ChartCtx.rows(mark)`: a hook for culling. Marks already iterate `from..to`, the whole table for now;
  culling becomes an optimization of the core alone, with no change to blocks.
- `ChartCtx.color(i)`: the theme palette in one place instead of a copy in every mark.
- The `marks` layer gets `clip = plot` only while there is a view: without zoom, points on the edge of the
  domain would be cut in half.

**`y` following the window** (done): `LiveCtx.fit(scale, follow)` creates a temporary scale with the same
block and spec, but only over the rows inside the requested window of `follow` (visibility is computed in
pixels of a temporary copy of `follow`, so it works the same for linear, time and band); `interaction.zoom`
with `fit: ["y"]` calls it after every change of the window. No visible rows or no zoom → `null`, and the
scale goes back to its full domain.

**Culling** (done): `ctx.rows(mark)` returns, instead of the whole table, the rows inside the window while
the scale is zoomed and the column bound to it is sorted (either way). The order is determined once per
column and scale; for numbers through a continuous scale by the raw values, otherwise in pixel space (so it
works with date strings too). The bounds are found by binary search, with a 12 px margin and one neighbouring
row on each side: a line reaches the edge, and a window between two rows still draws its segment.
`channel()` maps only the rows in the window (the rest are NaN). Marks did not change: they already iterated
`from..to`. An equivalence test: the same chart with one row without `x` (which turns culling off) draws
exactly the same thing in the window.

**`viewDependent` transforms and LOD** (done): a transform with `viewDependent: true` and everything after it
rerun at every redraw with `view = { plot, scales }`; the ones before run once. Scale domains are still
inferred from the full data; `ctx.table` is the current (thinned) table. An error of such a transform does not
break the chart (the last successful table stays) and is not repeated in the diagnostics.
`transform.decimate` is the first: inside the window it splits `x` into pixel columns and keeps the first,
last, lowest and highest row of each (the envelope is exact); outside the window it drops rows; it keeps gaps
(missing `y`), thins series (`group`) separately, and passes unsorted data through as it is.

**Measured in real Chrome** (200,000 points in a line, 20,000 points in a scatter; a frame = from `setView`
to the second `requestAnimationFrame`):

| | before | after |
| --- | --- | --- |
| line, zoom frame | 80 ms | 33 ms (frame-rate bound) |
| scatter of 20,000, zoom frame | 136 ms, 20,028 DOM nodes | 33 ms, 447 nodes |
| line, first frame (the full view is drawn whole) | 354 ms | 33 ms with `decimate` |
| line, build | 36 ms | 6 ms with `decimate` |

Levels 2 (gesture preview with a CSS transform) and 3 (DOM patching by `ref`) were not needed: a frame is
bound by the browser's frame rate. They stay in reserve for canvas scenarios.

**`update()` keeps the zoom:** the zoom carries over to scales that kept their type; `view` in the new spec
wins for its scale, `resetView: true` starts afresh; a requested but not yet drawn `setView` is not lost, and
the zoom survives waiting for a dataset that is being decoded.

## Lessons from uPlot (performance)

uPlot is a canvas chart for streaming time series of hundreds of thousands of points, one of the fastest of
its kind. What makes it fast: zero DOM nodes per point (canvas), one `Path2D` and one `stroke()` per series
regardless of the number of points, a cursor/tooltip that moves on a separate light layer without
recomputing the chart, the visible range on zoom/pan found by binary search over a sorted `x`, and typed
arrays for numeric data.

Part of this was already in "The recompute layer for zoom/pan" (culling by binary search, `overlay` does not
rebuild `marks`, `rAF` batching of `setView`) — the match confirms the direction. Three more points were
added:

1. **One `path` per series.** `mark.line` / `mark.area` emit one `PathPrim` for the whole series (one pass
   over the data → one `d` string), not a primitive per point — otherwise the SVG renderer loses already at a
   couple of thousand points. Fixed in `MarkDef.render` (`bc.d.ts`).
2. **Numeric columns are `Float64Array`**, not boxed `number[]`, from loading `#bc-data` into a `Table` on
   (not only for a future canvas renderer, as first thought). Fewer GC pauses when scanning domains and
   culling.
3. **The niche is stated explicitly.** uPlot aims at large `n`; blockcharts at report charts (up to a few
   thousand primitives). SVG (a DOM node per primitive) will never match uPlot's speed at large `n` — a
   deliberate price for what canvas does not give for free: theming through CSS variables, printing through
   `viewBox`, `cls` hooks for styling, native `title` and hit testing (decision 5). A scenario with truly
   large `n` is a separate `renderer.canvas`, not a rewrite of the SVG path. (Since built: see "The canvas
   renderer".)

## Tooling and the state of the repository

- TypeScript **7.0.2** (`latest` on npm). Types are checked (`tsc --noEmit`) and the build works
  (`npm run build`).
- `rootDir: "src"` added to `tsconfig.json` (TS 6/7 require it explicitly).
- The ambient scheme was checked with a trial block, `mark.rect`: it compiles to a clean classic script with
  no `exports`/`require`.
- Files: `src/bc.d.ts` (contracts), `src/core.ts` (the core), `src/blocks/*.ts` (blocks),
  `scripts/build-manifest.js` + `scripts/compose.js` (the manifest and the page composer),
  `scripts/build-skill.js` + `skills/blockcharts/` (the agent skill), `scripts/test*.js` +
  `scripts/run-page.js` (tests, `npm test`), `scripts/page.js` (a demo page through the composer,
  `npm run page` → `dist/page.html`), `docs/Design.md` (this file).
- The repository is `github.com/boligolov/blockcharts`; the first commit went to `main` on 2026-09-28.
  Before it, `.gitignore` had a stray `scripts` line that would have left the composer and every test out of
  git; it was removed.

## Trying out the contract: the first blocks

Written: `scale.linear`, `mark.point`, `guide.axis`, `renderer.svg` (`src/blocks/`).

What the trial showed:
- The contract holds: `tsc` is clean, blocks are emitted as classic scripts without `exports`, stacking axes
  through `offset` works.
- **A gap in the contract:** a guide needs a scale's orientation for its default side, and `Scale` does not
  know it. Added `ChartCtx.orientation(scale)`; the rule "`x` → `width`, `y` → `height` by default" lives in
  the core only, and blocks do not repeat it.
- `renderer.svg` does not invent a `fill` for a `path`: marks and guides set `fill: "none"` for lines
  themselves.
- `ref` on the DOM side is the attributes `data-bc-mark` / `data-bc-row`; `LiveCtx.hit` builds a `DatumRef`
  from them.
- Checked by eye (Playwright with the system Chrome, `channel: 'chrome'`, no browser download). Noticed:
  the outermost points sit exactly on the axis lines — an optional domain padding is needed (`padding` of
  `scale.linear`).

## The core (`src/core.ts`)

A classic script that puts `BC` on `globalThis`; loading the same core again is a no-op. It implements all of
`BC.Runtime`: `define`/`has`/`get`/`blocks`, `data`, `needs`, `validate`, `chart`, `mount`. Checked by tests
(`npm test`) and in real Chrome on a page assembled by `scripts/page.js`.

Decisions:
- **The pipeline** (`build`): table + transforms → first layout → scales (the domain from every channel that
  refers to them, plus `field`) → `measure` of the guides in the order of `spec.guides`, accumulating insets
  → the final `plot`, `setRange` of every scale, clearing the channel cache → marks and guides → display list
  → renderer → interactions. Stages 1–4 once, 5–7 on every change of view (see "The recompute layer");
  `update(spec)` rebuilds everything and resets the view to `spec.view`.
- **Data:** numeric columns → `Float64Array`, `null` → `NaN` (marks skip such rows). A malformed dataset is an
  exception from `BC.data`; during `mount` it goes to the console.
- **`validate` does not throw** and catches: blocks that are not loaded, transitive `requires`, unknown
  parameters (a warning), parameter type/enum/required, required channels, undeclared scales, scales of the
  wrong kind (`ChannelDef.scales`), unknown fields. With `transforms`, fields are checked per stage (see
  "Aggregation, CSV, formatting").
- **Errors do not break the page:** with error diagnostics the chart is not built; a red box with the list is
  drawn in `host` and `console.error` is written. A failure of one mark/guide/interaction is a diagnostic at
  its path; the rest is drawn.
- **Scales are not inferred** (rough edge 3 stays): a mark with `x: "month"` and no declared scale `x` is an
  error.
- **`mount`:** reads every `script#bc-data`, mounts each `script[data-bc-chart]` into a `div.bc-chart` right
  after the script (or into `#spec.id` if it is on the page); a second call skips scripts already mounted.
  Auto start: on `DOMContentLoaded`, or right away (through `setTimeout`) if the document is already loaded.
- **Encoded data:** a dataset can be `{ "encoding": "gzip+base64" | "base64", "data": "..." }` — UTF-8 JSON
  of rows or columns (gzipped first, if so stated). It is decoded asynchronously (`DecompressionStream`, which
  works from `file://` too), and `BC.data` does not throw for it; `BC.ready()` waits for all decoding and never
  rejects. A chart on a dataset that is not ready shows a "Loading data…" placeholder and builds itself
  (`ChartHandle.ready` — the first build); `update()`/`destroy()` while waiting are correct (it builds once,
  with the last spec; a destroyed chart does not come back). The last `BC.data` for a name wins, in whatever
  order decoding finishes; a stale decode stays silent. Errors are clear and per dataset: invalid base64,
  "not gzip" (including a truncated stream — browsers throw different exceptions, so any error reading the
  stream counts as "not gzip"), not UTF-8 JSON, an unknown encoding, nested encoding; `validate` says "still
  decoding (await BC.ready())" or "could not be loaded: reason". **A 64 MB limit on the decoded size**:
  otherwise a small gzip unfolds into gigabytes and hangs the page.
- **Named functions:** JSON carries no code, so there is `BC.defineFn(name, fn)` / `BC.getFn(name)`, and a
  spec refers by name (the last registration wins; the lookup happens at use, so a function can be registered
  after the chart is built).
- **The title** `spec.title` reserves 24 px at the top and is drawn in the `axes` layer.
- **Contract extensions found along the way:** `ChannelDef.sharesScale` (`y2` of a rect takes the scale of `y`
  by default, not a nonexistent `y2`); `TransformDef.outputs` (see `transform.stack`); `ChartCtx.series`
  (grouping and sorting of series moved out of `mark.line`, so a line and an area cannot disagree);
  `MarkDef.pick`; `LiveCtx.fit`; `ScaleCtx.color`.
- **`measure`** is a rough estimate (`0.6 * size` per character), without the DOM; rough edge 1 stays.

Not done: the default `renderer` is taken only from the loaded blocks.

New in the contract in this series: `ChannelDef.unscaled` (a channel that is a plain field with no scale: a
text label, a slice size; a scale on it is a validation error), `PrimBase.data` (`data-*` attributes on a
primitive: a legend item tells an interaction which value it stands for), `TransformDef.viewDependent` and
`TransformView`, `ChartHandle.update(spec, { resetView })`.

## Blocks (`src/blocks/`)

- **`scale.linear`** (v2): `nice`, `zero`, `padding` (a margin of the domain around the data, so the
  outermost points do not sit on the axes).
- **`scale.band`:** categories in order of appearance; value → the lower edge of the band, `bandwidth` — its
  width; `paddingInner`/`paddingOuter`. Zoom is a window of categories (a value outside the window → `NaN`,
  marks skip such rows). No `invert`, so `interaction.zoom` does not turn it.
- **`scale.time`:** UTC; numbers are epoch ms, strings ISO, also `Date`. Calendar ticks (seconds … years,
  weeks from Monday), compact labels independent of the locale.
- **`mark.point`** (v2): a circle per row.
- **`mark.rect`:** on a band channel the rectangle fills the band; on a continuous one it goes from
  `<channel>2` or from `baseline` (0 by default) to the value. That gives bars and intervals; heatmap and
  stacked-bar recipes also need color and the stack transform.
- **`mark.line`:** one `path` per series; `group` splits rows into lines by a field's value; rows unsorted by
  `x` are sorted, gaps break the line; the path's `title` is the group name (a native tooltip).
- **`scale.color`:** categorical, one color per value in order of appearance; colors from `range` or from the
  theme palette (`--bc-c0…`); a color is bound to its value and does not shift when a legend or a zoom
  narrows the domain. An unknown value is a neutral grey. (A continuous scale for heatmaps came later:
  `scale.sequential`.)
- **The `color` channel** of `mark.point`, `mark.rect`, `mark.line` (`scales: ["color"]`): for points and bars
  it sets each row's fill; for a line it splits the rows into series and colors each; no separate `group`
  needed then.
- **`guide.legend`:** a swatch and a label per value of a color scale. On the right/left — a column, at the
  top/bottom — a row; it takes space on its side just like an axis (through the same `measure`/`offset`), so
  in `guides` it goes after the axis of the same side to end up outside it. With a non-color scale — a
  diagnostic; the rest is drawn.
- **`guide.axis`** (v2, ticks from the core) and **`guide.grid`** are separate blocks.
- **`interaction.zoom`** (v2, the `fit` parameter): Ctrl/Cmd + wheel (and trackpad pinch) zooms around the
  pointer; that is the default so the chart does not capture page scrolling, and `wheel: "always"` enables
  the plain wheel. Dragging pans, a double click resets. Continuous scales only (`scales`, `["x"]` by
  default), never beyond `baseDomain`, a zoom limit `maxZoom` (50). Touch does not pan: a finger scrolls the
  page.
- **`transform.stack`:** adds two columns — the start and end of each row's segment (`as`, `<field>0`/
  `<field>1` by default) within each value of `by`. The order of series is by first appearance of `group` in
  the data, the same for every stack; negative values stack down from 0 separately from positive ones; gaps
  give `NaN` and do not affect their neighbours; `normalize` brings a stack to 0..1 (an empty stack is not
  divided by 0). The input table is not changed, existing columns are not copied. It declares `outputs`, so
  `validate` keeps catching typos in fields after the transform (without `outputs` field checking turns off
  rather than guessing).
- **`mark.area`:** a filled band between `y` and `y2` (or `baseline`) per series; a gap breaks the area into
  separate shapes. With `stack` it gives stacked areas and 100% areas.
- **`interaction.tooltip`:** a marker and a box with the fields of the row under the pointer. Each mark does
  the search itself (`MarkDef.pick`: a point — the nearest within a radius; a bar — the rectangle under the
  pointer; lines and areas — along their whole length, including the middle of a segment by interpolation);
  the tooltip takes the nearest and, on a tie, the one drawn on top. Data is written only through
  `textContent`; values are cut to 80 characters; it ignores dragging, hides on wheel and on leaving; it
  cleans up after itself (listeners, elements, the host's `position`). The `fields` parameter sets the fields
  shown (otherwise the mark's channel fields). **`content`** replaces the content with a function's result: a
  name from `BC.defineFn` (or the function itself in a spec built in JS) gets a `TooltipDatum` (`row`,
  `values` — the whole row, `lines` — the default lines, `mark`, `markIndex`, `x`, `y`, `table`) and returns a
  string (as text), a number, `{ html }` (markup; escaping data is the caller's job), a DOM node, an array of
  these, `null`/`false` (hide) or `undefined` (the default content). A name not found or a function that
  throws — the default content and one console message, not one per mouse move.
- **`scale.sequential`:** numbers → colors along `range` (two or more #hex colors, blended piecewise-linearly,
  viridis by default; three colors and a symmetric `domain` give a diverging scale). Outside an explicit
  `domain` — the edge colors; a gap / not a number — "no color", and such a row is not drawn. #hex colors
  only: CSS variables and names cannot be blended.
- **The rule "no color — not drawn"** in every mark with a `color` channel: a value the scale gave no color
  (a hidden category, a gap) does not draw its row and is not caught by the tooltip.
- **`scale.color`** (v2): a value outside the visible domain (after `setView`/a legend filter) gets an empty
  color (hidden), not grey; a color is still bound to its value and does not shift.
- **`scale.band`** (v2): categories run in increasing pixel order on a vertical axis too (top down), so
  horizontal bars and heatmap rows read from the first category at the top.
- **`transform.bin`:** a histogram. Round bounds (`bins` is a target, the width is rounded to 1/2/5·10ⁿ, or an
  exact `width`, or `extent`), empty bins are kept, the last bin includes its edge, `group` gives a row per bin
  and group; the output is columns of start, end and count (`outputs`). Drawn with a `rect` with `x`, `x2`,
  `y`.
- **`mark.text`:** a label from the field `text` (a channel with no scale) at (x, y): values above bars,
  annotations. Numbers — 6 significant digits or `decimals`; on a band scale the label is centered in the
  band; empty values are skipped; data only as text.
- **`mark.arc`:** pie and donut charts with no x/y scales (only color): a slice's angle is proportional to
  `value`, clockwise from 12 o'clock, `innerRadius`, `startAngle`, `padAngle`, `sort`,
  `label: percent|value` (outside; no label for slices under 3%). A single slice is a whole ring with no gap;
  rows without a positive number are not slices; a hidden category removes its slice and the rest are
  redistributed. Hit testing matches what is drawn.
- **`guide.legend`** (v2): a categorical legend is wrapped in `.bc-legend-item` groups with
  `data-bc-legend-*`; hidden values stay in the list, dimmed (opacity 0.4); for `sequential` — a color bar of
  48 slices with labels (a column on the right/left or a row at the top/bottom).
- **`interaction.legend-filter`:** a click on a legend item hides or shows its category, a double click
  isolates it (again — shows all); hiding the last visible one shows all. No state of its own: the visible set
  is the view of the color scale, so `setView` and clicks agree. A double click is judged from the state before
  the series of clicks (the browser sends click, click, dblclick). `fit` makes other scales follow the visible
  categories (`LiveCtx.fit` can follow a categorical scale too: a row is visible when the trial scale gives it
  a color). The class `bc-legend-filter` on the root lets styles set a pointer cursor.
- **`interaction.brush`:** dragging a rectangle (with Shift by default, so it does not fight the pan of
  `zoom`; `modifier` changes it) zooms to the selection: one horizontal scale — a vertical band, one vertical
  scale — a horizontal band, both — a box; on a band scale the categories under the box are selected; Escape
  cancels, a double click resets, `fit` as in `zoom`, a drag shorter than `minSize` is not a selection. The box
  is an HTML element over the host, so it survives redraws.
- **`LiveCtx.claimPosition()`:** any interaction that needs `host` as the positioning context of its
  absolutely positioned overlay (the tooltip marker, the brush box, the zoom-controls bar) takes it through
  this method instead of touching `host.style.position` itself. A claim/release counter in the core:
  `position: relative` is set on the first claim and removed only when the last one is released. Before,
  `interaction.brush` and `interaction.tooltip` each did "remember — restore" on their own, and after any brush
  drag the brush rolled back the positioning the tooltip still relied on (after a zoom the marker landed in a
  random place on screen; found on a user's live report — all 155 fake-DOM tests showed nothing, because
  there `getBoundingClientRect` is a fixed stub and the effect is visible only in a real browser).
- **`interaction.zoom-controls`:** `100%` / `−` / `+` buttons in a corner of the chart (`corner`, top-right by
  default). `100%` is `setView(null)` on every scale it controls (`["x"]` by default, as in `zoom`/`brush` —
  configured the same way so the button resets what they did); `−`/`+` scale only continuous scales around the
  center of the current window (`step`, the `maxZoom` limit, as in `zoom`); `fit` makes others follow. With
  only a band scale in `scales` there are no `−`/`+` buttons, only `100%`. Uses `claimPosition()`.
- **`renderer.svg`** (v3): `update` redraws the `<svg>` in place; `PrimBase.data` is written as `data-*`
  attributes.
- **`mark.rect` `dodge`** (v7): grouped (side-by-side) bars — a separate `dodge` channel (unscaled), not to be
  confused with `color` + `stack` (another placement of the same grouping field). It splits a band equally
  between the distinct values of the field, in order of first appearance among the visible rows — global, not
  per category, so one value always lands in the same sub-slot whatever the order of rows within a category.
  `dodgePadding` is the gap between sub-bars. One distinct value = as without `dodge`. The continuous axis
  (`y` of vertical bars) is untouched.
- **`mark.point`** (v6): `x`/`y` now also accept a `band` scale, centered in the band (the same
  `halfX`/`halfY` trick as `mark.text`) — a point on a categorical axis plus a value on a continuous one is a
  (Cleveland) dot plot. `pick` and `render` share the centering offset.
- **`transform.quartiles`** + **`mark.boxplot`**: boxplots from raw data. The transform computes, over
  `field` (and optionally `group`; a gap is a group of its own, as in aggregate), the five-number summary by
  linear interpolation (R-7: like QUARTILE.INC / numpy's default): `low`/`q1`/`median`/`q3`/`high`, `count`.
  `outliers` (true by default) gives Tukey whiskers (1.5×IQR); what lies beyond does not stretch a whisker but
  gets a row of its own with `value` (the other fields NaN) — not a separate feature but the natural
  consequence of a row of one kind not having the fields of the other (the same principle as "no color — not
  drawn"). `mark.boxplot` draws box + whiskers + median for rows where all five numbers are finite; the
  outliers are drawn by an ordinary `mark.point` reading `value` — it gets them for free, since the summary
  rows are NaN for it and are not drawn. Both marks share one scale through `sharesScale: 'y'` on all five
  channels (not only on the one with its own name), so a spec just declares `scales: {x, y}` as always.
  Vertical orientation only for now (the category on `x`).

Checked by tests (`npm test`: 170 checks of the blocks and the core on the fake DOM, 12 for canvas, 25 for
the composer, 11 for CSV, 29 for the skill, 17 for delivery) and in real Chrome (Playwright): tooltip,
Ctrl+wheel with Y following, dragging, double click, both themes, external control, click and double click on
the legend, Shift+box, performance measurements. The real browser already found a bug the fake DOM missed: a
double click on an isolated category did not bring everything back (the first click of the series had
already toggled the state).

## The agent skill (`skills/blockcharts/`, `npm run skill`)

**Since 2026-09-28** the skill is the main product (as in asciicharts) and lives in the repository complete,
in `skills/blockcharts/`: the Claude Code plugin marketplace (`.claude-plugin/marketplace.json` at the root,
`plugin.json` in the skill folder) installs it straight from git, so the generated parts (`LICENSE`,
`reference/`, `runtime/`) are committed. Edited by hand: `SKILL.md`, `README.md` (the listing page in the
plugin directory), `plugin.json` and `recipes/`. `npm run skill` refreshes the generated parts and writes
`dist/blockcharts.skill` (a zip for Claude.ai: the folder `blockcharts/` without `.claude-plugin`,
deterministic — a fixed date, LF); `build-skill.js --check` and a test fail while the committed folder differs
from a fresh build (compared with CRLF normalized). The skill's version is in `SKILL.md` `metadata.version`
and in `plugin.json`; a test requires them to be equal; it goes up with every change to the folder after a
release (0.1.0 is the first). The site serves the zip as `blockcharts.online/blockcharts.skill`
(`site-prebuild` packs it only while the skill is current). `encode-columns.js` was added to `runtime/`. The
principles the skill is built on: `docs/spec/principles.md`.

Contents: `SKILL.md` (what the agent reads: the workflow, the shape of `page.json` and of a spec, rules, what
not to do), `recipes/*.json` (sixteen ready pages: bar, stacked-bar, grouped-bar, dotplot, boxplot,
lines-by-series, scatter-groups, dual-axis, stacked-area-100, histogram, heatmap, pie, long-series,
scatter-large, dashboard, report-from-csv), `reference/blocks.md` and `runtime/` (core, blocks, manifest,
`compose.js`): `node runtime/compose.js page.json report.html` — nothing else needed but Node.

So that the documentation cannot drift from the code, tests check:
- the block reference is **generated from the manifest** (parameters, channels, required, versions) and
  compared byte for byte; the keys common to every spec are described in the generator;
- every recipe composes through the **packaged** composer without a single diagnostic, then the page runs in
  a sandbox and must draw every chart with no console errors; together the recipes must use **every** block (a
  new block without a recipe fails the test);
- `SKILL.md` links every recipe, and the recipes and links exist; the `description` has a sensible length;
- the build clears only its own subfolders (stale blocks and recipes do not linger) and refuses to write into a
  dangerous folder (a drive root, the repository, `dist`, `skills`, `src`).

## Aggregation, CSV, formatting

- **`transform.aggregate`:** grouping by fields and calendar units (`year`, `quarter`, `month`, `week`, `day`,
  `hour`, UTC) with the measures `sum/mean/min/max/median/count/distinct`, `sort/order/limit`. It replaces
  columns (`TransformDef.replacesColumns`), so `validate` checks fields **per stage**: each transform has its
  own set of known columns (the outputs of the previous ones), and the marks' fields are checked against the
  final set.
- **CSV in a page's data:** `{ "csv": "text" }` or `{ "csvFile": "orders.csv" }` (relative to the folder of
  `page.json`; it cannot reach outside). RFC 4180, the type is detected per column (number, ISO date, string),
  `NA`/empty → a gap, `types` forces a type. Parsing is in `scripts/csv.js`; errors are `ComposeError`s naming
  the dataset.
- **`BC.formatter(spec, kind?)`** on top of `Intl`: the presets `percent/compact/integer/year/month/day/date/
  datetime`, an object of Intl options (+ `locale`, `prefix`, `suffix`); dates always UTC, the default locale
  `en-US` (a page reads the same on any machine); empty values → `''`, something that is not a number/date is
  returned as it is; cached per spec; clear errors. Wired into: `guide.axis.format` (no effect on band),
  `guide.axis.title` (an axis title, rotated on vertical axes, with space reserved for it), `mark.text.format`,
  `interaction.tooltip.formats` (per field; a broken format is dropped with one warning), `guide.legend.format`
  (the color bar).
- **`mark.text` `on`:** a "color under the label" channel (the same field that colors a heatmap cell): the
  text turns dark or light by WCAG contrast; a row with no color gets no label.
- **The composer's dry run:** before the page is written every chart is built once in a sandbox with a fake
  DOM (`scripts/fake-dom.js`), so what only shows when drawing (a bad color, a failing transform) stops the
  build as a spec error; `TransformView.warn` and interaction warnings go into the report.
- **Binary columns:** in `{ columns }` a numeric column can be `{ dtype, encoding, data }` — raw little-endian
  values (`float32/64`, `int8/16/32`, `uint8/16/32`), base64 or gzip+base64; always read into a
  `Float64Array` (for floats NaN = a gap). A dataset with such a column is decoded asynchronously just like an
  encoded one (a placeholder, `BC.ready()`, a clear error naming the column), and the column can also sit inside
  an encoded dataset. The total decoded budget is 64 MB per dataset (counted in 8-byte output values). The
  composer reads such columns itself (checks and the dry run) and puts them into the page as they are. For
  pipelines: `scripts/encode-columns.js` (`encodeColumns(columns, { dtypes, gzip })`; `auto` — the smallest
  integer type, otherwise float64, nothing is lost; float32 only when asked; a gap in an integer type is an
  error).

## Delivery (`npm run release` → `release/`)

Three ways to get the code, all from the same built files:

1. **A whole page** (the composer): one HTML file, code and data inside, works from disk. The main path for an
   agent.
2. **A kit** — the core and chosen blocks in **one file**, for `<script src>` from a CDN: `kits/<name>.js` (a
   classic script) and `kits/<name>.mjs` (an ES module, `export default BC`; browsers load modules only over
   http/https, not from `file://`). The sets are in `kits.json` (`basic`, `timeseries`, `composition`,
   `full`); dependencies are pulled in by `closure`, in a fixed order (roles, names). A kit for one page:
   `node scripts/build-dist.js --page page.json[=name]` — exactly the blocks its charts need. Sizes now
   (minified): basic 53 KB (19 KB gzip), full 92 KB (32 KB gzip).
3. **Separate files** — `core.js` and `blocks/<role.type>.js`, plus `loader.js` (2 KB):
   `<script src=".../loader.js" data-auto>` reads `manifest.json`, finds the charts on the page
   (`script[data-bc-chart]`), asks the core for `BC.needs`, fetches the closure of blocks and mounts. For this
   the core does not mount by itself: `globalThis.BC_CONFIG = { autoMount: false }` (the loader sets it before
   the core). `BCLoader.load({ base, blocks, scan, mount, integrity })` does the same by hand; repeated calls do
   not download a file twice, a failed file can be retried, an unknown block is a clear error.

The release `manifest.json`: the version; for the core/blocks/kits/loader/types — file, size, gzip, an **SRI
sha384 hash**; for blocks, `requires` and `closure`. The hashes are for `<script integrity=…>`; the loader
adds them with `integrity: true`.

Guarantees (tests in `scripts/test-dist.js`): the manifest is true (sizes and hashes are checked against the
files, no extra files); the same input gives the same bytes (no dates, no absolute paths); a rebuild removes
stale files, but only in its own `blocks/` and `kits/`, and never writes into dangerous folders (the
repository and drive roots, `src`, `dist`, `skills`); each kit registers exactly its blocks (checked as a
script and as an ES module); the loader is run on a fake browser (only the needed blocks, order, SRI, errors,
a broken spec does not stop the others). Checked in real Chrome (on minified files too): a kit from
`file://`, an ES module and the loader over http. The version in `package.json` must equal the core's
(`VERSION` in `core.ts`); the release build refuses otherwise.

**Minification** (a change of mind: size matters for a CDN): everything in `release/` goes through esbuild
(`minify`, target ES2020; top-level and property names are kept — blocks talk through `BC.*`, and specs name
things with strings) and loses the blocks' `doc` strings (~10% of the code; the runtime never reads them; the
reference and the manifest come from `dist/`). Stripping the docs is checked: the block before and after is run
against a stub `BC`, and everything but the docs (function bodies included) must match, or the build fails.
`tsconfig` was raised to ES2020, so there are no `__awaiter`/generator helpers in the code. At the time,
`full` went from 182 KB to 77 KB (gzip 39 → 27 KB). Tests: every recipe run on a minified kit draws **byte for
byte the same** as the unminified code; parameters/channels/versions/requires of all blocks match the source;
`minify: false` gives the source code. The composer and the skill use the same minified code:
`scripts/minify.js` (`npm run manifest` calls it after the manifest) makes `dist/min/` — the same file names
and a `manifest.json` (with the docs, but with the sizes of the new files); `compose.js` reads `dist/min` by
default, `build-skill.js` puts it into `runtime/`. A composed page became about 40% smaller, and the dry run
now runs on the same code that goes into the page.

## The canvas renderer (`renderer.canvas`, `"renderer": "canvas"` in a spec)

The display list is the same as for SVG, so marks, guides and interactions did not change.
`src/blocks/renderer.canvas.ts`: one `<canvas style="width:100%;height:auto">`, the backing store is the host
width × `devicePixelRatio` (capped at 3, a side ≤ 16384), with a transform `k = width / list.size.w`, so
drawing units stay chart units. **Colors:** `var(--x, #fallback)` is resolved through
`getComputedStyle(host)` (nested fallbacks up to 8 steps, `currentColor`); assigning an invalid color to
`fillStyle` is silently ignored and keeps the previous one, so validity is checked by assigning after two
different sentinels — an invalid color is not drawn rather than "inheriting" its neighbour's. **Styles as in
SVG:** fill black by default, no stroke; `g` passes fill/stroke/… down, `opacity` multiplies down the tree,
`fillOpacity` only on the fill; `translate`/`clip` of groups and layers; `roundRect`, or arcs (`arcTo`) in
older browsers; `path` = `new Path2D(d)`; text with anchor/baseline/rotate, in the page's font. **Redraws** on
a change of the host's width (ResizeObserver), of `prefers-color-scheme` and of the attributes of `<html>`
(class/data-theme/style). **Hit testing:** the contract got `Rendered.dataAt?(ev)` and `LiveCtx.dataAt(ev)` —
the `data` of the topmost primitive under the pointer (for DOM renderers the core reads `data-*` of the event
target); `interaction.legend-filter` now works through it and on canvas sets a pointer cursor over a legend
item (a group's bbox = the union of its children, text measured with `measureText`). What does not exist on
canvas: CSS classes of marks and native `title`s. **Tests** (`scripts/test-canvas.js`; a fake 2D context in
`fake-dom.js` records calls with their style): colors/variables, size and density, redraw and destroy,
shapes/text/groups/clips/opacity, the legend and the cursor, zoom and tooltip, a long series as one Path2D.
Real Chrome: at DPR 1 and 2 the share of pixels differing from SVG is 0.3% and 0.14% (antialiasing);
zoom/tooltip/legend-filter/dark scheme work. **Honest measurements:** 21,000 points — SVG 203 ms per redraw,
canvas 33 ms (6×); 50,000 — 364 vs 55 ms; but one long line (200,000 points in one path) gains almost nothing
(1415 vs 1213 ms: the time goes into the pipeline and the `d` string, not the DOM) — it needs `decimate`. So
canvas is for point clouds and many bars; the recipe `scatter-large` (15,000 points, uint16 binary columns),
the site demo `embed/canvas`. In the kits `timeseries` and `full`.

## Publishing

MIT license (`LICENSE`, the author's name taken from the git e-mail — change it if another name/year is
needed). `package.json`: `exports` (`.` → the full kit with `types`/`import`/`default`; `./kits/*`,
`./blocks/*`, `./core.js`, `./loader.js`, `./manifest.json`, `./bc.d.ts`), `main`/`module`/`types`/`unpkg`/
`jsdelivr`, `files` (`release`, LICENSE, README), `sideEffects: true` (a kit puts `BC` in the global scope),
`engines node>=18`, `prepack` builds the release, `repository`/`homepage`/`bugs`. Each kit has a `.d.mts` (an
`export default` of the runtime with the types from `bc.d.ts`); separate files and kits start with
`/*! blockcharts <version> | MIT License */`. Checked on a real tarball: installing into a clean project,
`import BC from 'blockcharts'` and a kit subpath, `require`, `manifest.json` through `with { type: 'json' }`,
and `tsc` (nodenext) sees the types (the expected error on a nonexistent method fires). Package size 225 KB.
Not done: `npm publish` itself. CI (`.github/workflows/ci.yml`: `npm test` and `npm run site` on every push
to `main` and every pull request) passed on its first run.

## The site (`site/`, `npm run site`)

A static site on **Astro** (its own `site/package.json`, so the library keeps no dependencies): a live gallery
of every recipe (the JSON, the composed report `examples/<name>.report.html`, the HTML to embed it), demos of
every way to embed (`scripts/site-demos.js`: one `<script>`, the loader, an ES module, the handle API with a
custom tooltip, themes, data forms, a block of your own — the snippet shown is the code that runs), a guide
(kit sizes and SRI hashes from the real release) and the block reference from the manifest.
`scripts/site-prebuild.js` builds `site/public/release` (the release), the reports and the skill download
before `astro build`. Pages read the repository's files through `site/src/lib/site.mjs`, so they cannot
describe something that does not exist. `SITE_BASE` sets a subfolder; every link goes from `BASE_URL`.
`scripts/check-site.js` checks the build without a browser: links, scripts and anchors, and every chart on
every page validated by the real core against that page's data (blocks the page defines itself with
`BC.define` included). Checked in real Chrome: every page without console errors, the API demo buttons
(setView, update keeping the zoom, getView), the custom tooltip, the theme switch, a subfolder base.

**Since 2026-09-28** the landing page follows the structure of asciicharts.online (hero, installing the skill
in tabs, how it works, principles, numbers, benefits for the reader of a report, four ways in, gallery) with
a design for business readers: light by default, one blue accent, Inter (self-hosted through fontsource), dark
by the system or by a button. Every number (core, kits, loader, code in each report) is read at build time;
the spec, the list of blocks and the error message in "How it works" are made by the real composer
(`composeDemo`). A `/privacy` page, `wrangler.jsonc` for Cloudflare, `site/README.md`. Examples/Embedding/
Guide/Blocks stay as the developer section in the new look.

**Positioning (2026-09-28, in the owner's words):** the point of the whole thing is not to drag the whole
component base along, but to have on the page exactly what is needed to draw its particular charts, and no
more; lightness and customizability follow from that. The principles were reordered around it (§1 "exactly
what the charts need", §2 "blocks are atoms", §3 "customizable at every level": parameters, CSS, your own set
of blocks, functions by name, blocks of your own through `BC.define`). On the landing page: the hero "Only the
chart code your page needs. Nothing more.", a map of every block with the 12 of 27 the hero report carries lit
up (every size on the site comes from `dist/min`, exactly what the composer puts into a page, so the numbers
agree everywhere), and a Customize section. A new demo page `embed/block` — a block of your own,
`guide.target`, in twenty lines; `check-site.js` runs a page's inline scripts that call `BC.define`, so such
specs are checked too (proven: without `value` it reports `guide.target requires "value"`). **Code
highlighting:** Shiki (VS Code light-plus/dark-plus, both palettes as CSS variables, switched with the site
theme) in `site/src/lib/highlight.mjs`; Shiki's HTML grammar does not color the body of
`<script type="application/json">`, so an HTML snippet is cut into runs of html/json lines and put back
together. Specs in the demos are printed compactly (anything short on one line).

## Next steps

Done: blocks (sequential/heatmap, text, arc, legend-filter, brush, bin, aggregate, decimate, zoom-controls,
boxplot with transform.quartiles, grouped bars through mark.rect dodge, dot plot through mark.point on a band
scale), horizontal bars, culling and `viewDependent`, `update()` keeping the zoom, a trial run of the skill on
an agent with fixes, formatting, CSV, delivery (kits, separate files, the loader, minification), binary
columns, the Astro site, the canvas renderer, the MIT license and exports, README, the skill as a plugin, the
principles, the business landing page.

Left (the full list is [ROADMAP.md](../ROADMAP.md)):
1. Publishing: deploying the site to blockcharts.online, `npm publish`, the CDN, the plugin directory.
2. Business blocks: KPI tile, table, funnel, waterfall, bullet, treemap, a dashboard grid.
3. Skill evals with and without the skill, and a second trial run on an agent.
4. Zoom optimization levels 2 and 3 (gesture preview, DOM patching by ref) — not needed for SVG by the
   measurements.
