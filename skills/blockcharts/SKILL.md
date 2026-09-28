---
name: blockcharts
description: Build a standalone HTML page with interactive charts — a business dashboard or a chart report (KPI tiles with sparklines, bars, stacked and grouped bars, lines, areas, waterfall, funnel, bullet, treemap, scatter, pie, heatmap, histogram, boxplot, dual axis; zoom, tooltips, legend filter) — from tabular data given inline or as a CSV file. Use when the user wants a chart, a report or a dashboard as one self-contained .html file that opens offline and can be emailed or shared. You write a JSON description; a composer checks it against the real data and produces the page with only the chart code it uses. You never write JavaScript. Not for PNG images, plotting-library code (matplotlib, pandas), charts in plain text, or live data from a server.
license: MIT
metadata:
  version: "0.2.0"
compatibility: Needs Node.js 18 or later to run the bundled composer (runtime/compose.js, no dependencies, no network).
---

# blockcharts

You describe charts as **JSON**. A composer (`runtime/compose.js`, plain Node, no dependencies) checks every chart against the real data, inlines exactly the code those charts need, and writes **one HTML file** that works offline from disk. Do not write JavaScript, SVG or HTML for the charts yourself.

## Workflow

1. Get the data as rows (`[{"region":"North","total":42}, ...]`) or columns.
2. Pick the closest recipe from `recipes/` (table below) and copy it. Change the data, field names, titles.
3. Save it as `page.json`.
4. Run `node "${CLAUDE_SKILL_DIR}/runtime/compose.js" page.json report.html` from the folder that holds `page.json` (`${CLAUDE_SKILL_DIR}` is the folder of this skill; where that variable is not set, use the path of `runtime/` next to this file).
5. If it prints errors, fix `page.json` and run again. The messages name the path in the JSON (`charts[0].marks[0].y: unknown field "ghost"`). It writes nothing until every chart is valid.
6. Hand over `report.html`. Charts are interactive in a browser; there is no server and no network.

Look up any block, parameter or channel in `reference/blocks.md`. It is generated from the code, so it is always current.

## page.json

```json
{
  "title": "Page title",
  "data": { "sales": [ {"region": "North", "total": 42} ] },
  "charts": [
    { "title": "Heading", "note": "One line of text under it.", "spec": { ...chart spec... } }
  ]
}
```

- `data`: named datasets. A dataset can also be CSV: `{"csv": "date,region,amount
2024-01-05,North,1200
..."}`, or `{"csvFile": "orders.csv"}` for a file next to `page.json` (it must stay inside that folder). The first CSV row names the columns; numbers and ISO dates are recognized by themselves. Rows (`[{...}]`) or columns (`{"columns": {"a": [..], "b": [..]}}`). Every row has the same keys. Missing value = `null`. Numbers are numbers, not strings. **Dates are ISO strings** (`"2024-03-01"` or `"2024-03-01T12:00:00Z"`), read as UTC. Several charts may use the same dataset.
- `charts`: each entry is a chart spec, or `{title, note, spec, span}` to get a heading and a sentence around it. Every chart sits in a card.
- `title` and `subtitle`: the page heading and one line under it (the period, the scope, the unit: "FY2025 · all regions · USD").
- `layout`: `{"columns": 4}` turns the page into a dashboard grid; each chart takes `span` columns (default: the whole row). Put KPI tiles first, `span: 1` each, then the charts (`span: 2` or `3`). On a phone every card takes the full width. Size a chart for its card: about 280 px wide per column.
- Optional: `css` (extra stylesheet text), `compress` (`"auto"` by default: big datasets are stored gzipped, which you do not have to think about).

## Chart spec

```json
{
  "data": "sales",
  "size": [640, 320],
  "transforms": [ ],
  "scales":  { "x": {"type": "band"}, "y": {"type": "linear", "zero": true} },
  "guides":  [ {"type": "grid", "scale": "y"}, {"type": "axis", "scale": "x"}, {"type": "axis", "scale": "y"} ],
  "marks":   [ {"type": "rect", "x": "region", "y": "total"} ],
  "interaction": [ {"type": "tooltip"} ]
}
```

**Scales are declared once and given names.** `x` and `y` are the horizontal and vertical positions by convention. Every other name (`color`, `y2`, ...) is yours to choose.

