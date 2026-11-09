---
name: blockcharts
description: Build a standalone HTML page with interactive charts — a business dashboard or a chart report (KPI tiles with sparklines, bars, stacked and grouped bars, lines, areas, waterfall, funnel, bullet, treemap, scatter, pie, heatmap, histogram, boxplot, dual axis; zoom, tooltips, legend filter) — from tabular data given inline or as a CSV file. Use when the user wants a chart, a report or a dashboard as one self-contained .html file that opens offline and can be emailed or shared. You write a JSON description; a composer checks it against the real data and produces the page with only the chart code it uses. You never write JavaScript. Not for PNG images, plotting-library code (matplotlib, pandas), charts in plain text, or live data from a server.
license: MIT
metadata:
  version: "0.24.1"
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
..."}`, or `{"csvFile": "orders.csv"}` for a file next to `page.json` (it must stay inside that folder). The first CSV row names the columns; numbers and ISO dates, months like `2025-01` included, are recognized by themselves. Empty cells, `NA`, `N/A`, `null`, `NULL`, `NaN` and `nan` are missing; `nullValues` (a list) replaces that list for values like `n/a` or `-`, and `types` (`{"zip": "string"}`) forces a column to `number` or `string`. A column with `$1,750` or `USD 8,204.00` stays text, and text does not add up: clean such amounts with a short script first, and give the result to the page. Rows (`[{...}]`) or columns (`{"columns": {"a": [..], "b": [..]}}`). Every row has the same keys. Missing value = `null`. Numbers are numbers, not strings. **Dates are ISO strings** (`"2024-03-01"` or `"2024-03-01T12:00:00Z"`), read as UTC. Several charts may use the same dataset.
- `charts`: each entry is a chart spec, or `{title, note, spec, span}` to get a heading and a sentence around it. Every chart sits in a card. Text with no chart is such a section. An entry `{"section": "Devices", "note": "One line."}` is a heading over the whole width that starts a group of cards: give a page of more than about ten charts sections.
- `facet`: small multiples. `{"spec": {...}, "facet": {"field": "region", "columns": 3}}` draws the chart once per value of a column of the dataset, in one card, on the same axes, with one legend above the panels. Use it instead of many lines on one plot, or of a row of separate charts. Size the spec for one panel, about [300, 180]. `"values": [...]` picks and orders the panels; `"free": ["y"]` lets a scale differ between panels, for series of very different size. The field must be in the data itself, not made by a transform. A `legend-filter` does not work across panels: it is dropped with a warning, so do not promise one in a note. See `recipes/small-multiples.json`. A calendar heatmap faceted by year needs `"free": ["x"]`, or every year takes only its part of one shared time axis.
- `lang`: the language of the page (`"ko"`, `"ja"`, `"zh-CN"`). It sets `<html lang>`, the font for that language and the language of numbers and dates, presets included, so a page in one language needs no `locale` anywhere. Always set it on a page that is not in English: without it Japanese is drawn in a Chinese font. A `{"section": ..., "lang": "ja"}` lasts until the next section, a chart entry can take its own, and a format's own `locale` wins.
- `title` and `subtitle`: the page heading and one line under it (the period, the scope, the unit: "FY2025 · all regions · USD").
- `layout`: `{"columns": 4}` (any number from 1 to 12) turns the page into a dashboard grid; `"phoneColumns": 2` keeps the `span: 1` tiles side by side on a phone, where every other card takes the whole width; each chart takes `span` columns (default: the whole row). Put KPI tiles first, `span: 1` each, then the charts (`span: 2` or `3`). On a phone every card takes the full width. Size a chart for its card: about 280 px wide per column. A chart that cannot be read narrow (a heatmap with a number in every cell) takes `"minWidth": 560` next to `spec`: below that width it stays wide and its card scrolls sideways.
- Optional: `css` (extra stylesheet text), `compress` (`"auto"` by default: big datasets are stored gzipped when that saves more than the decoder it adds, which you do not have to think about).

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

