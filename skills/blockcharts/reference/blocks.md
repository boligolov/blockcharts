# Block reference

Generated from the code by `scripts/build-skill.js`; do not edit. A chart spec refers to a block by its `type`: `{"type": "rect"}` is `mark.rect`.

- **scale**: maps data to positions or colors. Declared once per chart under `scales`, by name.
- **transform**: prepares the dataset before anything is drawn (`transforms`).
- **mark**: draws the data (`marks`). Its channels (`x`, `y`, `color`, ...) name the fields to read.
- **guide**: axes, grid, legend (`guides`), attached to a scale.
- **interaction**: zoom, tooltip (`interaction`).
- **renderer**: draws the picture; `svg` is the default and needs no mention.

34 blocks: `scale.band`, `scale.color`, `scale.linear`, `scale.sequential`, `scale.time`, `transform.aggregate`, `transform.bin`, `transform.decimate`, `transform.funnel`, `transform.quartiles`, `transform.stack`, `transform.treemap`, `transform.waterfall`, `mark.arc`, `mark.area`, `mark.boxplot`, `mark.line`, `mark.point`, `mark.rect`, `mark.rule`, `mark.text`, `guide.axis`, `guide.grid`, `guide.kpi`, `guide.legend`, `interaction.animate`, `interaction.brush`, `interaction.crosshair`, `interaction.legend-filter`, `interaction.tooltip`, `interaction.zoom`, `interaction.zoom-controls`, `renderer.canvas`, `renderer.svg`.

## Keys every spec has

| Where | Key | Meaning |
| --- | --- | --- |
| chart | `data` | name of a dataset in the page data (required) |
| chart | `size` | `[width, height]` of the drawing, default `[640, 400]`; the chart scales to its container |
| chart | `title` | text above the plot |
| chart | `padding` | `{top, right, bottom, left}` in drawing units, default 16 each |
| chart | `transforms`, `scales`, `guides`, `marks`, `interaction` | lists of blocks (`scales` is an object of named scales) |
| chart | `view` | starting zoom: `{"x": [from, to]}` (dates as ISO strings or milliseconds) |
| scale | `type` | the scale block: `band`, `color`, `linear`, `sequential`, `time` |
| scale | `domain` | fixed domain instead of the inferred one: `[min, max]` for linear and time, a list of values for band and color |
| scale | `range` | `"width"` or `"height"` (the default of `x` and `y`), or an explicit list, e.g. colors for a color scale |
| scale | `field` | an extra field to include when inferring the domain |
| guide | `scale` | name of the scale the guide belongs to |
| guide | `position` | `top`, `right`, `bottom` or `left`; the default follows the scale (height: left, width: bottom) |
| mark | channels | `"field"`, `{"field": "f", "scale": "s"}` or `{"value": v}`; see each mark |

## scale.band

Version 2, 1.2 KB. Categorical scale: one band per distinct value, in first-seen order. Maps a value to the band's lower edge; `bandwidth` is the band width. Bands always run in increasing pixel order (left to right, top to bottom), also on a vertical axis, so horizontal bars list their categories from the top. Zoom = a window of categories.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `paddingInner` | number | `0.2` | Gap between bands, as a fraction of the step. |
| `paddingOuter` | number | `0.1` | Gap before the first and after the last band, as a fraction of the step. |

## scale.color

Version 2, 0.8 KB. Categorical color scale: one color per distinct value, in first-seen order. Colors come from `range` (a list of CSS colors) or from the theme palette (--bc-c0 …). Colors stay tied to the value when the domain is narrowed (setView, a legend filter); a value outside the visible domain gets no color, so marks do not draw it.

## scale.linear

Version 2, 1.4 KB. Continuous numeric scale. Domain is inferred from bound channels, padded, and extended to nice tick values.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `nice` | boolean | `true` | Extend the inferred domain to round tick values. |
| `zero` | boolean | `false` | Include 0 in the inferred domain (bars need it). |
| `padding` | number | `0` | Extra room around the data extent, as a fraction of its span (0.05 keeps edge points off the axes). |

## scale.sequential