**Marks read data through channels.** `"x": "region"` means "the field `region`, on the scale named `x`". Spelled out: `{"field": "units", "scale": "y2"}`. A constant: `{"value": 5}`. A channel that names a scale you did not declare is an error. The scale's type must suit the mark (a `line` needs `linear` or `time` on x and y, a `rect` also accepts `band`).

**Guides are attached to scales, not marks**: `{"type":"axis","scale":"y"}`. Two marks on the same scales share one axis. A second axis on the same orientation needs `position` (`"right"`, `"top"`, ...). Guides that take space on a side (axis, legend) stack outward in the order you list them.

**Order in `guides`** decides drawing and stacking: grid first (it sits behind the marks), then axes, then the legend.

**`color`**: to color by a field, declare `"color": {"type":"color"}` in `scales`, give the mark `"color": "<field>"`, and add `{"type":"legend","scale":"color"}`. On a `line` or `area` the color field also splits the rows into one series per value.

**Stacked charts**: use `transform.stack` (`field`, `by` = the category, `group` = the series), then draw `y` = `<field>1` and `y2` = `<field>0`. See `stacked-bar.json` and `stacked-area-100.json`.

**Histogram**: `transform.bin` turns raw values into bins (`bin0` start, `bin1` end, `count`); draw them with a `rect` (`x: "bin0"`, `x2: "bin1"`, `y: "count"`) on a linear x scale. Add `"group"` to get separate counts per group.

**Coloring by a number** (heatmap, colored dots): declare `"color": {"type": "sequential"}` (optionally `"range": ["#hex", "#hex", ...]`, hex colors only; 0 is a real value with a color, `null` is not drawn), give a `rect` or `point` mark `"color": "<numeric field>"`, and add the legend. A row with no number gets no color and is not drawn.

**Pie and donut**: `mark.arc` with `"value": "<numeric field>"` and `"color": "<category field>"`. It needs no x or y scale, only the color scale (and its legend). `innerRadius` makes a donut, `label: "percent"` writes percentages, `sort: "desc"` puts the biggest slice first. Use it for a handful of parts of one whole; prefer bars for more than about six categories.

**Text labels**: `mark.text` writes a label at (x, y) from a field: `{"type": "text", "x": "region", "y": "total", "text": "total", "baseline": "auto", "dy": -5}` puts the value above a bar. `decimals` fixes the number of decimals; `format` writes it as currency, percent and so on (see below).

**Horizontal bars**: put the band scale on `y` and the linear scale on `x` and swap the channels (`"x": "total", "y": "region"`); categories read from the top.

**Long series**: for a line with more than a few thousand points add `{"type": "decimate", "x": "<x field>", "y": "<y field>"}` to `transforms` (data sorted by x). It keeps the lowest and highest point of every pixel column, so the picture does not change, and redoes this at every zoom. With several series (`group`), the rows of each series must be sorted by x; the composer warns if not. Zooming into a sorted series is fast on its own; `decimate` matters for the first, fully zoomed-out view.

**Very many marks**: a chart normally draws SVG elements, one per mark, which is fine up to a few thousand. For a scatter (or bars) of tens of thousands of marks add `"renderer": "canvas"` to the chart spec: it draws on one canvas and redraws about 5 times faster at 50,000 points. Everything else (zoom, brush, tooltip, legend filter, colors, dark mode) works the same; only CSS class hooks and native hover titles do not exist on a canvas. It does not help a single long line (that is one path either way): use `decimate` for those. Numeric columns of this size can be given as binary columns (`runtime/encode-columns.js`), see the recipe.

**Zoom**: `{"type":"zoom"}` on a time or linear x scale; add `"fit": ["y"]` so the y axis follows the visible window. Ctrl + wheel zooms, drag pans, double-click resets. `maxZoom` limits how far in (default 50x the full range; raise it for very long series).

**Select to zoom**: `{"type": "brush"}` lets the reader drag a rectangle (holding Shift by default, so it does not clash with the pan of `zoom`) to zoom to it. `"scales": ["x", "y"]` selects a box; on a `band` scale it selects the categories under the rectangle. Add `"fit": ["y"]` to make the y axis follow. Double-click resets.

**Legend as a filter**: `{"type": "legend-filter"}` lets the reader click legend items to hide or show categories (double-click isolates one). It works with any chart that has a `color` scale and a legend. Add `"fit": ["y"]` to make the y axis follow the visible categories, but not together with a `zoom` that already has `fit`.