**Marks read data through channels.** `"x": "region"` means "the field `region`, on the scale named `x`". Spelled out: `{"field": "units", "scale": "y2"}`. A constant: `{"value": 5}`. On a position (`x`, `y`, `x2`, `y2`) it is a value on the scale, in the units of the data, on every mark; the scale makes room for it unless you gave a `domain`. A channel that names a scale you did not declare is an error. The scale's type must suit the mark (a `line` needs `linear` or `time` on y, and also takes `band` on x for categories in order; a `rect` accepts `band` on either).

**Guides are attached to scales, not marks**: `{"type":"axis","scale":"y"}`. Two marks on the same scales share one axis. A second axis on the same orientation needs `position` (`"right"`, `"top"`, ...). Guides that take space on a side (axis, legend) stack outward in the order you list them.

**Order in `guides`** decides drawing and stacking: grid first (it sits behind the marks), then axes, then the legend.

**`color`**: to color by a field, declare `"color": {"type":"color"}` in `scales`, give the mark `"color": "<field>"`, and add `{"type":"legend","scale":"color"}`. On a `line` or `area` the color field also splits the rows into one series per value.

**Stacked charts**: use `transform.stack` (`field`, `by` = the category, `group` = the series), then draw `y` = `<field>1` and `y2` = `<field>0`. See `stacked-bar.json` and `stacked-area-100.json`.

**Streamgraph**: `transform.stack` with `"center": true` puts the middle of every stack on 0, so the layers flow around a center line; draw a `mark.area` (y = `<field>1`, y2 = `<field>0`) with `curve: "smooth"`, a time x, and no y axis (only the thickness of a layer means something; the tooltip gives the numbers). Give the stack `"follows": "color"` when there is a legend filter. See `recipes/streamgraph.json`.

**Histogram**: `transform.bin` turns raw values into bins (`bin0` start, `bin1` end, `count`); draw them with a `rect` (`x: "bin0"`, `x2: "bin1"`, `y: "count"`) on a linear x scale. Add `"group"` to get separate counts per group.

**Violin plot and ridgeline**: `{"type": "density", "field": "ms", "group": "region"}` turns raw samples into a smooth curve per group (rows `value`, `density`, `count`; it replaces the rows, so it goes last). Draw it with `{"type": "violin", "x": "region", "y": "value", "density": "density"}` on a band x: a violin per category, which shows what a box plot hides (two humps, a long tail). On a band y with `"side": "one"` the same rows are a ridgeline, a ridge per category rising into the band above (`"paddingInner": 0` on the band scale, and room on top: `padding.top` about 40). For values that cannot be negative give the density `"extent": [0, null]`. A violin needs a few dozen samples per category; with fewer, show the points. See `recipes/violin.json`, `recipes/ridgeline.json`.

**Beeswarm**: every sample as a dot, `mark.point` with `"swarm": true` on a band scale (categories on y, the value on x, or the other way round): the dots of each category spread across its band so none overlap, each at its own value. A band of about 90 px on a 720 px chart holds about a hundred dots of a category at `"r": 3, "swarmGap": 0.5`. When a category does not fit (on a phone the value axis is shorter), every dot of the mark shrinks as little as makes it fit, down to half its `r` (`swarmShrink` sets how far, 0 keeps `r`); a dot that still finds no room is laid over the others. With more dots use a taller chart or a violin. See `recipes/beeswarm.json`.

**Coloring by a number** (heatmap, colored dots): declare `"color": {"type": "sequential"}` (optionally `"range": ["#hex", "#hex", ...]`, hex colors only; 0 is a real value with a color, `null` is not drawn), give a `rect` or `point` mark `"color": "<numeric field>"`, and add the legend. A row with no number gets no color and is not drawn.

**Pie and donut**: `mark.arc` with `"value": "<numeric field>"` and `"color": "<category field>"`. It needs no x or y scale, only the color scale (and its legend). `innerRadius` makes a donut, `label: "percent"` writes percentages, `sort: "desc"` puts the biggest slice first. Use it for a handful of parts of one whole; prefer bars for more than about six categories.