Version 1, 2.0 KB. Continuous color scale: numbers map to colors along `range` (two or more #hex colors, mixed piecewise-linearly; default viridis). Values outside an explicit `domain` take the end colors; a missing or non-numeric value has no color, and marks do not draw such rows. Use it for heatmaps and for coloring points or bars by a number; for a diverging scale give three colors and a symmetric `domain`.

## scale.time

Version 1, 2.1 KB. Time scale in UTC. Values: epoch milliseconds, ISO date strings or Dates. Ticks snap to calendar units (seconds … years).

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `padding` | number | `0` | Extra room around the data extent, as a fraction of its span. |

## transform.aggregate

Version 1, 4.8 KB. Group-by: one row per distinct combination of the `groupby` fields, with measures computed over the rows of each group (`sum`, `mean`, `min`, `max`, `median`, `count`, `distinct`). A group-by field can be cut into calendar units, `{ "field": "date", "unit": "month" }` (year, quarter, month, week from Monday, day, hour; UTC; the group value is the ISO start of the unit). Missing values are ignored by the measures (`count` without a field counts rows). Groups come in order of first appearance, or sorted by a column with `sort`; a time unit sorts by time unless told otherwise. `limit` keeps the first N groups after sorting (top N).

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `groupby` | list |  | Fields to group by: names, or { "field", "unit", "as" }. Empty or missing: one group of all rows. |
| `measures` | list | `[{"op":"count"}]` | What to compute per group: [{ "op": "sum", "field": "revenue", "as": "total" }]. `as` defaults to "<op>_<field>" ("count" for a plain count). |
| `sort` | string |  | Output column (a group-by field or a measure `as`) to sort the groups by. |
| `order` | one of `asc`, `desc` | `"asc"` | Direction of `sort`. |
| `limit` | number |  | Keep only the first N groups (after sorting). |

## transform.bin

Version 2, 2.7 KB. Counts the values of `field` in equal-width bins with round edges and returns one row per bin: its start, its end and the count (`as`, default bin0 / bin1 / count). Empty bins are kept, so a histogram has no gaps. Bins are [start, end) except the last, which includes its end. With `group` there is a row per bin and group, for stacking or side-by-side comparison. Draw it as a rect with x = start, x2 = end and y = count.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to count. Missing and non-numeric values are ignored. |
| `bins` | number | `10` | Approximate number of bins; the width is rounded to 1, 2, 5 × 10^n. |
| `width` | number |  | Exact bin width; overrides `bins`. |
| `extent` | list |  | [min, max] to bin; values outside are ignored. Default: the range of the data. |
| `group` | field |  | Count separately for every value of this field. |
| `as` | list |  | Names of the three new columns: [start, end, count]. |

## transform.decimate

Version 2, 3.4 KB. Level of detail for long lines: keeps only the rows that can change how a line looks. Redone at every zoom. Inside the visible window it splits x into pixel columns and keeps the first, last, lowest and highest row of each, so the envelope of the data is exact; outside the window (beyond a small margin) it drops the rows. Windows that hold few rows are left whole. Needs data sorted by x (per `group`); anything else is passed through unchanged. Put it after transforms that create the rows and before the line mark reads them.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `x` | field, **required** |  | The x field of the line. |
| `y` | field, **required** |  | The y field of the line. |
| `scale` | scale | `"x"` | Name of the x scale. |
| `group` | field |  | Decimate every series (value of this field) on its own. |
| `buckets` | number |  | Pixel columns to split the plot width into. Default: one per px of plot width. |
| `threshold` | number | `4` | Decimate only when the window holds more than `threshold` rows per column. |

## transform.funnel

Version 1, 1.0 KB. A conversion funnel: stages in row order (visits, sign-ups, trials, purchases), each drawn as a bar centered on zero so the shape narrows. Writes the bar's two ends (`<field>0` = -value/2, `<field>1` = +value/2), the share of the first stage (`rate`) and of the stage before (`stepRate`). Draw with mark.rect (x = `<field>0`, x2 = `<field>1`, y = the stage on a band scale) and label with mark.text formatted as percent.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | How many reached the stage. |
| `as` | list |  | Names of the two end columns. Default [<field>0, <field>1]. |
| `rateAs` | string | `"rate"` | Name of the column with the share of the first stage (0..1). |
| `stepAs` | string | `"stepRate"` | Name of the column with the share of the previous stage (0..1; the first stage has none). |

## transform.quartiles

Version 1, 2.1 KB. The five-number summary of `field` (min/max here mean the Tukey whiskers, not the raw extremes): one row of low/q1/median/q3/high/count per distinct value of `group` (default: one row for the whole dataset). With `outliers` (default true), a sample further than 1.5x the IQR from the box is left out of the whiskers and reported as its own row instead, with `value` set and the summary fields NaN — draw the box from a rect (q1 to q3) or mark.boxplot, and the outliers from a plain mark.point reading `value`, both keyed on the same `group` field; the two kinds of row tell themselves apart by which fields are NaN, the same way a hidden category already tells a mark not to draw a row.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to summarize (the raw sample values). Missing and non-numeric values are ignored. |
| `group` | field |  | A separate summary per value of this field (the boxplot's category axis). A missing value is a group of its own, like transform.aggregate. Default: one summary. |
| `outliers` | boolean | `true` | true: whiskers stop at 1.5x IQR, points further out become their own "value" row. false: whiskers stretch to the true min/max, no outlier rows. |

## transform.stack

Version 1, 1.4 KB. Stacks the values of `field` on top of each other within every value of `by` (the category axis). Adds two columns, the start and the end of each row's segment (`as`, default `<field>0` and `<field>1`). Series are stacked in order of first appearance of `group`; negatives stack downward from 0 separately from positives; missing values contribute nothing and get NaN. Use the columns as y2 and y of a rect or area.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to stack. |
| `by` | field, **required** |  | Field whose values are the stacks (the x of a stacked bar). |
| `group` | field |  | Field that tells the series apart. Without it rows stack in data order. |
| `as` | list |  | Names of the two new columns: [start, end]. |
| `normalize` | boolean | `false` | Scale every stack to 0..1 (100% stacked). |

## transform.treemap

Version 1, 2.6 KB. A treemap: each row becomes a rectangle whose area is its `field`, laid out as near-square cells (squarified), largest at the top left. With `group`, rows are first gathered into one block per group (an area per region, then per product inside it). Writes the corners in 0..1 (`x0`, `x1`, `y0`, `y1`, y up) and a `label` for the cells big enough to hold one. Draw with mark.rect (x = x0, x2 = x1, y = y1, y2 = y0) on two linear scales with domain [0, 1] and no axes; color by the group; label with mark.text at (x0, y1). Set `aspect` to the width / height of the plot so the cells come out square.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The size of each cell (positive numbers; others are left out). |
| `group` | field |  | Field that gathers cells into blocks, one per distinct value. |
| `name` | field |  | Field with each cell's name, copied to `label` for cells that are big enough. |
| `aspect` | number | `1.6` | Width / height of the plot the treemap fills (for a 640 × 400 chart with no axes, about 1.6). |
| `padding` | number | `0.004` | Space between cells, as a share of the plot height. |
| `labelMin` | number | `0.02` | Cells smaller than this share of the whole get no label (so small ones stay clean). |
| `as` | list |  | Names of the four corner columns. Default [x0, x1, y0, y1]. |
| `labelAs` | string | `"label"` | Name of the label column. |

## transform.waterfall

Version 1, 1.4 KB. A waterfall (bridge) chart: how a starting value becomes an ending one through gains and losses. In row order, each row adds its `field` to a running total; the transform writes where each bar starts and ends (`<field>0`, `<field>1`), its kind (`step`: "increase", "decrease" or "total"), what it stands for (`amount`: the change, or the total) and its upper end (`top`, for a label above it). Rows marked by the `total` field are subtotals: their bar goes from 0 to the running total, and their own value is ignored. Draw with mark.rect (y = `<field>1`, y2 = `<field>0` on a band x), colored by `step` through a color scale.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The change each row makes (negative for a loss). |
| `total` | field |  | Field that marks subtotal rows (true, 1, "yes" or "total"): their bar shows the running total so far. |
| `start` | number | `0` | Where the running total begins. |
| `as` | list |  | Names of the start and end columns. Default [<field>0, <field>1]. |
| `kindAs` | string | `"step"` | Name of the column that says "increase", "decrease" or "total". |
| `amountAs` | string | `"amount"` | Name of the column with what each bar stands for: the change of a step, the running total of a subtotal. Label bars with it. |
| `topAs` | string | `"top"` | Name of the column with the upper end of each bar, where a label above it goes. |

## mark.arc

Version 1, 2.9 KB. Pie and donut chart: one slice per row, its angle proportional to `value`. Needs no x/y scales (declare only a color scale for the colors); the pie fills the plot area. Rows whose value is not a positive number are left out. Slices are laid out clockwise from 12 o'clock.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `value` | **required** | none (a plain field) | Numeric field: the size of each slice. |
| `color` | optional | `color`, `sequential` | Slice color per row from a color scale; a hidden category leaves its slice out. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `innerRadius` | number | `0` | Hole size as a fraction of the radius (0 = pie, 0.5 = donut). |
| `startAngle` | number | `0` | Where the first slice starts, in degrees clockwise from 12 o'clock. |
| `padAngle` | number | `1` | Gap between slices, in degrees. |
| `sort` | one of `none`, `desc`, `asc` | `"none"` | Order of the slices by value; "none" keeps the data order. |
| `label` | one of `none`, `percent`, `value` | `"none"` | Text outside each slice (slices under 3% get none). |
| `fill` | string |  | One color for all slices, when there is no color channel. |
| `opacity` | number | `1` |  |

## mark.area

Version 3, 3.0 KB. A filled band per series between y and y2 (or `baseline`, default 0). Stack with transform.stack and use its two columns as y2 and y. `group` or a `color` channel splits the rows into series, like mark.line. Missing values break the area. `fade` makes the fill fade out towards the bottom (put a line mark on top for the edge); `curve: "smooth"` matches a smooth line.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `time` |  |
| `y` | **required** | `linear`, `time` |  |
| `y2` | optional | `linear`, `time` | uses the scale of `y` unless told otherwise. Lower edge of the band. |
| `color` | optional | `color` | One area per distinct value of the field, colored by a color scale. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `baseline` | number | `0` | Where the area starts when there is no y2. Keep it inside the scale domain. |
| `group` | field |  | Field whose distinct values become separate areas. |
| `fill` | string |  | Any CSS color. Default: theme color by series index. |
| `opacity` | number | `0.85` | Fill opacity (0.45 by default with `fade`). |
| `toBottom` | boolean | `false` | Fill down to the bottom edge of the plot instead of to `baseline`: the area under a line whose axis does not start at 0 (a sparkline, a KPI trend). |
| `fade` | boolean | `false` | The fill fades from the color at the top of the plot to transparent at the bottom, and the area has no outline: the soft area under a line. |
| `curve` | one of `linear`, `smooth` | `"linear"` | Same as mark.line: "smooth" is a monotone curve through the points. |

## mark.boxplot

Version 1, 2.6 KB. A box (q1 to q3), a line across it at the median, and whiskers out to low/high — the usual shape for transform.quartiles' output. `x` is the category (a band scale, one box per category) or a plain position on a continuous one; the five value channels share the scale of `y` by default. Outliers are not drawn by this mark: transform.quartiles reports them as their own rows (only `value` set, the others NaN), meant for a plain mark.point layered on top reading the same `x` and `value`.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `band`, `linear`, `time` |  |
| `low` | **required** | `linear`, `time` | uses the scale of `y` unless told otherwise. Bottom of the lower whisker. |
| `q1` | **required** | `linear`, `time` | uses the scale of `y` unless told otherwise. Bottom of the box (25th percentile). |
| `median` | **required** | `linear`, `time` | uses the scale of `y` unless told otherwise. Line drawn across the box. |
| `q3` | **required** | `linear`, `time` | uses the scale of `y` unless told otherwise. Top of the box (75th percentile). |
| `high` | **required** | `linear`, `time` | uses the scale of `y` unless told otherwise. Top of the upper whisker. |
| `color` | optional | `color`, `sequential` | Box and whisker color per row, from a color scale; rows the scale gives no color are not drawn. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `width` | number | `0.6` | Box width: a fraction (0-1) of the category band, or, off a band scale, a fixed number of px. |
| `fill` | string |  | Box fill. Default: theme color by mark index (or the `color` channel). |
| `fillOpacity` | number | `0.85` |  |
| `strokeWidth` | number | `1.5` | Width of the box outline and the whiskers. |
| `opacity` | number | `1` |  |

## mark.line

Version 7, 4.2 KB. A line per series: one path however many points. Rows are joined in x order (unsorted data is sorted); missing values break the line. `group` splits the rows into one line per distinct value; a `color` channel does the same and colors each line from its color scale. `curve: "smooth"` draws a smooth curve that still passes through every point and never overshoots between two of them.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `time` |  |
| `y` | **required** | `linear`, `time` |  |
| `color` | optional | `color` | One line per distinct value of the field, colored by a color scale. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `group` | field |  | Field whose distinct values become separate lines (long-format data). |
| `stroke` | string |  | Any CSS color. Default: theme color by line index. |
| `strokeWidth` | number | `2` |  |
| `dash` | list |  | Dash pattern, e.g. [4, 3]. |
| `opacity` | number | `1` |  |
| `curve` | one of `linear`, `smooth` | `"linear"` | "smooth": a monotone cubic curve through the points — no peaks or dips the data does not have. "linear": straight segments. |
| `label` | one of `none`, `name`, `value`, `both` | `"none"` | A label at the end of each line, in its color: the series name, its last value, or both — so a legend is rarely needed. Labels that would overlap are moved apart. Leave room on the right (padding.right, about 70–110 px). |
| `format` | any |  | How the end label writes the last value (a preset or Intl options, as guide.axis `format`). |
| `name` | string |  | The end label of a line that is not split into series (default: the y field). |

## mark.point

Version 6, 1.4 KB. One circle per row. Channels x and y, optional color (a field on a color scale); constant params r, fill, opacity. Either channel also takes a band scale, centered in its band — a category axis plus a value axis draws a dot plot (Cleveland dot plot).

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `time`, `band` |  |
| `y` | **required** | `linear`, `time`, `band` |  |
| `color` | optional | `color`, `sequential` | Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `r` | number | `3` | Radius in px. |
| `fill` | string |  | Any CSS color. Default: theme color by mark index. |
| `opacity` | number | `1` |  |

## mark.rect

Version 8, 2.3 KB. Rectangles. On a band scale a channel spans the band; on a continuous scale it spans from `<channel>2` (or from `baseline`) to the value. bar = band + linear; range bar = x/x2. `dodge` turns a bar chart into a grouped one: it splits each band into one bar per distinct value of the field, side by side (for a stacked bar, use `color` with transform.stack instead — dodge and stack are different arrangements of the same `color`/grouping field).

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `band`, `linear`, `time` |  |
| `y` | **required** | `band`, `linear`, `time` |  |
| `x2` | optional | `linear`, `time` | uses the scale of `x` unless told otherwise. Other end of the rectangle along x. |
| `y2` | optional | `linear`, `time` | uses the scale of `y` unless told otherwise. Other end of the rectangle along y. |
| `color` | optional | `color`, `sequential` | Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn. |
| `dodge` | optional | none (a plain field) | Field that splits the band-scale axis into side-by-side bars, one per distinct value (grouped bar). Usually the same field as `color`. One distinct value (or none) draws a plain bar, unchanged. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `baseline` | number | `0` | Where bars start on a continuous axis without a second channel. Keep it inside the scale domain (scale `zero: true` for 0). |
| `fill` | string |  | Any CSS color. Default: theme color by mark index. |
| `opacity` | number | `1` |  |
| `radius` | number | `0` | Corner radius in px. |
| `thickness` | number | `1` | Share of the band a bar fills, centered (0.4 = a slim bar; a bullet chart draws the value slimmer than the ranges behind it). |
| `dodgePadding` | number | `0.1` | Gap between the bars of one dodged category, as a fraction of each bar's share of the band. |

## mark.rule

Version 1, 2.3 KB. Lines at values: a target, a threshold, an average, the target tick of a bullet chart. `y` alone draws a horizontal line across the plot at that value (`{ "value": 50000 }` for a constant, in the units of the y scale — keep it inside the scale domain); `x` alone a vertical one. On a band scale the line spans the band (`thickness` of it), so y = category and x = target gives a short tick across each bar. With x2 / y2 it runs between two values. The same line is drawn once however many rows repeat it.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | optional | `band`, `linear`, `time` |  |
| `y` | optional | `band`, `linear`, `time` |  |
| `x2` | optional | `linear`, `time` | uses the scale of `x` unless told otherwise. Other end along x. |
| `y2` | optional | `linear`, `time` | uses the scale of `y` unless told otherwise. Other end along y. |
| `color` | optional | `color` | Line color per row, from a color scale. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `stroke` | string |  | Any CSS color. Default: the theme text color. |
| `strokeWidth` | number | `2` |  |
| `dash` | list |  | Dash pattern, e.g. [4, 3]. |
| `opacity` | number | `1` |  |
| `thickness` | number | `0.7` | On a band scale, the share of the band the line spans (1 = the whole band). |
| `label` | string |  | Text at the end of the line ("Target 50K"). |

## mark.text

Version 2, 2.3 KB. A text label per row at (x, y): value labels on bars, annotations on points. The text comes from the `text` field: numbers are written with `format` (a preset such as "percent" or an object of Intl options), or rounded to `decimals`, or to 6 significant digits. On a band scale the label is centered in its band. Rows without text are skipped. To keep a label readable on a colored cell, give it `on`: the same field as the cell's color.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `time`, `band` |  |
| `y` | **required** | `linear`, `time`, `band` |  |
| `text` | **required** | none (a plain field) | Field with the text to show. |
| `color` | optional | `color`, `sequential` | Text color per row, from a color scale. |
| `on` | optional | `color`, `sequential` | uses the scale of `color` unless told otherwise. The color the text sits on (the field a heatmap cell is colored by): the text turns dark or light to stay readable. Rows with no such color get no text. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `size` | number | `11` | Font size in px. |
| `weight` | any |  | Font weight: a number (600) or a word ("bold"). |
| `anchor` | one of `start`, `middle`, `end` | `"middle"` | Horizontal alignment to the anchor point. |
| `baseline` | one of `auto`, `middle`, `hanging` | `"middle"` | "auto" puts the text above the point, "hanging" below it, "middle" centers it. |
| `dx` | number | `0` | Move right by this many px. |
| `dy` | number | `0` | Move down by this many px (negative moves up, e.g. -4 with baseline "auto" for a label above a bar). |
| `rotate` | number | `0` | Degrees around the anchor point. |
| `decimals` | number |  | Fixed number of decimals for numeric text. |
| `format` | any |  | How to write numbers (and dates): a preset ("percent", "compact", "integer", "date", ...) or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }; also "locale", "prefix", "suffix". Overrides `decimals`. |
| `fill` | string |  | Any CSS color. Default: the theme text color. |

## guide.axis

Version 6, 3.2 KB. Labels for a positional scale, with an axis line and optional tick marks. Side defaults from the scale orientation; set `position` for a second axis. `format` writes the tick labels (currency, percent, dates), `title` names the axis. The quiet default: no tick marks, a line only along a horizontal axis; pair a value axis with guide.grid. Category labels too wide for their band wrap onto two lines.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale, **required** |  |  |
| `position` | one of `top`, `right`, `bottom`, `left` |  |  |
| `title` | string |  | Text that names the axis (with its unit, for example "Revenue, USD"). Rotated on a vertical axis. |
| `format` | any |  | How to write the tick labels of a linear or time scale: a preset ("percent", "compact", "integer", "year", "month", "day", "date", "datetime") or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 } or { "month": "short", "year": "2-digit" }. Also "locale" (default "en-US"), "prefix" and "suffix". |
| `line` | one of `auto`, `on`, `off` | `"auto"` | The axis line. "auto": drawn along a horizontal axis (the baseline bars stand on), left out on a vertical one, where grid lines do the job. |
| `ticks` | boolean | `false` | Small tick marks at the labels. |