**Tooltip**: `{"type":"tooltip"}`; `"fields": [...]` picks what it shows. On a line chart it shows the nearest point of the nearest series. Values are shown raw (numbers to 6 digits), so add `"formats": {"revenue": {"style":"currency","currency":"USD"}, "share": "percent", "day": "date"}` to write them properly.

**Summarize before drawing**: `{"type": "aggregate", "groupby": [...], "measures": [...]}` in `transforms` turns raw rows into one row per group: `"groupby": ["region"]` or `[{"field": "date", "unit": "month", "as": "month"}]` (units: year, quarter, month, week, day, hour); measures `{"op": "sum" | "mean" | "min" | "max" | "median" | "count" | "distinct", "field": "amount", "as": "revenue"}`; `sort` (an output column), `order` (`"asc"`/`"desc"`), `limit`. After it only the group-by fields and measure names exist as columns. A monthly total is `groupby` month + `sum`, drawn on a `time` x scale. See `recipes/report-from-csv.json`.

**Numbers and dates as text**: axis (`format`), tooltip (`formats`), `mark.text` (`format`) and the color-bar legend (`format`) take a preset (`"percent"` for 0..1 values, `"compact"`, `"integer"`, `"year"`, `"month"`, `"day"`, `"date"`, `"datetime"`) or an object of Intl options: `{"style": "currency", "currency": "EUR", "maximumFractionDigits": 0}`, `{"maximumFractionDigits": 1, "suffix": " kg"}`, `{"month": "short", "year": "2-digit"}`; `"locale"` (default en-US) changes the language. An axis takes `"title": "Revenue, USD"` (it makes room by itself). A stacked chart with `normalize: true` has values 0..1: give its y axis `"format": "percent"`. On a heatmap, give the text mark `"on": "<the cell's color field>"` and the label turns light or dark to stay readable.

**Survey / Likert answers**: count with `aggregate` (`groupby` question and answer, `count`), stack with `normalize: true`, put the question on the band scale and format the axis as percent.

**KPI tile**: a chart whose guides include `{"type": "kpi", "field": "revenue", "label": "Revenue", "format": ..., "note": "vs last month"}`. It shows the value of the last row in large type and its change against the row before, green when it rises (`"better": "down"` for costs and churn). `aggregate` (sum, mean, ...) makes one number of all rows; `against` compares with another field (a target); `compare: "first"` shows the change over the period. It takes the room it needs at the top: a line plus an area under it in the same chart become the sparkline (y scale without `zero`, the area with `toBottom: true`). A tile may also be the guide alone, with `"marks": []`. Size it about [280, 150] with small padding. See `recipes/executive-dashboard.json`.

**Waterfall (bridge)**: `transform.waterfall` (`field` = the change of each row, `total` = a field that marks subtotal rows) writes `<field>0`, `<field>1`, `step` (increase / decrease / total), `amount` and `top`. Draw a `rect` with y = `<field>1`, y2 = `<field>0`, `color: "step"` on a color scale with `domain` ["increase", "decrease", "total"] and your three colors as `range`; label with a `text` at y = `top`, text = `amount`. See `recipes/waterfall.json`.

**Funnel**: `transform.funnel` (`field` = how many reached the stage, stages in row order) writes `<field>0`, `<field>1` (centered on zero), `rate` and `stepRate`. Draw a `rect` with x = `<field>0`, x2 = `<field>1`, y = the stage on a band scale, and a `text` of `rate` at x = `<field>1`. See `recipes/funnel.json`.

**Targets and thresholds**: `mark.rule` draws lines at values. `{"type": "rule", "y": {"value": 50000}, "dash": [4, 4], "label": "Target"}` is a horizontal line at 50 000 on the y scale (keep it inside the domain). On a band scale it becomes a short tick across the band: a bullet chart is three grey `rect` bands, a slim `rect` of the result (`thickness: 0.36`) and a `rule` of the target. See `recipes/bullet.json`.

**Treemap**: `transform.treemap` (`field` = size, `group` = block, `name` = label, `aspect` = plot width / height) writes x0, x1, y0, y1 in 0..1 and `label`. Draw a `rect` (x = x0, x2 = x1, y = y1, y2 = y0) on two linear scales with `domain: [0, 1]`, no axes, colored by the group; a `text` of `label` at (x0, y1) with `on` set to the color field. See `recipes/treemap.json`.