**Gauge and progress ring**: the same `mark.arc` with one row. `"startAngle": -90, "endAngle": 90` draws the upper half circle of a gauge (the chart is fitted to it, so about `[360, 220]`); `"total": 100` is the maximum, so the value fills its share and the rest of the arc is an empty track; `"center": "value"` writes the figure in the middle, `"percent"` its share of `total` (written with `labelFormat`). Give it `innerRadius` 0.7 or more, `padAngle: 0` and one `fill`. A full circle with `total` = the target is a progress ring. A value past `total` fills the arc and the figure says how far past. See `recipes/gauge.json`.

**Text labels**: `mark.text` writes a label at (x, y) from a field: `{"type": "text", "x": "region", "y": "total", "text": "total", "baseline": "auto", "dy": -5}` puts the value above a bar. `decimals` fixes the number of decimals; `format` writes it as currency, percent and so on (see below). Labels over a row of categories never run into each other: when they are wider than a category they all get smaller together, down to `minSize` (8), and a label that does not fit even then is left out. With many bars or a narrow chart, keep values short (`"notation": "compact", "maximumFractionDigits": 0`) and leave the exact figure to the tooltip. A label inside a shape takes `x2` / `y2`, the other corner of the shape, and stays inside it the same way.

**Step lines**: `"curve": "step"` on a `line` (and an `area` under it) holds each value until the next row, then jumps: a rate, a price list, a tariff, a stock level. Each row is the moment a value took effect; repeat the current value in a last row at the end of the period, or the line stops at the last change. See `recipes/step-line.json`.

**Bars over time**: a `rect` with `x` on a `time` scale and `y` on a linear one stands at each date, as wide as most of the smallest step in the data. Give `x2` for bars that must span an exact period.

**Horizontal bars**: put the band scale on `y` and the linear scale on `x` and swap the channels (`"x": "total", "y": "region"`); categories read from the top.

**Long series**: for a line with more than a few thousand points add `{"type": "decimate", "x": "<x field>", "y": "<y field>"}` to `transforms` (data sorted by x). It keeps the lowest and highest point of every pixel column, so the picture does not change, and redoes this at every zoom. With several series (`group`), the rows of each series must be sorted by x; the composer warns if not. Zooming into a sorted series is fast on its own; `decimate` matters for the first, fully zoomed-out view.

**Very many marks**: a chart normally draws SVG elements, one per mark, which is fine up to a few thousand. For a scatter (or bars) of tens of thousands of marks add `"renderer": "canvas"` to the chart spec: it draws on one canvas and redraws about 5 times faster at 50,000 points. Everything else (zoom, brush, tooltip, legend filter, colors, dark mode) works the same; only CSS class hooks and native hover titles do not exist on a canvas. It does not help a single long line (that is one path either way): use `decimate` for those. Numeric columns of this size can be given as binary columns (`runtime/encode-columns.js`), see the recipe.

**Zoom**: on a page that is not in English give `zoom-controls` its `titles` (`{"reset": ..., "out": ..., "in": ...}`), what the buttons say to a mouse and a screen reader. `{"type":"zoom"}` on a time or linear x scale; add `"fit": ["y"]` so the y axis follows the visible window. Ctrl + wheel zooms, drag pans, double-click resets. `maxZoom` limits how far in (default 50x the full range; raise it for very long series).

**Select to zoom**: `{"type": "brush"}` lets the reader drag a rectangle (holding Shift by default, so it does not clash with the pan of `zoom`) to zoom to it. `"scales": ["x", "y"]` selects a box; on a `band` scale it selects the categories under the rectangle. Add `"fit": ["y"]` to make the y axis follow. Double-click resets.

**Legend as a filter**: `{"type": "legend-filter"}` lets the reader click legend items to hide or show categories (double-click isolates one). It works with any chart that has a `color` scale and a legend. Add `"fit": ["y"]` to make the y axis follow the visible categories, but not together with a `zoom` that already has `fit`.

**Tooltip**: `{"type":"tooltip"}`; `"fields": [...]` picks what it shows, `"labels": {"median": "Median, ms"}` names them (formats stay keyed by the field). On a line chart it shows the nearest point of the nearest series when the pointer is near it, and at any height with a `crosshair`. Values are shown raw (numbers to 6 digits), so add `"formats": {"revenue": {"style":"currency","currency":"USD"}, "share": "percent", "day": "date"}` to write them properly.