## guide.grid

Version 1, 0.4 KB. Grid lines at the ticks of a positional scale (the same ticks its axis shows). Draws behind the marks.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale, **required** |  |  |

## guide.kpi

Version 1, 2.8 KB. A key figure as the heading of a chart: a label, the value in large type, and its change against a comparison, green when it goes the good way and red when not. It takes the room it needs at the top, so a line or an area drawn in the same chart becomes the sparkline under the number. The value is one number from a field: the last row by default (`aggregate`), compared with the row before it; or compare with another field (`against`: a target, last year). A chart may consist of this guide alone (no marks) for a tile with just the number.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The numeric field the figure comes from. |
| `label` | string |  | What the figure is ("Revenue", "Active users"), above it. |
| `aggregate` | one of `last`, `first`, `sum`, `mean`, `min`, `max`, `count` | `"last"` | How the rows make one number: the last row (the latest period, in data order), the first, or the sum, mean, min, max or count of the field. |
| `compare` | one of `previous`, `first`, `none` |  | What the change is measured against: the row before the last ("previous", the default with aggregate "last"), the first row ("first": change over the period), or nothing. |
| `against` | field |  | Compare with another field instead, aggregated the same way (a target, the same period last year). |
| `delta` | one of `percent`, `absolute` | `"percent"` | The change as a percentage of the comparison, or as a difference written with `format`. |
| `better` | one of `up`, `down` | `"up"` | Which way is good: "down" for costs, churn, response times. |
| `format` | any |  | How to write the value (a preset such as "compact" or "percent", or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }). |
| `note` | string |  | A few words after the change: "vs last month", "vs target". |
| `size` | number | `30` | Font size of the value, px. |