**The dashboard look**: charts already come with quiet axes, a card tooltip and a calm palette. What makes them look finished:
- A line with a soft area under it: an `area` with `fade: true` and a `line` on top, both with the same explicit color (`"fill"`/`"stroke"`: `"var(--bc-c0, #3a6fe4)"`), `curve: "smooth"` on both. Without an explicit color, each mark takes the next palette color.
- Bars with `radius` 3–4; `paddingInner` 0.25–0.35 on the band scale.
- A grid on the value axis only (`{"type": "grid", "scale": "y"}`), compact number formats on axes (`{"style": "currency", "currency": "USD", "notation": "compact"}`).
- Direct value labels (`mark.text`) instead of a legend when there are few bars.
- A `note` that says what the chart shows, in one sentence.
- Names at the line ends instead of a legend: `"label": "name"` (or `"value"`, `"both"` with `format`) on each
  `line`, `"name"` for a line that is not split into series, and room on the right (`"padding": {"right": 96}`).
- `{"type": "crosshair"}` with the tooltip on time series: a line that follows the pointer to the nearest date.
- `{"type": "animate"}`: the chart plays in once (bars grow, lines draw); readers who ask for less motion get none.
- On a phone a chart is laid out again at the screen width, so keep `size` for the desktop card and do not
  shrink it for phones.

## Recipes

| Need | Recipe |
| --- | --- |
| Compare categories (with the value written on each bar) | `recipes/bar.json` |
| Parts of a whole per category | `recipes/stacked-bar.json` |
| Compare categories side by side within each group | `recipes/grouped-bar.json` |
| Rank categories without the visual weight of full bars | `recipes/dotplot.json` |
| Spread and outliers of raw samples per category | `recipes/boxplot.json` |
| Trends of several series, with zoom | `recipes/lines-by-series.json` |
| Two numeric variables, groups by color | `recipes/scatter-groups.json` |
| Two measures with different units | `recipes/dual-axis.json` |
| Shares over time | `recipes/stacked-area-100.json` |
| How values of one variable are spread | `recipes/histogram.json` |
| A number for every pair of two categories | `recipes/heatmap.json` |
| Parts of a whole, as one circle | `recipes/pie.json` |
| A very long series (tens of thousands of points and more) | `recipes/long-series.json` |
| A scatter plot of tens of thousands of points (canvas, binary columns) | `recipes/scatter-large.json` |
| Several charts on one page | `recipes/dashboard.json` |
| A business dashboard: KPI tiles with sparklines, a trend against plan, a donut, a bridge and a funnel in a grid | `recipes/executive-dashboard.json` |
| How a start value becomes an end value through gains and losses (profit bridge) | `recipes/waterfall.json` |
| Conversion through the stages of a process | `recipes/funnel.json` |
| Results against their targets, with qualitative ranges | `recipes/bullet.json` |
| Shares of a whole across two levels (region, then product) | `recipes/treemap.json` |
| A report from raw CSV rows: monthly totals, ranking, currency | `recipes/report-from-csv.json` |

Each recipe is a complete `page.json` that composes as it stands.

## Rules that avoid most errors

- Use the field names that are really in the data. The composer checks them and lists the unknown ones.
- `zero: true` on the y scale of bars and areas, otherwise the bars start at the lowest value.
- To draw the same rows as a line and as points, use two marks (one `line`, one `point`).
- A `band` axis thins its labels when there are many categories. With more than about 12, aggregate or filter first so the chart stays readable.
- Do not invent block types or parameters. Only what is in `reference/blocks.md` exists. An unknown parameter is a warning, an unknown block is an error.
- Do not put functions, `NaN` or `Infinity` in the JSON. Use `null` for missing values.
- Keep the data in `page.json` (inline rows or CSV text) or in a CSV file next to it; never a URL.
- For integer histograms use `"width": 1` and an `extent` so each value gets its own bin.

## What you cannot do here

Custom drawing code, animations, maps and network data sources are outside this tool. If the user needs a tooltip with custom content, that is a small function registered by a developer with `BC.defineFn` and referenced by name (`"content": "name"`); tell the user instead of writing it.