**Summarize before drawing**: `{"type": "aggregate", "groupby": [...], "measures": [...]}` in `transforms` turns raw rows into one row per group: `"groupby": ["region"]` or `[{"field": "date", "unit": "month", "as": "month"}]` (units: year, quarter, month, week, day, hour); measures `{"op": "sum" | "mean" | "min" | "max" | "median" | "count" | "distinct", "field": "amount", "as": "revenue"}`; `sort` (an output column), `order` (`"asc"`/`"desc"`), `limit`. After it only the group-by fields and measure names exist as columns. A monthly total is `groupby` month + `sum`, drawn on a `time` x scale. See `recipes/report-from-csv.json`.

**Moving averages, running totals, change**: `{"type": "window", "field": "sales", "op": "mean", "size": 7, "sort": "day", "as": "avg7"}` adds a column and keeps every row. `op`: `mean` / `sum` / `min` / `max` over the last `size` rows (`align: "center"` for a centered window), `cumsum` a running total, `diff` and `pctChange` the change from the previous row (pctChange is a fraction; write it with the `percent` format). Always give `sort` (the x field) unless the rows are already in order, and `group` for one result per series. The first `size - 1` rows of a series get no value (`partial: true` computes them from fewer rows). Draw the new column as another line over the raw one. To smooth monthly totals, put `aggregate` first and `window` after it. See `recipes/moving-average.json`.

**A total of the group on every row**: `{"type": "window", "field": "amount", "op": "total", "group": "quarter", "as": "quarterTotal"}` writes the sum of each quarter on every row of it, and `"op": "share"` each row as a part of that sum (a fraction, write it as `percent`). `"op": "rank"` writes each row's place in its group (1 for the largest, `"order": "asc"` for the smallest; ties share a place): with `group` = the year and a line per item over the years, a bump chart (`recipes/bump-chart.json`). Unlike `aggregate` they keep the rows, so the segments of a stacked bar can be labelled with their share of the bar, the tooltip can show the quarter's total, and a `line` of the total column runs over the stacks. A row with no value still gets the total; a group that adds up to 0 has no shares. See `recipes/bars-and-line.json`.

**Numbers the data does not have**: `{"type": "calculate", "a": "revenue", "op": "-", "b": "cost", "as": "profit"}` adds a column per row; `op` is `+`, `-`, `*` or `/`, and `"value": 1000` replaces `b` with a constant (`"a": "revenue", "op": "/", "value": 1000, "as": "revenue"` to show thousands). Chain them: profit first, then `margin` = profit / revenue (write it with the `percent` format). Missing values and division by zero give no value. See `recipes/calculated-field.json`.

**Keep some rows, rank them**: `{"type": "filter", "field": "year", "value": 2024}` keeps the rows that pass (`op`: `==` default, `!=`, `<`, `<=`, `>`, `>=` with a number, text or a date like "2024-03-01"; `in` / `notIn` with a list; `valid` drops rows without a value). Several filters all apply. `{"type": "sort", "field": "revenue", "order": "desc", "limit": 10}` orders the rows and keeps the top 10; add `"group": "region"` for the top N of each region. Bars on a band scale follow row order, so this ranks them. After `aggregate`, use its own `sort` / `limit`. See `recipes/top-n.json`.

**Series in columns (a wide table)**: when the data has one column per series (`month, Online, Retail, Partners`), add `{"type": "fold", "fields": ["Online", "Retail", "Partners"], "key": "channel", "value": "revenue"}` first in `transforms`: each row becomes one row per field, with the column name in `channel` and its number in `revenue`. Then color, stack, dodge or aggregate by `channel` as with long data. Do not reshape the data by hand. See `recipes/wide-table.json`.

**Values across orders of magnitude**: `{"type": "log"}` as a scale (instead of `linear`) when values span several powers of ten (from 1K to 10M) or when growth rates matter: steady growth becomes a straight line. Only positive values are drawn (zero and negatives are left out and break a line); do not give it `zero`. Ticks are powers of ten, compact unless the axis has a `format`. Bars on a log scale are rarely right; prefer lines and points. See `recipes/log-scale.json`.