## guide.legend

Version 5, 2.8 KB. Legend of a color scale. A categorical scale (`color`) lists every value with a swatch, and values a filter hides stay listed, dimmed. A continuous scale (`sequential`) draws a color bar with a few labels. On the right or left it is a column, on top or bottom a row that wraps onto more lines when it is wider than the plot. Takes space on its side like an axis, so list it after an axis on the same side to sit outside it.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale, **required** |  | A color or sequential scale. |
| `position` | one of `top`, `right`, `bottom`, `left` | `"right"` |  |
| `format` | any |  | How to write the labels of a color bar (a `sequential` scale): a preset ("percent", "compact", ...) or an object of Intl options; see guide.axis `format`. |

## interaction.animate

Version 1, 2.2 KB. Plays the chart in once, when it is first drawn: bars grow from their baseline, lines and areas are drawn from left to right, a pie opens from its center, anything else fades in. Never again on zoom, filter or update of the view, and not at all for readers who ask their system for reduced motion. Uses the browser's own animation of the SVG layer (no timer loop); on a canvas chart it fades the canvas in.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `effect` | one of `auto`, `grow`, `wipe`, `pop`, `fade` | `"auto"` | "auto" picks by the marks: grow for bars, wipe for lines and areas, pop for a pie, fade otherwise. |
| `duration` | number | `700` | Milliseconds. |
| `delay` | number | `0` | Milliseconds before it starts (stagger the cards of a dashboard). |

