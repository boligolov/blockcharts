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
| transform | stack, bin, aggregate, window, fold, filter, sort, calculate |
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
- Scaling is through `viewBox` (the SVG stretches to its container), and the core lays the chart out again at the
  container's width (see "Responsive layout" below), so the stretch is 1 and text keeps its size; only a chart with
  `responsive: false`, or one narrower than 200 px, is scaled as a drawing.

## Known rough edges

1. **Two-pass layout.** Axes take space (`GuideDef.measure`), then `Scale.setRange` recomputes the range. The
   width of labels is estimated (`ctx.measure` without the DOM), so small misalignments are possible. With
   several guides on one side (`position`) the insets add up in the order of `spec.guides`, and each guide's
   `render` gets the inset already claimed on its side (`offset`) — see "Several scales in one direction".
   The labels of the outermost ticks stick out past the plot (they are centered on the tick): `measure`
   returns `overhang`, the core takes the maximum over the guides and widens the margin only where the inset
   and the space already taken are not enough; neighbouring guides do not move.
2. **`Scale<any, any>`.** Typing the domain per kind of scale with generics is too heavy; the core checks
   `ChannelDef.accepts` against what each scale declares (`ScaleDef.output`, `ScaleDef.input`) at run time.
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
  wrong kind (`ChannelDef.accepts`), unknown fields. With `transforms`, fields are checked per stage (see
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
- **The `color` channel** of `mark.point`, `mark.rect`, `mark.line` (a color scale): for points and bars
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

## Business blocks and the dashboard look (2026-09-28)

Asked for: new blocks for business dashboards, examples, the site, and ideas for making the charts look more
"expensive". What was built, all as atoms (a page pays only for what it names):

- **`guide.kpi`** — a key figure as a chart's heading: label, value in large type, change against the
  previous row (or the first, or another field via `against`), green/red by `better`. A guide, not a mark,
  because a guide's `measure` reserves room at the top, so a line in the same chart becomes the sparkline
  without the agent computing any padding. For a tile with only the number, validation now allows
  `"marks": []` when the chart has a guide ("at least one mark, or a guide").
- **`transform.waterfall`** (`<field>0`, `<field>1`, `step`, `amount`, `top`; subtotal rows from 0),
  **`transform.funnel`** (bars centered on 0, `rate`, `stepRate`), **`transform.treemap`** (squarified, one
  or two levels, corners in 0..1, labels only for cells big enough). Static transforms: a view-dependent
  one would not take part in domain inference, so the treemap takes the plot's `aspect` as a parameter.
- **`mark.rule`** — lines at values: a constant `{ "value": 50000 }` is a value on the scale, like a
  constant on any position (see "What a real dashboard found"); on a band it spans the band
  (`thickness`): the bullet chart's target tick. Repeated rows draw one line. **`mark.rect` `thickness`**
  (v8) makes the slim bar of a bullet chart.
- **The dashboard look**, as new defaults and options:
  - `Style.fade` in the contract: a vertical gradient from the fill to transparent over the plot, in both
    renderers (SVG `linearGradient` per color, the color in a style attribute with `;{}<>` removed; canvas
    `createLinearGradient` with the color's transparent twin). `mark.area` `fade` (no outline) and
    `toBottom` (fill to the plot bottom when the axis does not start at 0: sparklines).
  - `curve: "smooth"` on lines and areas: a monotone cubic (Fritsch–Carlson) — smooth, through every
    point, never overshooting between two of them. Duplicated in the two blocks rather than put in the core,
    so a page without curves carries none of it.
  - `guide.axis` v6: no tick marks by default, the axis line only along a horizontal axis, labels in a
    quieter `--bc-label` color; category labels too wide for their band wrap onto two lines; the core
    shows every category label that fits (measured) instead of one per 80 px. The old look is
    `ticks: true, line: "on"` (the layout tests use it, so they still pin the geometry to the pixel).
  - The tooltip as a card: the category or date as its heading with the series' color dot, label/value
    lines with the values right-aligned in tabular figures, a soft shadow, and a crosshair on lines and
    areas (`crosshair`). It grew to 8 KB (see ROADMAP: the crosshair could be its own block).
  - Round legend swatches; a row legend wraps onto more lines.
  - A calmer palette with one strong blue, `--bc-good` / `--bc-bad` / `--bc-kpi` / `--bc-label`, the
    reader's UI font (Inter if installed, no web font), tabular figures.
  - The composer's page: a grey page with white cards, a visible title and `subtitle`, and
    `layout: { columns }` + `span` per chart for a dashboard grid that stacks on a phone.
- **Recipes**: `executive-dashboard` (4 KPI tiles, revenue against plan, a donut, a profit bridge, a
  funnel), `waterfall`, `funnel`, `bullet`, `treemap`. A new kit, `dashboard` (22 blocks, 28 KB gzip).
- **Found on the way**: a regex written through a shell heredoc lost its backslash (`/s+/` instead of
  `/\s+/`) and split labels at every "s" — caught only by looking at the rendered dashboard; the label test
  now lists the exact words expected.

## After the look: labels, crosshair, animation, phones (2026-09-28)

- **`mark.line` `label`** (v7): the series name, its last value or both at the end of each line, in its color.
  The labels of every labelled line of a chart are spread together (each mark computes all of them, the same
  way, and draws its own), so two separate line marks — revenue and plan — do not write over each other.
- **`interaction.crosshair`**: the crosshair left the tooltip (v6). It snaps to the row whose x is nearest the
  pointer at any height (a mark's own pick only reaches a few px around its shape), on lines and areas by
  default, on every mark with `snap: "all"`, or follows the pointer freely. The tooltip only got 0.4 KB
  lighter: its weight is the card, not the line.
- **`interaction.animate`**: bars grow from the baseline, lines and areas are wiped in from the left, a pie
  opens from its center, anything else fades; the browser's own animation of the SVG marks layer (Web
  Animations API, no timer loop). Once per chart host: a rebuild (a new width, an update) does not replay it.
  Nothing for `prefers-reduced-motion: reduce`, nothing where the API is missing.
- **Responsive layout, in the core**: when the host is narrower than `size[0]`, the chart is built at the
  host's width (the height stays), so text keeps its size on a phone instead of shrinking with the drawing; a
  ResizeObserver rebuilds it when the width changes, keeping the zoom, and ignores changes of height. Never
  narrower than 200 px; `responsive: false` keeps the old behaviour; with no width known (a server, the
  composer's dry run, the tests) nothing changes. A wider host scaled the drawing up until the production review
  (below): now it is laid out at its width too.
- **Table** stays in ROADMAP, much later.

## Review fixes and bubbles (2026-10-25)

- **Fixes found by a review** (each reproduced first, then a failing test): the tick loops of `scale.time` ran forever
  on a NaN bound — numbers past the range of dates (nanoseconds) or a `domain` that does not parse — and hung the page
  and the composer; now such numbers are not times (an error with the fix when none is a date), a bad domain is an
  error, the loops stop on NaN and at 1000 ticks. The composer's trial run of each chart now runs inside the `vm` under
  `drawTimeout` (10 s), so any stuck block is a spec error, not a hang. `interaction.zoom` v3 leaves a drag with the
  brush's modifier to the brush (both moved at once and the selection landed elsewhere — confirmed in real Chrome).
  `guide.kpi` min/max no longer spread a long array (stack overflow at 300,000 rows). Rows without x sort last when a
  series is ordered (a NaN in the comparator scrambled the line).
- **Bubbles**: `scale.size` maps a number to a radius so that the **area** follows the value (r² linear between the two
  radii of `range`, domain from 0 by default, no size for missing or negative values). `mark.point` v7 takes a `size`
  channel on it, draws the biggest first so small bubbles stay on top, and its pick prefers the circle the pointer is
  in that is drawn last; `stroke` outlines them. `guide.legend` v6 draws a size key: round values as circles of their
  size, a column at the side or a row that wraps. The row is packed by the chart's width, not the plot's: `measure`
  sees the plot before the axes and other legends take their room, so packing by the plot made render wrap into more
  lines than were measured and the last one fell off the card on a phone (a test reproduces it). The categorical row
  legend had the same defect and packs the same way since `guide.legend` v7; a line starts at the plot's left edge
  and moves left only when it would run past the chart. Recipe `bubble`; `scale.size` is in the `full` kit.
- **Lines over categories**: `mark.line` v8 and `mark.area` v4 take a band scale on x. A point sits in the middle of
  its band, as on `mark.point` and `mark.text`, and the rows of a series are joined in the order of the band domain
  (the series sort is by pixel, and bands run left to right in domain order). A category outside the domain, or
  outside a zoomed window of categories, has no x and breaks the line like a missing value. End labels and the
  tooltip use the same centered x. Recipe `slope` (two years per region, end labels instead of a legend).
- **`transform.window`**: a column computed from the rows before (or around) each row of a series, in `sort` order,
  per `group`: `cumsum`, moving `sum` / `mean` / `min` / `max` over `size` rows (trailing or centered), `diff`,
  `pctChange`. Rows stay where they are. Missing values are skipped by the window and get NaN; a window cut short by
  the start of a series is NaN unless `partial`. Windows slide in O(n) — a running sum and count, monotone deques
  for min and max — so a wide window on a long series costs the same as a narrow one (a direct computation took 32 s
  on a 10,000-row window over 100,000 rows; a test holds it under 2 s). Recipe `moving-average`; in the
  `timeseries` and `dashboard` kits.
- **Labels that fit** (`mark.text` v3): the gallery card of the waterfall wrote its figures over each other and the
  treemap cut "Starter" at its cell edge. A label centered in a band now has the step to the next category as its room;
  with `x2` / `y2` it has the box to the other corner, less `dx` / `dy` on the far side too. A label that does not
  fit shrinks, down to `minSize` (8), and is left out below it; the labels of a row of categories share one size (the
  smallest), cells keep their own. Widths come from a per-character table of Inter widths measured in Chrome (0.44 to
  0.55 em for usual labels), a little over the real ones: `ctx.measure()` assumes 0.6 em for every character so that
  layout never clips, and with it the waterfall kept 2 labels of 7 on a phone. The waterfall recipes write whole
  thousands (`$892K`) and leave the exact figure to the tooltip.
- **A lighter core for composed pages**: the core is half of a typical report, and two parts of it only matter
  before the page exists. `BC.validate` / `BC.needs` (5.6 KB minified) run in the composer, on the same specs and
  data; the decoder for gzip, base64 and binary columns (3 KB) only matters for encoded data. Two build switches at the
  top of `src/core.ts` (`CHECKS`, `DECODE`) guard them, written as `const f = (FLAG ? function f() {...} : undefined)!`
  so that the minifier drops the bodies when a switch is false (esbuild keeps an unused function declaration inside an
  IIFE, and inlines a local constant only up to the first early return: the switches come first, and a test fails if
  they move). `scripts/minify.js` writes `core.composed.js` (no checks, 20.8 KB) and `core.composed-plain.js` (neither,
  17.8 KB) next to the full core (26.4 KB); the composer picks one per page, keeps the full core when a page is
  composed with errors to show, and `compress: "auto"` now gzips only when that saves more than the decoder costs.
  The 24 recipes are 13.5 % smaller (1423 KB -> 1231 KB); every one draws in Chrome on its lean core. Kits and the
  loader keep the full core: a hand-written page needs the checks.
- **`lib` blocks** (principles 1.1): code two blocks would otherwise both carry. A seventh role, never named by a spec
  (`needs()` never asks for it, validation finds no `mark.curve`); a block lists it in `requires`, the manifest closure
  brings it along, and the block reaches it through the core (`BC.get('lib.curve').exports`). Scripts put `lib` first
  on a page. The first is `lib.curve` (1.0 KB), the straight or monotone path that `mark.line` v9 and `mark.area` v5
  each carried (0.8 KB apiece): a page with a line alone pays 0.2 KB more, one with a line and an area 0.6 KB less, and
  the curve is written once. All 24 recipes draw byte-identical marks before and after (compared in Chrome).
  The middle of a band is now one field of the channel, `ChannelData.half` (half the bandwidth, 0 on other scales),
  instead of the same expression in point, text, line, area, rule and crosshair.
- **`transform.fold`**: a wide table (a column per series, as spreadsheets export it) becomes a long one: every row
  turns into one row per field of `fields`, the field's name in `key` and its value in `value`, the other columns
  repeated. The folded columns stay, as in Vega-Lite's fold, so validation only adds two names (`outputs`) and needs
  no new notion of dropped columns. New names that clash with a column are an error rather than an overwrite. Numbers
  stay a typed column. Recipe `wide-table` (lines per channel, then fold + stack as areas); in the `timeseries`,
  `composition` and `dashboard` kits.
- **`transform.filter`** and **`transform.sort`**: rows kept by a test, and rows put in order (with `limit`, the
  top N; with `group`, the top N of each group), without going through `aggregate`, whose `sort` / `limit` work on
  groups only. A filter compares like with like: numbers with numbers, dates with dates (a Date or an ISO string,
  "2024-02" included), text with text; a row of another kind or with no value never passes, so `"!="` does not let
  missing values through. Equality is by kind too: 1 is not "1", a Date equals the ISO string of its time. A band
  scale takes its categories in row order, so a sorted table gives ranked bars. Both keep every column (`outputs`
  is empty). Recipe `top-n`; in the `timeseries`, `composition` and `dashboard` kits.
- **`scale.log`**: a block of its own rather than an option of `scale.linear`, so a page without it does not carry
  it; marks accept the kind `log` wherever they accept `linear` (point v9, line v11, area v7, rect v9, rule v3, text
  v5, boxplot v2). Zero and negatives have no place on it: the scale returns NaN, so a line breaks and a point or
  bar is left out, and the inferred domain comes from the positive values (`nice` to powers of ten). A bar or area
  without a second channel would start at 0; a baseline the scale has no place for is now the bottom of the domain.
  Ticks: 1-2-5 per decade when few, 1-3 when more, then every k-th power so the count stays near the asked one;
  labels compact (1K, 1M) unless the axis has a `format` (guide.axis v7 formats log ticks as numbers). The brush
  reads values through `invert` and needed nothing. Zoom and the zoom buttons did their arithmetic in values, so a wheel
  step at 3K employees jumped the view to 50K (seen in Chrome); on a log scale they now work on the logarithms
  (zoom v4, zoom-controls v2), and the value under the cursor stays there. Recipe `log-scale`; in the `basic` and
  `timeseries` kits.
- **`transform.calculate`**: a column from two numbers of a row, `a op b` with `op` one of + - * / and `b` a field
  or a constant `value`. Deliberately not an expression language: a spec stays data an agent writes and the
  composer checks, nothing is evaluated, and every derived number a business report needs (margin, gap to plan,
  per unit, in thousands) is one or two of these in a row. A side that is not a number, a division by zero and an
  overflow are NaN. `as` may replace `a` or `b`, never another column. Recipe `calculated-field` (profit as bars,
  margin as a line); in every kit but `full`, which has it anyway.
- **Formats on a band axis, and quarters**: an aggregate by month or quarter gives ISO dates, and a band axis wrote
  them as they are ("2024-04-01"). guide.axis v8 passes band categories through the format too, without forcing a
  kind: the core formatter already leaves what is not a date (or not a number) unchanged, so text categories stay.
  Intl has no quarters, so the core has a `quarter` preset: "Q2 " before the year Intl writes, in UTC. It has its own
  cache key; built on the `year` options, it would otherwise share that preset's formatter.

## Formatting and a second review (2026-10-28)

- **Prettier** formats the sources (`src/`, `scripts/`, the site's `.mjs` and `.css`; `.prettierrc.json`: 140
  columns, single quotes, trailing commas), `npm run format`; CI runs `npm run format:check`. Generated code and the
  skill's runtime copy are left as the build makes them.
- **Fixes found by the review** (each reproduced first by a test that fails without the fix):
  - Culling and `transform.decimate` v3 read which way a sorted column runs from its first and last row in pixels.
    On a log scale a zero (or a negative) has no pixel, NaN, so a column starting at 0 read as running backwards and
    a zoomed log x drew nothing. Both now cull only when both ends have a place on the scale; sorted, values without
    one can only sit at the ends, so that is enough.
  - A `domain` that runs backwards (`[100, 0]`, documented on `scale.linear`) could not be zoomed: `interaction.zoom`
    v5, `interaction.zoom-controls` v3 and `interaction.brush` v3 compared the view with a negative full span and reset
    it. Zoom and the buttons now work on the negated values of such a domain; the brush keeps the view running the
    same way as the domain.
  - `guide.kpi` v4 took its figure from the rows the marks draw, which after `transform.decimate` are a few per pixel
    column: a sum of 2,000 rows showed 492. `ChartCtx.baseTable` is the table before the view-dependent transforms;
    the KPI reads its fields there (or, for a field made after decimate, from `table`).
  - The composer read encoded data with Node's `Buffer.from`, which takes base64url and skips characters it does not
    know, and with an unlimited gunzip; the page reads it with `atob()` and a 64 MB limit. A page could compose clean
    and show "not valid base64" in the browser. The composer now reads data the browser's way, with the same limit.

## What a real dashboard found

Fifty-two charts of browser statistics, built with the skill as a user would (`dashboards/browsers`), showed five
gaps no test had. The first was a trap, the others cost workarounds.

- **A constant on a position is a value on its scale, on every mark.** It was a pixel on `mark.text` and every other
  mark and a value on `mark.rule`, which mapped it itself; the composer let both pass and the labels were simply gone.
  The core now maps it. Only x and y and the channels sharing them: a color or a radius is the thing itself. The scale
  takes the constant into its domain, which is what "keep it inside the domain" asked the author to do by hand; past a
  `domain` given by hand, or a category that is not in the data, it warns.
- **`deltaFormat` on `guide.kpi`.** A change need not have the unit of the value: a share of 66% that moved by 1.8
  points read "+1.8%", which is another number.
- **`{ "section" }` in `charts`.** A heading over the whole grid. A page entry, not a block: the composer owns the page.
  Diagnostics keep the index the author sees, so `charts[i]` counts the sections too. Under sections card titles are h3.
- **Narrow screens.** Text categories go at -45° when even two lines do not fit, since a category you cannot read is
  a bar you cannot name; dates and numbers are a sequence, so every few say enough, and sixty months never turn. The
  decision is made in `measure`, before the plot is final, so it subtracts the vertical axes (a fixed discount turned
  labels that wrapped fine), and is kept for `render`, which must stay in the room reserved. Cell labels are not
  solved by shrinking: `minWidth` on a `charts` entry keeps the chart wide in a scrolling wrapper. The wrapper is around
  the host, not the host itself, so tooltips still position against a box that does not scroll; they now flip on the
  part of the host that is on screen.
- **An overlay says which corner it takes.** The zoom buttons are HTML over the chart, so a top legend ran under them
  on a phone. `InteractionDef.corner` declares the corner and the width, `ctx.edgeTaken` adds them up, and a row
  legend packs into what is left. The legend does not know the zoom buttons by name: anything drawn in a corner can say so.
- **`labels` on the tooltip.** Field names are for the spec. Without this a Russian page needed Russian columns, and a
  `calculate` copy for every output of a transform.

## What a dashboard in Chinese, Japanese and Korean found

A second dashboard, 73 charts in three languages, built by an agent that knew only the skill. Most of what it found had
one cause and the rest were places where Latin had been taken for granted.

- **`measure()` took every character as 0.6 em.** A full-width character is 1 em, so axes, legends and end labels
  reserved about half the room they needed. It now counts them as wide. This is deliberately still an estimate, and a
  generous one: layout must not depend on fonts being loaded.
- **Text without spaces breaks between characters** on a band axis; it had nothing to wrap at.
- **`lang` on the page, a section or a chart entry.** One setting does the three jobs: `<html lang>` for screen readers,
  a font per language (`:lang()` rules, or Japanese is drawn with Chinese glyphs), and `spec.locale`, the default
  language of every format including presets. The locale is a variable set at the start of each build and draw, not a
  parameter, because formatters are made in many blocks; what is written at hover time is made while attaching.
  Quarters are spelled by hand, since Intl has no such unit.
- **Format objects reject unknown keys.** Intl skips them, so `{"preset": ...}` did nothing, silently.
- **Numeric and date ticks drop repeated labels and thin out** when their text is wider than the space between them:
  ticks are spaced by count, and only the format knows what they will say.
- **Bars with no band** used to grow from 0 on both axes, which on a time axis means from 1970. The axis that holds
  positions is now chosen, and bars take their width from the smallest step.
- **Upright vertical axis titles** are one text per character, so both renderers draw them with no contract change.
- **A report can be wrong.** The agent reported the legend filter dead on canvas; the filter worked and its clicks had
  missed. Findings are reproduced before they are fixed.

## Small multiples

`facet` is an entry of the page, not a block: the composer already owns the page and has the data, and a panel is an
ordinary chart with one more filter, so a page with facets carries no new code and each panel keeps its tooltip, zoom and
relayout. The filter goes first, so a stack or a total is computed within the panel. A field a transform makes is the
exception: the composer runs the transforms up to that one to learn the values, and the filter goes right after it. To share axes the composer draws every panel once in the sandbox, reads the domains and writes their
union into the specs. A scale with a `domain` of its own stays as it is, and `free` opts out. A band or color scale takes
the union in first-seen order, so a category keeps its color in a panel where it is missing. A legend of categories moves
above the panels as HTML, since repeated it would cost each panel the same room for the same words. A legend filter stays
in every panel and listens to that legend, so there is no state outside the charts; a shared scale in its `fit` is dropped,
as refitting one panel would end the comparison the panels are for. Panels are one chart per element rather than one SVG, so
on a phone they reflow like any other cards. The price is that it works only through the composer, not in BC.chart.

## What the smaller gaps taught

- **A hidden series and a 100% stack.** A stack ran once, so hiding a series left a hole. `viewDependent` can now be a
  function of the spec: `transform.stack` with `follows` reruns on a view change, and only then. It still runs once without
  a view before the scales are made, because their domains are read from what it writes.
- **A row can mean "no such field".** The rows of `transform.quartiles` share a table but not their fields, and a tooltip
  has to tell that from a missing value, which it shows as a dash. The table says so itself (`sparse`).
- **A weekday with no data** keeps its place through one empty row: no date, so nothing is drawn, as with other rows that
  have no position.
- **Dark text on a mid blue** came from measuring contrast against pure black while drawing #111.
- **The name of a Marimekko column** sat on its top cell, and real shares made that cell too thin to hold it, so most
  columns went unnamed. It now sits on the tallest cell.
- **Month names on a time axis** came from an English list and ignored the chart's language. The oil dashboard hid it by
  giving every axis a `format`; the first axis without one showed `Jan 2024` under Japanese text.
- **Unused datasets** stay off the page, unless the page has its own script, which could read them.

## Sankey

`mark.sankey` is one mark rather than a transform and two marks, as a treemap is. A treemap keeps one row per cell, but
a Sankey has two kinds of shape, nodes that are not rows and ribbons that are, and a table cannot hold both. So the mark
takes the flows and owns the layout, and `geometry()` is shared by render and pick. A node goes one column past
everything that flows into it, and a node nothing leaves goes to the last column. Columns are ordered by sweeping
barycenters, which is cheap and good enough at the size people read a Sankey at; there is no relaxation of the vertical
positions, so each column is centered. A loop throws: the usual alternative, cutting a back edge, would silently draw
less than the data says. A tooltip used to be one row, and a node is many, so `Pick` gained `card`: a title and lines the mark
writes itself, which the tooltip shows in its usual card. A custom `content` function is not called for one, because the
row it would get does not stand for the shape. Lighting up a node's flows on hover is still not there. Labels fit the space between two
columns by losing the total, then the end of the name; two labels that face each other across the last gap can still
touch, since each one gets the whole gap.

## Candlesticks and calendars

`mark.candlestick` follows `mark.boxplot`: five channels, the prices sharing the scale of `y`. On a time scale a body is
as wide as the two nearest candles allow, the same rule as a rect. The pointer picks by x alone, as on a line, since on a
dense chart a wick is too thin to aim at. A row with a price missing draws nothing rather than half a candle.

A calendar is not a mark at all: `transform.calendar` writes a week and a weekday and `mark.rect` does the rest. On a time
axis the months land where they really are, which a band of weeks could not do, and it can be faceted by year like
any chart. The rows are put in weekday order because a band scale lists its values as it meets them; the alternative,
a `domain` of day names, would have to be written in the language of the page.

## Marimekko

It was going to be only a recipe, but the corners depend on totals per column, which no spec can express, so a recipe
would have meant coordinates worked out before the page. `transform.marimekko` writes the corners like a treemap does and
`mark.rect` draws them, on linear scales of 0..1, so it has real axes in percent of the whole. The columns keep the order
of the data rather than being sorted, because the order of regions or years often means something.

## Shared code in lib blocks

The audit of 2026-11-01 found code that blocks carried in copies. Four lib blocks now hold it, each reached through
the core the way `lib.curve` is:

- `lib.ticks` holds the round steps and ticks of scale.linear, scale.sequential, scale.size and transform.bin.
- `lib.pointer` holds where the pointer is on the chart (tooltip, crosshair, zoom, brush) and the hover by mouse and by
  touch (tooltip, crosshair). The tooltip's press hides the card; the crosshair keeps its line, `keepOnPress`.
- `lib.view` holds the zoom arithmetic of interaction.zoom and zoom-controls, on even numbers.
- `lib.columns` holds the column checks of funnel, treemap and waterfall.

The hover was a lib block of its own at first. Every page with a tooltip carries the pointer code too, so the two
became one block and that page carries one wrapper instead of two. Zoom or brush without a tooltip would carry the
hover unused; no recipe does that.

Weight has a price, as with `lib.curve`. A lib block costs its wrapper plus the lookup in each user, about 0.25–0.4 KB,
and saves the copy in every user after the first. A page with one user of each pays: the bar chart grows from 58.6 KB to
59.3 KB. A page with several users saves: the executive dashboard shrinks from 103.5 KB to 103.2 KB. All recipes
together grow by 1 %. In exchange, the code is written once.

Two checks back this up:

- All 46 recipes draw byte-identical SVG and canvas before and after. The comparison ran in Chrome through hover,
  Ctrl + wheel, drag, the zoom buttons, double-click, a brush, and taps on a phone: 922 steps, plus every chart with a
  crosshair.
- The zoom arithmetic keeps the order of operations of each old copy: wheel zoom around the pointer, buttons around the
  middle. Otherwise the views differ in the 13th digit.

A test fails when two blocks share a run of the same code of 300 characters or more, spaces aside, in the compiled
blocks. The copies the audit found were 450 to 800 characters long. The likenesses that remain are at most 270: the
distinct values of band and color, the sort key of sort and window, the pick of line and area. They are a loop or a
check that two blocks write alike, below the limit.

## Blocks meet through what they declare

The second item of the audit: blocks that named other blocks. Each connection now goes through a declaration that any
block can make, and the core reads it:

- **`MarkDef.series`** (line, area): the mark draws each series as one shape through its rows in x order. With `snap:
  "lines"`, the crosshair snaps to marks that say so, not to the two it used to name.
- **`MarkDef.enter`**: rect says `"grow"`, line and area `"wipe"`, arc `"pop"`. In `"auto"` mode the animation takes
  the effect the marks ask for, by the old rules: a pie opens; bars grow unless a series is drawn over them. A bar's
  baseline comes from the first mark that grows.
- **`MarkDef.color(spec, ctx, index, row)`**: the color the mark drew a row in, from the function its render draws
  with. A tooltip shows it by the heading and on its marker; a mark without it (text) shows none. It replaced
  `markColor: false` (arc, text), with which the tooltip guessed the color from the spec (see the production review).
- **`InteractionDef.alongX`** (crosshair): it reads the chart along x at any height. `ChartCtx.alongX` says one is on
  the chart, and the pick of a line answers wherever the pointer is above or below it. Before, the line looked for an
  interaction of type `crosshair`.
- **`LiveCtx.claimDrag(when)` and `dragClaimed(ev)`**: a gesture claim in the core, as `claimPosition` is for the
  host's positioning. The brush claims the drags its modifier is held for, and the zoom pans only drags nobody
  claimed. Before, the zoom read the brushes' modifiers and the brush warned about the zoom.

The brush now behaves differently with `modifier: "none"`. It claims every drag, so a zoom on the same chart never
pans. Before, both moved at once and a warning said so.

- **legend-filter** filtered the scale of the first `legend` guide by default. Now it filters the scale of the first
  guide bound to a categorical color scale, which is the same legend, found by its scale.

What the core adds weighs 0.2 KB. A test in `test-dist.js` scans every compiled block for a `.type` compared with
another block's type, and for another block asked for by name. Lib blocks may be asked for by name, and a block may
name its own type. The scan finds all seven places that named another block before. Another test defines marks
and interactions under new names with the same declarations, and checks that they are treated the same way. Putting
back the old tooltip, crosshair, line, animate or zoom fails it.

## The core knows no block

The third item of the audit: the core named blocks in four places, and now it reads what they declare.

- **`ScaleDef.fieldsOnly`** (band): the domain comes from fields alone. A constant a channel writes, such as a rule at one
  category, adds nothing to it. Before, the core skipped constants for a scale of type `band`.
- **The constants check** warns about a constant that misses its scale only along the width or the height of the
  plot. That is a scale named `x` or `y`, or one with `range: "width"` or `"height"`. Before, it listed the kinds band,
  linear, log and time. A size scale was among them, though a radius has no place to miss.
- **`position` of a guide** is checked against the values the guide declares. Without a declaration it is one of the
  four sides. Before, the core added `auto` for a guide of type `legend`.
- **`GuideDef.fits`** (axis): how many labels of its band fit along a length. `ChartCtx.ticks` of a band shows as many
  as the guides bound to that scale say fit. The measuring moved from the core's `bandLabels` into guide.axis.

**The palette has one source.** The core's `PALETTE` was Tableau's. The composer and the site wrote the dashboard palette
over it, and the site set only 8 of the 12 colors. So the 9th to 12th series on the site, and every color of a chart on
a page with no CSS, came from another palette. Now:

- the light palette is written once, in the core, and given as `BC.palette`;
- the composer writes its `--bc-c<N>` from it, and the text on each color, `--bc-on-c<N>`, by contrast;
- the dark palette lives in the composer (`DARK_PALETTE`);
- the site generates `site/src/data/palette.css` from both in `site-prebuild.js`;
- the demo page sets only the dark colors.

The core is 0.2 KB lighter and guide.axis is 0.35 KB heavier. A test defines a band, a number scale of a new kind, a
legend and an axis under other names, and checks that each is treated as what it declares. Putting back any of the
four old names in the core fails it. Another test checks that the light colors of a composed page are `BC.palette`.

One leak was left for later: a mark listed the scale types its channels accept by name, so a scale of a new name fit no
built-in mark. It is closed in "Scales say what they are".

## Facets read what the blocks declare

The fourth item of the audit. The composer's facets named scale types, `legend` and `legend-filter`. Now:

- **`ScaleDef.merge`** says how the panels' domains go together: `"union"` (band, color) or `"extent"` (linear, log,
  time, sequential, size). A scale that declares a `nice` param is not rounded again. Without `merge`, each panel
  keeps its own domain.
- **`GuideDef.shownOnce`** (legend): the guide shows its scale and nothing of its panel. When the panels share that
  scale and it merges by union, the page draws it once above them.
- **`InteractionDef.outerLegend`** (legend-filter): it can follow a legend outside the chart, given `legend` and
  `scale`.

The composer used to cut shared scales out of a legend-filter's `fit`. That step is gone. A shared scale has its
domain written in, and `fit` leaves such a domain alone. A test in test-blocks now holds that rule.

Two behaviors change:

- **A size scale is shared** like the others, so a bubble of one size is one value in every panel. Before, size was not
  in the list, and each panel scaled its bubbles alone.
- **`free: ["color"]`** keeps the legend in each panel. Before, the legend left the panels, and an empty one was drawn
  above them.

A test builds a dist with a scale, a legend and a filter under new names. They only hand the work to the real blocks.
Putting back any of the three names in the composer fails the test.

The skill's note on facets was out of date: a legend-filter has worked across panels, and the field could come from a
transform, since the commit that made it so. The note now says so.

## Scales say what they are

The last item of the audit. A mark listed the scale types its channels took (`scales: ['linear', 'log', 'time']`), and
guides and interactions compared `scale.kind` with names: an axis wrapped the labels of a `band`, a legend drew a bar
for a `sequential`, the filter took only a `color`, the tooltip headed the card with a `time` or a `band`, the zoom
had a case for `log`. A scale of a new name fit none of it. Now:

- **`ScaleDef.output`** says what a scale makes of a value: `"position"`, `"color"` or `"size"`. **`ScaleDef.input`**
  says what it takes: `"number"`, `"date"` or `"category"`. Linear and log place numbers, time places dates, band
  places categories, color colors categories, sequential colors numbers, size sizes numbers. Both are required:
  `BC.define` refuses a scale without them, and so does the manifest build.
- The core puts them on the scale it creates (`scale.output`, `scale.input`). `kind` is gone, so no block can go by a
  scale's name any more: the types say so.
- **`ChannelDef.accepts`** replaces `scales`: `{ output: "position", input: ["number", "date"] }` for the y of a line,
  `{ output: "color", input: ["category"] }` for its color, `{ output: "size" }` for the size of a point. The message
  for a wrong scale says what the channel needs, which scales on the page would do, and what the given one is:
  `needs a scale that places numbers or dates (linear, log, time); "band" places categories`. The block reference and
  the blocks page list the accepted scales from the same declarations.
- **The zoom** (`lib.view`) works on how far along its full domain the scale itself puts a value, from 0 to 1. That is
  the value on a linear scale and its logarithm on a log one, so log needs no case, and a square-root scale of
  someone else's zooms evenly too. The ends of the domain are written as its own values: through the mapping and back,
  38% of them came out a rounding off.

Two behaviors change. The x of a candlestick takes a log scale too, since it takes any scale that places values. A bar
on a number scale of any name grows from its 0 when animated; before, only a scale named `linear` had one.

A test defines a square-root scale no block knows: a line and a rule draw on it, its axis writes numbers by their
format, and "+" halves the view in square roots. Another defines copies of the built-in scales under new names: a
legend draws swatches, a bar or circles by what each declares, the filter takes only the one of categories, the
tooltip heads the card with a date, bars stand along dates. Each of 21 parts fails a test when broken, and the check
of the built site fails when the blocks page stops listing the accepted scales.

## The production review

Before the first release, seven reviewers who had not seen the code before went through it: the core, the blocks that
compute, the blocks that draw, the composer and the tooling, the skill, every recipe in Chrome, the site. They found no
blocker and about seventy problems, each with a repro. The fixes, in the order they were made:

- **A page.json is a page.** The command line passed every key of page.json to `compose()`, so `"distDir": "lib"` ran a
  `lib/core.js` next to the page on the machine that composed it (a vm is no sandbox), and `"allowErrors": true` wrote a
  page with errors. Now it takes the keys of a page (`PAGE_KEYS`: title, subtitle, lang, layout, css, defaultCss,
  compress, data, charts); `distDir`, `allowErrors`, `before`, `after`, `include`, `dryRun`, `drawTimeout` and `baseDir`
  are for a program that calls `compose()`. Any other key is an error that names the key it looks like (`subtitel`: did
  you mean `subtitle`?), in `compose()` too. A byte order mark at the start of page.json, which Windows PowerShell 5.1
  writes, is dropped instead of failing as invalid JSON.
- **A report fetches nothing, and the browser enforces it.** A color was any string: `url(http://…)` as a fill, or
  `red;background-image:url(…)` in the range of a facet's legend, which is written into a style attribute, made the page
  request it. Now a parameter of kind `color` (the fill and stroke of every mark, the candles of a candlestick) and every
  item of the range of a scale that declares `output: "color"` must be a color that loads nothing: hex, `rgb()`/`hsl()`
  and their kin, a name, `var(--x)` with such a fallback. The composer refuses css with `@import` or a `url()` that is
  not `data:`. And every report carries a Content-Security-Policy that refuses any request (`default-src 'none'`;
  inline scripts and styles; images and fonts only as `data:`), with an icon of its own so the browser does not ask
  for /favicon.ico: whatever the checks miss, a CSS escape that spells `url` or an `<img>` an API caller adds, the
  browser does not load. All 48 recipes draw under it in Chrome, gradients (`url(#…)`) included, with no console
  error.
- **A name every object has is not a name of the spec.** Scales were looked up in plain objects, so `"scale":
  "constructor"` found `Object` and passed as declared: the bars were drawn by it, 1 to 3 px tall, with no diagnostic.
  `BC.formatter("constructor")` wrote numbers instead of saying the format is unknown. Now validation looks up the
  declared scales, and a chart its built scales and its view, in objects without a prototype, and presets by own key. A
  column named `__proto__` became the prototype of the columns instead of one of them (lost from rows, a TypeError from
  columns, lost while decoding binary columns): `BC.data`, the CSV reader and `lib.columns` (for a new column of a
  transform) refuse it with what to rename. A CSV column named `constructor` no longer finds a type in `types` it was
  not given.
- **A log scale ends.** Its domain is rounded out to powers of ten, and a value near `Number.MAX_VALUE` (a common stand-in
  for "infinite") rounded to `1e309`, which is `Infinity`; one near `5e-324` rounded to `0`. The ticks then counted
  powers of ten without end: the tab froze, and the composer stopped only at its time limit with "a block is stuck".
  Now a widened or rounded end that a number cannot hold leaves the data's own end, a zoom to a non-finite end is the
  full domain, and a tick past what a number holds is not one. A test runs the extremes in a child process with a time
  limit, since the bug it guards against never returns.
- **The composer writes no data the page cannot read.** A page unpacks at most 64 MB of compressed data, against gzip
  bombs. The composer compressed whatever was worth it, so a 43 MB CSV of short text (more than 64 MB as JSON) made a
  page that refused its own data. Now "auto" leaves such a dataset as it is, and `compress: true` is an error that says
  to aggregate or decimate first.
- **A misspelled key is never dropped without a word.** `"interactions"` for `"interaction"` took the tooltip, the filter
  and the zoom with it, and the page was written with no diagnostic; so did `layout.colums`, a CSV `delimeter`, an entry's
  `notes`, or a `facet` written inside the spec. Now an unknown key of the page, a chart entry, `layout` or a CSV dataset
  is an error, and a key of the entry written inside the spec is told where it goes. An unknown key of a spec is a
  warning, like an unknown parameter of a block (a spec of a newer version still draws in an older core). Each names
  the key it looks like: the same but for case, or at most two letters off. `nullValues` must be a list (a text became
  a set of its letters), `types` must name columns of the header, and `noteHtml`, raw HTML, is for a program that calls
  `compose()`, like `before` and `after`.
- **Every key of a spec holds what it says.** `"padding": {"left": "40"}` became `"400"` by string concatenation and
  the plot vanished; `"transforms": {}` failed as "forEach is not a function" at path ""; `"title": {}` printed
  "[object Object]"; `"locale": "en_US"` and a view of `[]`, `[5]` or `["a", "b"]` drew nothing. Now validation checks
  the type of each key (containers are lists, `scales` and `view` objects, `title` and `id` text, `responsive` a
  boolean, `locale` a language tag `Intl` accepts), each view as its scale reads it (two different numbers or dates,
  at least one category), and each scale's `domain` is a list. `padding` may be one number for every side, as in CSS:
  `padding: 0` used to mean the default padding, without a word. A parameter that is a format (`format` of an axis, a
  legend, a KPI, a text mark, `formats` of a tooltip) is tried by the formatter during validation, and lists of fields
  (`fields` of a tooltip or a fold) are checked as fields, so a mistake is reported at its own path
  (`guides[1].format`, `interaction[0].formats.b`) and not as a chart that failed while it drew. A scale of positions
  other than x and y has no range of its own: without `range` everything it placed was drawn at one point, and now it
  is an error at the scale. A spec nested a hundred levels deep is refused by the composer with its path, where it
  used to overflow the stack.
- **A reader of numbers given text says so.** A CSV column of amounts with one `n/a`, a `$1,750` or a decimal comma
  is text, as written; a number scale skips text, a sum of it is 0, and the page was written with an empty chart and
  exit code 0. Now, when the chart is built, a scale of numbers or dates that reads a field with none of them is an
  error at the channel (`marks[0].y`), and one that leaves a few out is a warning; both name the values, the odd ones
  before numbers in quotes. A transform declares what a field parameter reads (`reads: "number"` on the field of bin,
  stack, window, quartiles and the others, `"date"` on calendar) and is checked the same way, once, also when it
  reruns at every redraw; aggregate refuses a sum, mean, min, max or median of a field with no numbers. A transform
  that fails on such a field reports what it could not read, and any failure of a transform is reported at
  `transforms[i]`, no longer at the chart. The CSV reader warns about a column that is mostly numbers but text because
  of a few cells, names them and says what to do: `nullValues` for "no value", plain numbers for amounts, `types` for
  a column that is text.
- **A CSV file is read as it is, or not at all.** A file was read as UTF-8 whatever it was: what Excel writes for "CSV
  (Comma delimited)", Windows-1252, became text with "�" in place of every accent, and UTF-16 column names with a NUL
  between every two letters. Now UTF-8 (with or without a byte order mark) and UTF-16 with a byte order mark are
  read, and anything else is an error with the line it fails on, as Windows-1252 shows it, and how to save the file;
  an .xlsx renamed to .csv is told so. Whole numbers past 2^53 (ids of 19 digits) turned into one another as numbers:
  such a column stays text, with a warning, and `"1e400"`, which is Infinity and null in JSON, is not a number. A
  page.json at the root of a drive could read no file, since "inside the folder" was a prefix test against `C:\` plus a separator;
  it is `path.relative` now.
- **A domain is read or refused, and time has every scale of it.** The sequential, log, time and size scales took a
  domain of two values and dropped any other without a word: `[-10, 0, 10]` for a diverging color scale became the
  extent of the data, and the colors lied about where zero is (one of our own dogfooding dashboards had exactly that).
  Now validation checks the domain of every scale of numbers or dates as it checks a view, two different ends the
  scale can read, at `scales.x.domain`, with the way to a diverging scale when a color scale is given three values;
  the blocks refuse it too, where no validation runs, and a scale that cannot be made is reported at `scales.<name>`.
  A time domain from later to earlier runs the axis the other way, with ticks, where it had none. A time scale had no
  step below a second, so a trace of a few milliseconds had no labels; it has steps of 1 ms to 500 ms now. Years as
  numbers (2019 … 2023) are milliseconds into 1970 to a time scale: it says so and how to give years. The years 0 to
  99 were ticked as 1900 to 1999 (`Date.UTC` reads two digits so). And values that differ only by rounding
  (`0.1 + 0.2` and `0.3`) were two ends 5.6e-17 apart, with a thousand ticks: they are one value now.
- **A date is ISO, or it is not a date.** `BC.time` handed what was not ISO to `Date.parse`, which reads "3/1/2024",
  "Mar 1, 2024" or "2024-3-1" as the reader's local time: the same report put the points on other days in Tokyo and
  in New York, and "3/1" is March to one writer and January to another. Now a year, a month, a day (`"2024"`,
  `"2024-03"`, `"2024-03-01"`) and the date-times the core already read as UTC are dates, and nothing else is: the
  chart names the values it could not read, and how to write them.
- **A transform says which parameter, and writes over nothing.** Window, stack and density wrote their columns over
  the data's own without a word: `"as": "v"` on a window replaced the column every other mark read, a stack of `v`
  over a column already named `v0`, and a density with `"as": ["x", "count"]` lost its density to the count. Now they
  refuse, as the transforms on `lib.columns` already did, and name the parameter to change. Every transform that
  cannot find a field names the parameter it was given in (`unknown field "nope" in "measures[1].field"`), finds a
  field by its own key (`"constructor"` is no column), and decimate checks its fields also when it runs without a view.
  Bin edges were rounded to 12 significant digits, so edges 0.0002 apart at 1e9 were all "1000000000": far from zero an
  edge keeps the digits that tell it from its neighbour.
- **A chart speaks its own language, also on hover.** The chart's `locale` was set for `BC.formatter` when the chart
  was built and never taken back: a page's own `BC.formatter("integer")` after a German chart wrote "1.000.500", and a
  sankey card on hover wrote in the language of whichever chart drew last. Now the language holds only while the chart
  is built and drawn; what a block writes outside drawing (the tooltip's formats and dates, the sankey card) it writes
  with `ctx.format`, which always speaks the chart's language. The tooltip had made its formatters after the drawing,
  so they already wrote the default: a German chart's card said "Feb 1, 2024".
- **A view set before the data comes is the view the chart is built with.** `handle.setView` on a chart whose
  dataset was still decoding did nothing: there was no chart to take it, and the page's zoom (from a link, a saved
  state) was lost without a word. Now it is kept and used once, when the chart is built, over the spec's own `view`
  (`null` takes that back), as setView does after; an `update()` before then keeps it for a scale of the same type,
  an unknown scale is said at once, and `getView()` meanwhile returns the views set so far.
- **A legend never leaves the plot a sliver.** A legend on the right is a column as wide as its longest label or title,
  whatever the width of the chart: on a 390 px phone it took a quarter to two thirds of it (the contours plot kept 28%,
  the bubble chart 37%), and with long names the plot was a pixel wide. Thirty categories in a column 300 px tall ran
  thirteen of them off the bottom. Now a column that would take more than a fifth of the chart's width, or more than its
  height, is a row on top, which wraps; a label or title too long for a row is cut with an ellipsis (whole characters,
  never half an emoji) and keeps its whole text as a title for hover. On a desk nothing moved except one column whose
  title made it wider than a fifth (the contours, now a row above the plot).
- **The top label of a color bar keeps clear of the title.** A label sits on the middle of its value, so the top one of
  a column bar stood half a line above the bar, over the title ("Level" on "8" in the contour lines). The bar starts
  half a line lower when there is a title.
- **Long names on a vertical axis keep to 30% of the chart.** A ranking of departments or products took as much room
  for its names as the longest one asked: on a phone the bars were a few pixels wide. Now the labels of a vertical axis
  take at most 30% of the chart's width; a longer one breaks at a space onto a second line when its band is tall
  enough for two (between characters in Chinese or Japanese), the rest is cut with an ellipsis, and the whole name is
  the label's title on hover. A single word longer than the room is cut, not put on a line of its own past it.
- **A dot on the edge of the plot shows its card.** The tooltip looked for a datum only while the pointer was on the
  plot, edges included, but a dot at the end of a domain sits on the edge with half of it outside: that half showed
  nothing, and on a page that scales the chart up (a card wider than the chart's size, as on a desk) the pointer on
  its center mapped a hair outside, so the first and the last dot of a scatter never had a card. The tooltip now looks
  12 px past the plot (a dot's radius and the slack of its pick); every pick is bounded, so over the axis labels it
  still shows nothing. Found while hovering in real Chrome at 1100 px.
- **A card of long text stays on a phone screen.** The tooltip card never wrapped (`white-space: nowrap`), so a long
  name made it wider than a 390 px phone: placed at the left edge, it still ran off the right one and the page
  scrolled sideways. Now the card is at most as wide as the part of the chart the reader sees (`border-box`, so a page
  without the composer's reset gets the same width) and a long text wraps, breaking a URL anywhere; a short card is
  still one line per field. Checked by a new suite in real Chrome, `npm run test:chrome` (`scripts/test-chrome.js`,
  also in CI): it composes pages, hovers every point at phone and desk widths, and measures where the card lands, also
  on a chart wider than the screen that scrolls in its card.
- **Names at the line ends survive a zoom.** The end labels stand past the plot's right edge, in the padding, and were
  drawn with the marks: a zoom clips the marks to the plot, so the moment a reader zoomed, every name was cut to
  nothing. A mark may now give `labels()`, primitives drawn above the marks outside the clip; mark.line draws its names
  there, at the last point in view (one above or below a y zoom is not named over the plot's edge).
- **Zoomed, the tooltip and the crosshair stay on points in view.** A zoomed series keeps one point past each edge so
  its line runs on to the edge; the line and area picks took the nearer of the two points around the pointer, and the
  crosshair the nearest of all, so near an edge they showed a datum the reader could not see, with its marker and line
  outside the plot. Now a point out of view gives way to its neighbour in view, and between two points that are both
  out of view (a window narrower than the spacing) there is nothing to show.
- **A step line is picked where it is drawn.** `curve: "step"` holds each value up to the next point and rises there,
  but the line's pick measured the distance to the straight segment between the points: on the shelf near a jump the
  tooltip found nothing, and in the empty corner where a straight line would run it found a value. Now the pick measures
  to the shelf the pointer is over (the value held) and to the risers (the value risen to), and a step area takes the
  held edges for the column the pointer is in. Under a step line with an area beneath it, the column decides on the
  riser itself, a pixel wide.
- **Bars standing at dates keep inside the plot.** A bar on a time (or linear) axis is centred on its value, so the
  first and last bars ran half out of the plot, over the axis and past the edge. `MarkDef.reach` now lets a mark name
  values its scale's domain must hold; `mark.rect` without `x2` asks for half a bar past the first and last value (0.4
  of the smallest step, or `thickness / 2` of it). It asks only on a scale that declares `even` (`ScaleDef.even`: equal
  differences of value are equal distances, as on linear and time; half a step on a log axis is no half a bar), so it
  names no scale type. With `x2`, on a band, on a log axis or on the amount axis nothing changes.
- **A target's label reads over the bars.** The label of a `mark.rule` stood at the right end of the line, among the
  marks: a target crossed by the last bar had its name written on the bar, or covered by it when the rule came first.
  The label is now drawn by the rule's `labels()` above every mark, in a halo of the card color
  (`--bc-tooltip-bg`), and only while the end of its line is in view, so a zoom does not leave it on the edge. The halo
  is a new style field, `paintOrder: "stroke"` (the stroke under the fill), which both renderers follow.
- **Japanese and Chinese labels break where a reader would.** A band label without spaces broke after as many
  characters as fit: 2024年1月 became "2024 / 年1月" and 2024年第1四半期 "2024年第 / 1四半期". A line now breaks only
  after a wide character, keeps a number with the word in front of it (第1) unless a number stands before that word too
  (年 after 2024 ends the year), never starts with a closing mark (、。」ー, small kana) nor ends with an opening one
  (「); of those places it takes the one whose first line fits and whose two lines are the most even: "2024年 / 1月",
  "2024年 / 第1四半期". Whether the labels go at an angle is decided by the wider of those two lines, not half the label.
- **A Sankey flow that skips a column runs through a gap of its own.** Jet fuel → Airlines reached from the second
  column to the last and was drawn as one curve behind "Retail stations". `transform.sankey` now cuts such a flow into
  pieces through a node no one sees in each column between, which takes part in the order and the height of that
  column, so the ribbon passes between the nodes; the places are written to a sixth column, `waypoints` (`as` and
  `layout` take five names still), and `mark.sankey` draws the ribbon straight across the columns it passes and picks
  it there. A table laid out without them draws its long flows as before.
- **Sankey labels on a phone.** A label that did not fit lost its total, so some nodes showed one and others not, and
  long names were cut. Now the totals are on every node or on none; a total that does not fit goes under its name and a
  long name breaks at a space, as many lines as the node is tall; two labels that meet in the last gap first move apart,
  up and down beside their nodes, and only share the gap when they cannot.
- **Text is the same size in every card.** A chart was laid out again at its container's width only when that was
  narrower than `size`; a wider card stretched the drawing, text and all. On a desk the cards of a report are about
  800 px wide, so the labels were 11 px on a chart sized 800 and 18 px on the slope chart sized 480, larger than the
  card's own title (14 px). Now the chart is laid out at the container's width either way, at the height of `size`:
  every label of every recipe is 11–12 px at any width, and `size[0]` is the width only where none is known. A
  chart sized narrower than 200 px is laid out at its own size below it, where it was stretched out to 200. The slope
  recipe drops its `padding.right` of 110 px: on a band axis the last point stands in the middle of its band, whose
  outer padding holds the names, and the padding had left the right third of the card empty.
- **A waterfall on a phone keeps its figures at full size.** Seven bars on a phone have about 36 px each, and the
  figures shrank to 8.5 px: a label on a band had the step from one category to the next, as if the labels beside it
  were as wide and at the same height. Now a label at its bar (not in a cell) may reach into the gap before the next
  bar and shares the step only with a label of the next band at the same height (all of a row still take one size).
  In a waterfall a loss starts at the top of the bar before it, so with every figure on top two of them always stood
  side by side; the recipes now put each figure where its bar ends, a loss's under it, through a new channel of
  `mark.text`: `sign` names the field whose sign `negative: "flip"` reads (`amount`) when the label stands at the end of
  a bar that is above zero (`value1`). A flip that would carry a label out of the plot (a loss down to nearly zero)
  leaves it on its own side. With a figure on every bar the value axis and its grid go, as IBCS has it, and their 45
  px with them: the figures are 11 px from 360 px up. The names under the bars, at 45° on a phone, left an empty band
  of about 26 px: the axis reserved their length by `measure()`, which is generous by a quarter on Latin text. It now
  uses `ctx.textWidth`, the widths of characters measured in Chrome that `mark.text` had kept to itself, moved into the
  core for both.
- **The columns of a Marimekko are named over them.** Each name stood in its column's tallest cell, so it sat on a
  different supplier in each column, and a narrow column (Africa, 7% of a phone's plot, 18 px) shrank it to 8 px or
  left it out. On the top cell it had failed before: real data put a thin cell there (the oil dashboard's own company,
  1–14%). A Marimekko is a column chart whose columns are as wide as their shares, so its names belong where a column
  chart has them, on an axis; Highcharts' variwide chart does the same. `guide.axis` takes `text`, `from` and `to`:
  the rows' own spans, named over their middles, instead of the scale's ticks. Names wider than their span break at a
  space and move apart as little as they can (pool adjacent violators: the least squares off their middles), each still
  over its span's middle: on a phone Africa's stands right of its middle. When that is not enough the names of the narrowest spans go, as few as
  it takes, or all go at 45° when that leaves out fewer; unlike a band, whose categories are all as wide, a narrow span
  is the least of the whole and the tooltip still names it. A span under 2 px is named by none. The recipe names its
  columns on top and moves the legend to the bottom; the names are 11 px from 360 px up.
- **The hexagons of a hexbin keep inside the plot.** The scales took their domains from a first binning for a plot 1.6
  times as wide as tall, and the hexagons were binned anew for the plot as drawn: the outer ones stood up to 11 px over
  its edge (on a desk the top row over the padding, on a phone over the top and short of the bottom). Now a transform
  that follows the plot and can do without it runs once more after the layout, with `TransformView.fitting` and nothing
  zoomed, and the scales take their domains from that run; again while new domains lay the plot out anew (four rounds at
  most). Regular hexagons do not fill a box of any shape, whole rows and columns being what they are: stretched to fill
  it, they came out up to 18% off regular over 9,000 shapes of plot. So they stay regular, and hexbin says through
  `TransformView.reach` what else the scales are to hold, as MarkDef.reach does for a mark: the box of the hexagons made
  the plot's shape by as much more on each side along one axis. That room is under a third of a hexagon a side on most
  plots, up to 2.7 on plots wider than 4:1 with three rows. A redraw on scales that span the room gets the same table; a
  zoom, a domain of their own or a rounded one makes the hexagons follow the scales, as before.
- **A Gantt names its first month; a vertical axis keeps its top label in the chart.** The plan ran from 5 January and a
  time scale ticks on the first of a month, so January had no tick. `scale.time` takes `nice`, off by default so a line
  runs from edge to edge: the inferred domain goes out to whole calendar units of about ten ticks, as d3's does. The
  recipe takes it and asks for every month (`count: 6`): January to July, on a desk and on a 360 px phone. The candlestick
  recipe's padding is 8, and its top label stood 1.25 px out of the chart: a line set on its middle reaches 0.84 em
  above it in Segoe UI, and the axis kept half of measure()'s line (0.6 em). It keeps 0.85 em now; the default padding
  of 16 had room enough. A Chrome test looks at every recipe at 1100 and 390 px for a line of text above or below its
  chart (sideways a label is as wide as the font, which differs between machines: see the roadmap). The review
  also named a hairline under the empty bins of the histogram: that is the x axis line, which runs under the bars too,
  and a bin of 0 draws nothing.
- **The dot on a tooltip's card has the color of what the card is about.** The tooltip guessed a datum's color from the
  mark's spec: the color channel, else `fill`, else `stroke`, else the palette color of the mark's place. A candle is
  green or red by its rise or fall, and the dot was the palette's blue. A line split by `group` with no color channel
  draws its series in the palette colors that follow, and the dot gave each the first. A dot with only an outline
  (`stroke`) took the outline's color, a Sankey flow the palette's blue and not its node's color. Each mark now says the
  color it drew a row in, `MarkDef.color`, from the same function its render draws with, and a test draws every recipe
  again and holds each shape against the color its mark names. On a bullet chart the pointer is mostly over a band behind
  the bar, while the card, with `fields: ["actual", "target"]`, is about the bar: the dot was the band's grey, near white
  in light and near the card in dark. With `fields`, when the shape under the pointer does not draw the first value on
  the card, the dot takes the color of the mark that does (the topmost); the marker and the highlight stay on the shape
  hovered. A color as light or as dark as the card (a pale band, a dark heatmap cell on a dark card, a yellow one on
  white) keeps in sight inside a ring of `--bc-tooltip-highlight-line`.
- **An error bar's whisker, a dumbbell's bar and a lollipop's stem have a card.** `mark.rule` had no pick, so the
  pointer found only the dots at the ends of such lines: on a whisker 2 px wide, away from its mean, no card came. A rule
  now picks the line nearest the pointer, within 5 px of its stroke, and only the part of it the plot shows (zoomed, the
  rest is clipped). A line along an axis lights up as a box around it, 8 px across or 2 px a side past a wider stroke,
  like a bar; a slanted one gets the dot where it is nearest. A dot drawn over the line still wins where it is, as a
  later mark does on a tie, and a bar under a line wins 1 px off the line's stroke. A rule of constants alone (a target,
  "today", the middle line of a pyramid) is the same line on every row and stands for none, so it picks nothing and
  leaves the pointer to the bars under it. A line many rows draw (an average repeated on each) stands for all of them,
  and its card shows what they share (`Pick.rows`).

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