**Numbers and dates as text**: axis (`format`), tooltip (`formats`), `mark.text` (`format`) and the color-bar legend (`format`) take a preset (`"percent"` for 0..1 values, `"compact"`, `"integer"`, `"year"`, `"quarter"` (Q2 2024), `"month"`, `"day"`, `"date"`, `"datetime"`) or an object of Intl options: `{"style": "currency", "currency": "EUR", "maximumFractionDigits": 0}`, `{"maximumFractionDigits": 1, "suffix": " kg"}`, `{"month": "short", "year": "2-digit"}`; `"locale"` (default en-US) changes the language. On a band axis the format writes categories that are dates or numbers (text stays as it is): months or quarters from `aggregate` come out as ISO dates, so give that axis `"format": "month"` or `"quarter"`, and the same in the tooltip `formats`. An axis takes `"title": "Revenue, USD"` (it makes room by itself). A stacked chart with `normalize: true` has values 0..1: give its y axis `"format": "percent"`. On a heatmap, give the text mark `"on": "<the cell's color field>"` and the label turns light or dark to stay readable.

**Survey / Likert answers**: count with `aggregate` (`groupby` question and answer, `count`), stack with `normalize: true`, put the question on the band scale and format the axis as percent.

**KPI tile**: a tile with no sparkline is `marks: []`, `scales: {}`, about `[280, 84]` with small padding; with a sparkline about `[280, 150]`. Width is never laid out below 200, and a chart too low for its guides gets a warning. `rowField` names the row of the figure ("Best month: September"), so it is not typed by hand. A chart whose guides include `{"type": "kpi", "field": "revenue", "label": "Revenue", "format": ..., "note": "vs last month"}`. It shows the value of the last row in large type and its change against the row before, green when it rises (`"better": "down"` for costs and churn). `aggregate` (sum, mean, ...) makes one number of all rows; `against` compares with another field (a target); `compare: "first"` shows the change over the period. `delta: "absolute"` writes the change as a difference with `format`; when it has another unit than the value (a share in %, its change in points) give it `"deltaFormat": {"maximumFractionDigits": 1, "suffix": " pp"}`; it writes the difference in the units of the field, so a share kept as 0..1 also takes `"deltaScale": 100`. It takes the room it needs at the top: a line plus an area under it in the same chart become the sparkline (y scale without `zero`, the area with `toBottom: true`). A tile may also be the guide alone, with `"marks": []`. Size it about [280, 150] with small padding. See `recipes/executive-dashboard.json`.

**Waterfall (bridge)**: `transform.waterfall` (`field` = the change of each row, `total` = a field that marks subtotal rows; to open with a total, give `start` the opening value and mark the first row as a subtotal) writes `<field>0`, `<field>1`, `step` (increase / decrease / total), `amount` and `top`. Draw a `rect` with y = `<field>1`, y2 = `<field>0`, `color: "step"` on a color scale with `domain` ["increase", "decrease", "total"] and your three colors as `range`; label with a `text` at y = `top`, text = `amount`. See `recipes/waterfall.json`.

**Funnel**: `transform.funnel` (`field` = how many reached the stage, stages in row order) writes `<field>0`, `<field>1` (centered on zero), `rate` and `stepRate`. Draw a `rect` with x = `<field>0`, x2 = `<field>1`, y = the stage on a band scale, and a `text` of `rate` at x = `<field>1`. See `recipes/funnel.json`.

**Targets and thresholds**: `mark.rule` draws lines at values. `{"type": "rule", "y": {"value": 50000}, "dash": [4, 4], "label": "Target"}` is a horizontal line at 50 000 on the y scale. On a band scale it becomes a short tick across the band: a bullet chart is three grey `rect` bands, a slim `rect` of the result (`thickness: 0.36`) and a `rule` of the target. See `recipes/bullet.json`.

**Candlestick**: `mark.candlestick` with `x`, `open`, `high`, `low` and `close`. Declare `x` (time, or band) and `y` scales; the prices share `y`. It does not start at zero unless you ask. See `recipes/candlestick.json`.