## interaction.brush

Version 2, 3.9 KB. Drag a rectangle over the plot to zoom to it: on the scales in `scales` (default x) the view becomes the selected range, on a category (band) scale the categories under the selection. Shift + drag by default, so it does not fight with the pan of interaction.zoom; Escape cancels while dragging, double-click resets. A drag shorter than `minSize` px is not a selection.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scales` | list | `["x"]` | Names of the scales to zoom. One horizontal scale selects a vertical band, one vertical scale a horizontal band, both a box. |
| `modifier` | one of `shift`, `alt`, `ctrl`, `none` | `"shift"` | Key that must be held to start a selection. "none" conflicts with the pan of interaction.zoom (turn its `pan` off). |
| `fit` | list |  | Scales to refit to the selected window (usually ["y"]). |
| `minSize` | number | `6` | Smallest selection, in px, along each selected axis. |

## interaction.crosshair

Version 1, 2.4 KB. A vertical line across the plot that follows the pointer, so the reader can read a date off several series at once. It snaps to the nearest datum of a line or area (or of every mark, with `snap: "all"`); `snap: "off"` follows the pointer freely. Works with or without the tooltip.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `snap` | one of `lines`, `all`, `off` | `"lines"` | What the line jumps to: the nearest point of a line or area ("lines"), of any mark ("all"), or nothing (it follows the pointer). |
| `horizontal` | boolean | `false` | Also a horizontal line through the datum. |

## interaction.legend-filter

Version 1, 1.9 KB. Click an item of a categorical legend to hide or show that category; double-click isolates it (double-click again shows everything). Hidden categories are drawn by no mark and stay in the legend, dimmed. The visible set is the view of the color scale, so it can also be set with setView. Hiding everything shows everything.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale |  | The color scale to filter. Default: the scale of the first legend. |
| `fit` | list |  | Scales to refit to the visible rows after a change (usually ["y"]); by default they keep their domain. |

## interaction.tooltip

Version 6, 7.5 KB. Shows the datum under the pointer: a marker plus a card with the fields behind it — the category or date as its heading, then one line per value. Every mark finds its own datum (MarkDef.pick); the closest one wins. The default content is written with textContent only; `content` replaces it with what a function returns. For a vertical line that follows the pointer, add interaction.crosshair.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `fields` | list |  | Fields to show. Default: the fields the mark reads (its channels and group). |
| `formats` | any |  | How to write values, per field: { "revenue": { "style": "currency", "currency": "USD" }, "share": "percent", "date": "date" }. Each is a preset or an object of Intl options (see guide.axis `format`). Fields without one are written as they are (numbers to 6 significant digits). |
| `content` | any |  | Name of a function registered with BC.defineFn (or, in a spec built in JS, the function itself). It gets a TooltipDatum and returns what to show: a string (text), { html }, a DOM Node, an array of those, null/false to hide the tooltip, or undefined for the default content. { html } is set with innerHTML and is not escaped — build it from trusted strings, never straight from a row value the data may contain. |
| `marker` | one of `auto`, `dot`, `box`, `none` | `"auto"` | "dot" draws a small circle at the point; "box" highlights the whole shape (used automatically for rect marks like bar/heatmap, where a dot would land on an edge); "auto" picks box when the mark reports its bounds and dot otherwise; "none" shows the tooltip text without a marker. |

## interaction.zoom

Version 2, 2.8 KB. Wheel zoom around the cursor, drag to pan, double-click to reset. Works on continuous scales (linear, time) by changing their view through setView; the layout stays frozen.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scales` | list | `["x"]` | Names of the scales to control. |
| `wheel` | one of `ctrl`, `always`, `off` | `"ctrl"` | "ctrl": Ctrl/Cmd + wheel (and trackpad pinch) zooms, so the page still scrolls; "always": plain wheel zooms. |
| `fit` | list |  | Scales to auto-fit to the zoomed window (usually ["y"]): their domain is recomputed from the rows that are visible. |
| `pan` | boolean | `true` |  |
| `maxZoom` | number | `50` | How far in you can go, as a multiple of the full domain. |