**Calendar heatmap**: `transform.calendar` with `field` = the date writes `week`, `weekEnd` and `day`; draw them with `mark.rect` (`x`: week, `x2`: weekEnd, `y`: day, `color`: the value) on a time x, a band y and a sequential color, and give the tooltip `"heading": "<date field>"`, or its card opens with the week. One row per day: aggregate first if there are more. See `recipes/calendar-heatmap.json`.

**Marimekko**: `transform.marimekko` with `field` = the size and `category` = the columns. Draw `x0, x1, y1, y0` with `mark.rect` on two linear scales with the domain [0, 1] and `"nice": false`; both axes are shares of the whole, so format them as `"percent"`. It also writes `share` (of the column) for the tooltip and `label` for a `mark.text`. See `recipes/marimekko.json`.

**Sankey**: `mark.sankey` with one row per flow, `"source"`, `"target"` and `"value"`. It needs no scales and no axes, and names its nodes itself; `"format"` adds each node's total. With a tooltip, a ribbon shows its row and a node shows what flows in and out; on a page in another language give `"nodeLabels": ["유입", "유출"]`. Flows have to run one way, so a loop is an error. A name is one node wherever it occurs: if two stages share a name, write them differently. See `recipes/sankey.json`.

**Treemap**: `transform.treemap` (`field` = size, `group` = block, `name` = label, `aspect` = plot width / height) writes x0, x1, y0, y1 in 0..1 and `label`. Draw a `rect` (x = x0, x2 = x1, y = y1, y2 = y0) on two linear scales with `domain: [0, 1]`, no axes, colored by the group; a `text` of `label` at (x0, y1) with `x2` = x1, `y2` = y0 (so a label that does not fit its cell shrinks or is left out) and `on` set to the color field. See `recipes/treemap.json`.

**The dashboard look**: charts already come with quiet axes, a card tooltip and a calm palette. What makes them look finished:
- A line with a soft area under it: an `area` with `fade: true` and a `line` on top, both with the same explicit color (`"fill"`/`"stroke"`: `"var(--bc-c0, #3a6fe4)"`), `curve: "smooth"` on both. Without an explicit color, each mark takes the next palette color.
- Bars with `radius` 3–4; `paddingInner` 0.25–0.35 on the band scale.
- A grid on the value axis only (`{"type": "grid", "scale": "y"}`), compact number formats on axes (`{"style": "currency", "currency": "USD", "notation": "compact"}`).
- Direct value labels (`mark.text`) instead of a legend when there are few bars.
- A `note` that says what the chart shows, in one sentence.
- Names at the line ends instead of a legend: `"label": "name"` (or `"value"`, `"both"` with `format`) on each
  `line`, `"name"` for a line that is not split into series, and room on the right (`"padding": {"right": 96}`, more
  for Chinese, Japanese or Korean, about 12 px a character). Padding stays the same on a phone, so keep it modest.
- `{"type": "crosshair"}` with the tooltip on time series: a line that follows the pointer to the nearest date.
- `{"type": "animate"}`: the chart plays in once (bars grow, lines draw); readers who ask for less motion get none.
- On a phone a chart is laid out again at the screen width, so keep `size` for the desktop card and do not
  shrink it for phones. Text categories that no longer fit go at an angle by themselves; labels inside cells that
  do not fit are left out, so give such a chart `minWidth` in its `charts` entry.

## Recipes

| Need | Recipe |
| --- | --- |
| Compare categories (with the value written on each bar) | `recipes/bar.json` |
| Parts of a whole per category | `recipes/stacked-bar.json` |
| Compare categories side by side within each group | `recipes/grouped-bar.json` |
| The top N items (of one year, of each region), ranked | `recipes/top-n.json` |
| A number computed from the columns (profit from revenue and cost, a margin) | `recipes/calculated-field.json` |
| Rank categories without the visual weight of full bars | `recipes/dotplot.json` |
| Spread and outliers of raw samples per category | `recipes/boxplot.json` |
| Trends of several series, with zoom | `recipes/lines-by-series.json` |
| Data with one column per series (a wide spreadsheet table) | `recipes/wide-table.json` |
| A moving average over noisy daily values; a running total per series | `recipes/moving-average.json` |
| How each item changed between two points (before and after, two years) | `recipes/slope.json` |
| The same chart for each region, product or country, to compare on one scale | `recipes/small-multiples.json` |
| Two numeric variables, groups by color | `recipes/scatter-groups.json` |
| Two numeric variables and a third as the size of each bubble | `recipes/bubble.json` |
| Values over several orders of magnitude; growth rates of series of very different size | `recipes/log-scale.json` |
| Two measures with different units | `recipes/dual-axis.json` |
| Shares over time | `recipes/stacked-area-100.json` |
| How values of one variable are spread | `recipes/histogram.json` |
| How values are spread in each category, with the shape a box plot hides (two humps, a tail) | `recipes/violin.json` |
| How values are spread across many categories or periods (a month each), compared at a glance (ridgeline) | `recipes/ridgeline.json` |
| Every sample of a few categories as a dot, without overlaps: deals, salaries, response times (beeswarm) | `recipes/beeswarm.json` |
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
| Volume flowing between stages (product to channel to customer) | `recipes/sankey.json` |
| Market size and share at once: how big each column is, and who holds it | `recipes/marimekko.json` |
| Prices per period: open, high, low, close | `recipes/candlestick.json` |
| A number per day over months: weekly patterns | `recipes/calendar-heatmap.json` |
| A report from raw CSV rows: monthly totals, ranking, currency | `recipes/report-from-csv.json` |
| One bar set apart (the best month), and a tile that names it | `recipes/highlight-bar.json` |
| Stacked bars with a line of another measure (a margin) on a second axis; segments labelled with their share of the bar | `recipes/bars-and-line.json` |
| One figure against its maximum or target: a gauge, a progress ring | `recipes/gauge.json` |
| A value that changes at moments and stays: a rate, a price, a tariff (step line) | `recipes/step-line.json` |
| How the places of items changed over the years: who overtook whom (bump chart) | `recipes/bump-chart.json` |
| How several parts of a whole rise and fall over time, the shape more than the numbers (streamgraph) | `recipes/streamgraph.json` |
| A project plan: tasks from start to end on a time axis (Gantt) | `recipes/gantt.json` |
| A change between two values per category (dumbbell); a value per category, lighter than a bar (lollipop) | `recipes/dumbbell.json` |
| A mean with its interval (error bars); a forecast with its range (confidence band) | `recipes/error-bars.json` |
| Two groups back to back per category (a population pyramid by age and sex) | `recipes/pyramid.json` |

Each recipe is a complete `page.json` that composes as it stands.

## Rules that avoid most errors

- Use the field names that are really in the data. The composer checks them and lists the unknown ones.
- `zero: true` on the y scale of bars and areas, otherwise the bars start at the lowest value.
- To draw the same rows as a line and as points, use two marks (one `line`, one `point`).
- A `band` axis thins its labels when there are many categories. With more than about 12, aggregate or filter first so the chart stays readable.
- Eight categories or more that must be read on a phone: horizontal bars. Vertical bars lose their labels there, horizontal ones keep every label and value.
- On an axis, `count` asks for more or fewer labels and `anchor: "end"` keeps the last one, so a December report says December. Give the grid of that scale the same `count`, or its lines miss the labels.
- The same category in several charts of a page: give each color scale the same `domain`. Colors go by first appearance, so a sorted chart would otherwise swap them.
- A ratio of totals (the share of late orders) is `aggregate` of both fields, then `calculate`. Never the mean of the weekly ratios.
- Do not invent block types or parameters. Only what is in `reference/blocks.md` exists. An unknown parameter is a warning, an unknown block is an error.
- Do not put functions, `NaN` or `Infinity` in the JSON. Use `null` for missing values.
- Keep the data in `page.json` (inline rows or CSV text) or in a CSV file next to it; never a URL.
- For integer histograms use `"width": 1` and an `extent` so each value gets its own bin.

## What you cannot do here

Custom drawing code, animations, maps and network data sources are outside this tool. If the user needs a tooltip with custom content, that is a small function registered by a developer with `BC.defineFn` and referenced by name (`"content": "name"`); tell the user instead of writing it.