## interaction.zoom-controls

Version 1, 2.4 KB. A small button bar over one corner of the chart: "100%" clears the controlled scales back to their full domain; "−"/"+" step a continuous one in and out around the center of its current view. A band scale only gets "100%" (there is nothing continuous to step).

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scales` | list | `["x"]` | Names of the scales to control, the same as interaction.zoom and interaction.brush. Default ["x"] — set it to match whichever scales those use, so "100%" undoes everything they did. |
| `fit` | list |  | Scales to refit after a "−"/"+" click (usually ["y"]), the same as interaction.zoom's `fit`. |
| `step` | number | `0.5` | How much "−"/"+" grow or shrink a continuous scale's span, as a factor of the current span (0.5 = double/halve). |
| `maxZoom` | number | `50` | How far "+" can go, as a multiple of the full domain. |
| `corner` | one of `top-right`, `top-left`, `bottom-right`, `bottom-left` | `"top-right"` | Which corner of the chart the buttons sit in. |

## renderer.canvas

Version 2, 5.9 KB. Draws a display list on one <canvas>, scaled to its container and sharp on high-density screens. Meant for charts with tens of thousands of marks (a big scatter plot), where an SVG element per mark gets slow: about 5 times faster to redraw at 50,000 points. A single long line is one path either way, so it gains little; decimate it instead. It reads the same CSS variables as the SVG renderer (themes, dark mode) and follows changes of the color scheme, but a canvas has no elements: CSS classes and native tooltips on marks do not exist here. Zoom, brush, tooltip and legend filter work as usual, and so do fading fills.

## renderer.svg

Version 4, 3.2 KB. Draws a display list as one <svg> scaled to its container via viewBox. Paths have no implicit fill: marks set `fill: "none"` for strokes. A style with `fade` gets a vertical gradient over the plot, from the fill color to transparent.
