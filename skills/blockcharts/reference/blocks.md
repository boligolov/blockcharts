# Block reference

Generated from the code by `scripts/build-skill.js`; do not edit. A chart spec refers to a block by its `type`: `{"type": "rect"}` is `mark.rect`.

- **scale**: maps data to positions or colors. Declared once per chart under `scales`, by name.
- **transform**: prepares the dataset before anything is drawn (`transforms`).
- **mark**: draws the data (`marks`). Its channels (`x`, `y`, `color`, ...) name the fields to read.
- **guide**: axes, grid, legend (`guides`), attached to a scale.
- **interaction**: zoom, tooltip (`interaction`).
- **renderer**: draws the picture; `svg` is the default and needs no mention.

58 blocks: `lib.columns`, `lib.curve`, `lib.pointer`, `lib.stats`, `lib.ticks`, `lib.view`, `scale.band`, `scale.color`, `scale.linear`, `scale.log`, `scale.sequential`, `scale.size`, `scale.time`, `transform.aggregate`, `transform.bin`, `transform.calculate`, `transform.calendar`, `transform.contour`, `transform.decimate`, `transform.density`, `transform.filter`, `transform.fold`, `transform.funnel`, `transform.hexbin`, `transform.highlight`, `transform.marimekko`, `transform.quartiles`, `transform.sankey`, `transform.sort`, `transform.stack`, `transform.treemap`, `transform.waterfall`, `transform.window`, `mark.arc`, `mark.area`, `mark.boxplot`, `mark.candlestick`, `mark.line`, `mark.point`, `mark.polygon`, `mark.rect`, `mark.rule`, `mark.sankey`, `mark.text`, `mark.violin`, `guide.axis`, `guide.grid`, `guide.kpi`, `guide.legend`, `interaction.animate`, `interaction.brush`, `interaction.crosshair`, `interaction.legend-filter`, `interaction.tooltip`, `interaction.zoom`, `interaction.zoom-controls`, `renderer.canvas`, `renderer.svg`.

## Keys every spec has

| Where | Key | Meaning |
| --- | --- | --- |
| chart | `data` | name of a dataset in the page data (required) |
| chart | `size` | `[width, height]` of the drawing, default `[640, 400]`; the chart scales to its container |
| chart | `title` | text above the plot |
| chart | `padding` | `{top, right, bottom, left}` in drawing units, default 16 each |
| chart | `transforms`, `scales`, `guides`, `marks`, `interaction` | lists of blocks (`scales` is an object of named scales) |
| chart | `view` | starting zoom: `{"x": [from, to]}` (dates as ISO strings or milliseconds) |
| scale | `type` | the scale block: `band`, `color`, `linear`, `log`, `sequential`, `size`, `time` |
| scale | `domain` | fixed domain instead of the inferred one: `[min, max]` for linear and time, a list of values for band and color |
| scale | `range` | `"width"` or `"height"` (the default of `x` and `y`), or an explicit list, e.g. colors for a color scale |
| scale | `field` | an extra field to include when inferring the domain |
| guide | `scale` | name of the scale the guide belongs to |
| guide | `position` | `top`, `right`, `bottom` or `left`; the default follows the scale (height: left, width: bottom) |
| mark | channels | `"field"`, `{"field": "f", "scale": "s"}` or `{"value": v}`; see each mark |

## lib.columns

Version 1, 0.5 KB. The check of the columns a transform reads and writes, shared by transform.contour, transform.funnel, transform.hexbin, transform.sankey, transform.treemap and transform.waterfall. `check(block, table, reads, writes, keep)` throws when a field it reads is not in the data, or when a column it writes would replace one of the data's own (other than those in `keep`) or another new one, naming the parameter to change. A spec never names it.

## lib.curve

Version 2, 1.2 KB. The path of a line through points, shared by mark.line and mark.area: straight segments, a monotone cubic that passes through every point and never overshoots between two of them, or steps (each value holds until the next point). `through(px, py, curve, back)` returns the path commands after the first point for curve "linear", "smooth" or "step"; `back` walks the points from the last to the first. A spec never names it.

## lib.pointer

Version 1, 1.4 KB. The pointer over a chart, shared by the tooltip, the crosshair, zoom and brush. `toLogical(live, event)` turns the position of a mouse or pointer event into the units of the chart, however the page scales it, and `inPlot(live, point)` tells whether such a point is on the plot. `follow(live, show, hide, keepOnPress)` calls `show(event)` at most once a frame while the pointer is over the chart, and `hide()` when it leaves, drags, scrolls or a finger touches outside the chart; on a touch screen a tap is the hover and stays after the finger lifts. A spec never names it.

## lib.stats

Version 1, 0.4 KB. Statistics shared by transform.density and transform.contour. `spread(sorted)` is the spread of sorted numbers that the width of a smoothing kernel is made from: the standard deviation, or the interquartile range / 1.34 when that is smaller, and 0 for numbers all alike. A spec never names it.

## lib.ticks

Version 1, 0.6 KB. Round numbers, shared by scale.linear, scale.sequential, scale.size and transform.bin. `niceStep(span, count)` is a step of 1, 2 or 5 × 10^n that cuts `span` into about `count` parts; `roundTicks(d0, d1, count)` lists its multiples between the two ends of a domain as { value, label }, smallest first, and none for a domain with no length or not made of numbers. A spec never names it.

## lib.view

Version 1, 0.8 KB. The arithmetic of zooming a continuous scale, shared by interaction.zoom and interaction.zoom-controls. It runs on numbers that are even on the screen (the logarithms on a log scale; a domain that runs backwards is negated): `current(live, name)` is the view now, `show(live, name, d0, d1)` sets one, shifted back inside the full domain, and `zoom(live, name, factor, maxZoom, anchor)` widens or narrows it around a point. A spec never names it.

## scale.band

Version 4, 1.2 KB. Categorical scale: one band per distinct value, in first-seen order. Maps a value to the band's lower edge; `bandwidth` is the band width. Bands always run in increasing pixel order (left to right, top to bottom), also on a vertical axis, so horizontal bars list their categories from the top. Zoom = a window of categories.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `paddingInner` | number | `0.2` | Gap between bands, as a fraction of the step. |
| `paddingOuter` | number | `0.1` | Gap before the first and after the last band, as a fraction of the step. |

## scale.color

Version 3, 0.8 KB. Categorical color scale: one color per distinct value, in first-seen order. Colors come from `range` (a list of CSS colors) or from the theme palette (--bc-c0 …). Colors stay tied to the value when the domain is narrowed (setView, a legend filter); a value outside the visible domain gets no color, so marks do not draw it.

## scale.linear

Version 6, 1.5 KB. Continuous numeric scale. Domain is inferred from bound channels, padded, and extended to nice tick values. An explicit `domain` is two different numbers; [high, low] runs the axis the other way.

Needs: `lib.ticks`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `nice` | boolean | `true` | Extend the inferred domain to round tick values. |
| `zero` | boolean | `false` | Include 0 in the inferred domain (bars need it). |
| `padding` | number | `0` | Extra room around the data extent, as a fraction of its span (0.05 keeps edge points off the axes). |

## scale.log

Version 3, 1.8 KB. Logarithmic numeric scale (base 10): equal steps for equal ratios, so 10 → 100 is as long as 100 → 1,000. For values that span several orders of magnitude (company sizes, populations) or growth compared as rates. Only positive values have a place on it: zero, negatives and missing values are left out (a line breaks there), and the domain is inferred from the positive ones. `nice` extends it to whole powers of ten, or to 1, 2 or 5 of a power when the data spans less than two of them. Ticks are the powers of ten, with 2 and 5 between them when the domain spans few of them; their labels are compact (1K, 10K, 1M) unless the axis has a `format`. Bars on a log scale start at the bottom of the domain.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `nice` | boolean | `true` | Extend the inferred domain to round values. |

## scale.sequential

Version 5, 2.0 KB. Continuous color scale: numbers map to colors along `range` (two or more #hex colors, mixed piecewise-linearly; default viridis). Values outside an explicit `domain` take the end colors; a missing or non-numeric value has no color, and marks do not draw such rows. Use it for heatmaps and for coloring points or bars by a number; for a diverging scale give three colors and a symmetric `domain`. `exponent` spreads the colors over the small values, for counts where a few cells hold most of them.

Needs: `lib.ticks`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `exponent` | number | `1` | Colors by the value raised to this power (keeping its sign, so a symmetric domain stays symmetric). 0.5, a square root, gives the small values more of the colors: the cells of a hexbin or a 2D histogram, where a few cells hold most of the points. The legend keeps its labels where the values are, so most of its colors gather at the small end. |

## scale.size

Version 4, 1.4 KB. Numbers to circle radii, so that the area of a circle (not its radius) grows with the value: a bubble chart reads true. `range` is [smallest, largest] radius in px (default [2, 24]). The domain starts at 0 unless `zero` is false, so a value twice as big is a circle twice the area. Missing, non-numeric and negative values have no size, and marks do not draw such rows. Pair with mark.point `size` and a guide.legend on the same scale.

Needs: `lib.ticks`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `zero` | boolean | `true` | Start the domain at 0, so areas are proportional to the values. false: the smallest value gets the smallest radius (shows differences, overstates ratios). |

## scale.time

Version 6, 2.7 KB. Time scale in UTC. Values: epoch milliseconds, ISO date strings or Dates; a date or time without an offset ("2024-03-01", "2024-03-01T09:00", "2024-03-01 09:00") is UTC, so every reader sees the same hours. Ticks snap to calendar units (seconds … years), and months are written in the language of the chart. Numbers beyond the range of dates (nanoseconds, say) are not times: when none of the numbers is one, the chart reports it.

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

Version 4, 3.0 KB. Counts the values of `field` in equal-width bins with round edges and returns one row per bin: its start, its end and the count (`as`, default bin0 / bin1 / count). With `log` the bins are equal on a log scale (each edge a fixed ratio of the one before) and only positive values count. Empty bins are kept, so a histogram has no gaps. Bins are [start, end) except the last, which includes its end. With `group` there is a row per bin and group, for stacking or side-by-side comparison. Draw it as a rect with x = start, x2 = end and y = count.

Needs: `lib.ticks`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to count. Missing and non-numeric values are ignored. |
| `bins` | number | `10` | Approximate number of bins; the width is rounded to 1, 2, 5 × 10^n. |
| `width` | number |  | Exact bin width; overrides `bins`. |
| `log` | boolean | `false` | Bins of equal ratio, for x on a log scale. `width` is then in powers of ten (1 = one bin per decade); `bins` is rounded the same way. |
| `extent` | list |  | [min, max] to bin; values outside are ignored. Default: the range of the data. |
| `group` | field |  | Count separately for every value of this field. |
| `as` | list |  | Names of the three new columns: [start, end, count]. |

## transform.calculate

Version 1, 1.4 KB. A new column `as` from two numbers of each row: field `a` and field `b` (or a constant `value`), joined by `op` (+, -, *, /). A margin is profit / revenue; a gap is actual - plan; a price with tax is net * 1.2. A row where either side is not a number, or the division is by zero, gets NaN (drawn as missing). Rows and the other columns stay as they are; the new column can be used by any transform after it. `as` may be `a` or `b` itself to replace that column (revenue / 1000 in thousands); any other existing column is an error.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `a` | field, **required** |  | Numeric field on the left. |
| `op` | one of `+`, `-`, `*`, `/`, **required** |  | + \| - \| * \| /. |
| `b` | field |  | Numeric field on the right; or give `value`. |
| `value` | number |  | A constant on the right instead of a field. |
| `as` | string, **required** |  | Name of the new column. |

## transform.calendar

Version 2, 1.7 KB. The columns of a calendar heatmap, one cell per row: `week` and `weekEnd` (where its week starts and ends, for `x` and `x2` of a rect on a time scale) and `day` (the name of the weekday, for `y` on a band scale). Rows are put in weekday order, so the band scale lists the days in the order of a week; a weekday with no rows gets one empty row, with no `week` to be drawn at, so that it keeps its place on the axis. Rows without a date are left out. A day that occurs twice gives two cells on one spot: aggregate first.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The date of each row. |
| `weekStart` | one of `monday`, `sunday` | `"monday"` | The first day of a week. |
| `as` | list |  | Names of the three new columns. Default [week, weekEnd, day]. |

## transform.contour

Version 1, 5.4 KB. Density contours, for a scatter of too many points to read: where the points of two measures gather, as regions nested like the rings of a map. It smooths the points into a density (a kernel density estimate in two dimensions) and draws the outline of where it is at least each of a few levels. A row of the result is a point of an outline, under the names of `x` and `y`, in order; `ring` names its outline and `level` the region it bounds, 1 the outermost; `share` is how many of the points lie inside that region (0 to 1) and `density` the level itself. Draw it with mark.polygon (`group: "level"`, `ring: "ring"`), colored by `share` or `level` on a sequential scale; outlines of holes run the other way, so a region with a hole in it is drawn with the hole. Rows where x or y is not a number are left out.

Needs: `lib.columns`, `lib.stats`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `x` | field, **required** |  | Numeric field along x. |
| `y` | field, **required** |  | Numeric field along y. |
| `shares` | list |  | Regions by how many of the points they hold: [0.25, 0.5, 0.75, 0.95] draws the smallest region with a quarter of the points, then with half, and so on (each number above 0 and below 1). Without it, `levels` regions at even steps of the density. |
| `levels` | number | `6` | How many regions, at even steps of the density up to its peak, when there are no `shares` (1 to 50). |
| `bandwidth` | list |  | How smooth the density is: [along x, along y], in the units of each field, the width of the bump each point adds. Default: Scott's rule on each axis; null keeps it on one axis. Smaller shows more detail and more noise. |
| `extent` | list |  | Where the regions are cut, [[x low, x high], [y low, y high]], each end a number or null for none: [[0, null], [0, null]] for distances and times, which cannot be negative, so no region runs below 0. A point outside it is outside every region. |
| `grid` | number | `80` | Cells of the grid the density is worked out on, along each axis (8 to 400). More draws smoother outlines. |

## transform.decimate

Version 3, 3.4 KB. Level of detail for long lines: keeps only the rows that can change how a line looks. Redone at every zoom. Inside the visible window it splits x into pixel columns and keeps the first, last, lowest and highest row of each, so the envelope of the data is exact; outside the window (beyond a small margin) it drops the rows. Windows that hold few rows are left whole. Needs data sorted by x (per `group`); anything else is passed through unchanged. Put it after transforms that create the rows and before the line mark reads them.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `x` | field, **required** |  | The x field of the line. |
| `y` | field, **required** |  | The y field of the line. |
| `scale` | scale | `"x"` | Name of the x scale. |
| `group` | field |  | Decimate every series (value of this field) on its own. |
| `buckets` | number |  | Pixel columns to split the plot width into. Default: one per px of plot width. |
| `threshold` | number | `4` | Decimate only when the window holds more than `threshold` rows per column. |

## transform.density

Version 2, 2.6 KB. How the raw values of `field` are spread, as a smooth curve (a kernel density estimate): for every group, `steps` evenly spaced rows from a little below its smallest value to a little above its largest, each with the `value` and the `density` there. Draw it with mark.violin (violin plots, ridgelines), or with mark.area / mark.line on x = value, y = density. The curve of each group encloses an area of 1 (with `counts`, its number of samples, so bigger groups are bigger). Replaces the rows: the output has the group field, value, density and `count`, the number of samples of the group.

Needs: `lib.stats`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field with the raw samples. Missing and non-numeric values are ignored. |
| `group` | field |  | A curve per value of this field (the category of a violin or a ridge). A missing value is a group of its own. Default: one curve. |
| `bandwidth` | number |  | How smooth the curve is, in the units of the field: the width of the bump each sample adds. Default: Silverman's rule, per group. Smaller shows more detail and more noise. |
| `steps` | number | `80` | Rows per curve (2 to 1000). |
| `extent` | list |  | The range [low, high] the curves are cut to: [0, null] for values that cannot be negative (times, prices), so a curve does not run below 0. null leaves that end to the data. |
| `counts` | boolean | `false` | Multiply each curve by its number of samples, so a group of 500 is ten times a group of 50. |
| `as` | list |  | Names of the two new columns: [value, density]. |

## transform.filter

Version 2, 2.3 KB. Keeps the rows whose `field` passes a test and drops the others: `==`, `!=`, `<`, `<=`, `>`, `>=` against `value` (a number, a string, or a date as "2024-03-01"), `in` / `notIn` a list of values, `valid` (the field has a value). Numbers compare with numbers, dates with dates (a Date or an ISO date string), text with text; a missing value never passes. Several filters in a row all apply. Rows keep their order; columns stay as they are.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Field to test. |
| `op` | one of `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `notIn`, `valid` | `"=="` | == \| != \| < \| <= \| > \| >= \| in \| notIn \| valid. |
| `value` | any |  | What to compare with; a list for in / notIn; none for valid. |

## transform.fold

Version 1, 1.5 KB. Turns a wide table (one column per series: month, online, retail) into a long one (month, key, value): every row becomes one row per field of `fields`, with the field's name in `key` and its value in `value`, so the series can be colored, stacked or grouped by `key`. The other columns are repeated on each new row; the folded columns stay too. Rows keep their order, and the fields theirs within each row.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `fields` | list, **required** |  | Columns to fold into rows, in the order of the series. |
| `key` | string | `"key"` | Name of the new column with the folded field's name. |
| `value` | string | `"value"` | Name of the new column with its value. |

## transform.funnel

Version 3, 1.2 KB. A conversion funnel: stages in row order (visits, sign-ups, trials, purchases), each drawn as a bar centered on zero so the shape narrows. Writes the bar's two ends (`<field>0` = -value/2, `<field>1` = +value/2), the share of the first stage (`rate`) and of the stage before (`stepRate`). Draw with mark.rect (x = `<field>0`, x2 = `<field>1`, y = the stage on a band scale) and label with mark.text formatted as percent.

Needs: `lib.columns`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | How many reached the stage. |
| `as` | list |  | Names of the two end columns. Default [<field>0, <field>1]. |
| `rateAs` | string | `"rate"` | Name of the column with the share of the first stage (0..1). |
| `stepAs` | string | `"stepRate"` | Name of the column with the share of the previous stage (0..1; the first stage has none). |

## transform.hexbin

Version 1, 3.2 KB. Hexagonal binning, for a scatter of too many points to read: the plane is tiled with hexagons and each row of the result is one hexagon that has points in it, with how many (`count`). It writes the box of each hexagon (x0, x1, y0, y1), for a mark.rect with `shape: "hexagon"` on two linear scales with `nice: false`, x: x0, x2: x1, y: y0, y2: y1, colored by `count` on a sequential scale; and its center under the names of `x` and `y`, for the tooltip. The hexagons are binned anew for the size the chart is drawn at, and at every zoom, so they stay regular on a phone as on a wide screen; each covers the same area of the data whatever its shape, so a count, and the color legend, mean the same at every size. The scales take their domains from a first binning for a plot 1.6 times as wide as tall, so on a plot of another shape the outer hexagons may stand a little over its edge. Rows where x or y is not a number are left out.

Needs: `lib.columns`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `x` | field, **required** |  | Numeric field along x. |
| `y` | field, **required** |  | Numeric field along y. |
| `bins` | number | `20` | How many hexagons fit across the width of the data on a plot 1.6 times as wide as tall. On a narrower plot fewer fit across, as large in the data, so they stay as large on the screen. |
| `aspect` | number |  | Width / height of the plot, to bin once for that shape instead of following the plot: the scales then keep exactly to the hexagons, but at another size the hexagons come out stretched. The plot is the chart less its axes and legend: a 640 × 400 chart with axes on the left and bottom has a plot of about 560 × 320 (1.75). |
| `xScale` | scale | `"x"` | Name of the x scale the hexagons are drawn on: they are binned for its size. |
| `yScale` | scale | `"y"` | Name of the y scale the hexagons are drawn on. |
| `as` | list |  | Names of the four columns of the box. Default [x0, x1, y0, y1]. |
| `countAs` | string | `"count"` | Name of the column with the number of points. |

## transform.highlight

Version 1, 1.4 KB. Marks the rows to set apart in a new column `as`: "yes" there and "no" elsewhere (or your own words, `yes` and `no`). Choose them by `pick` (the max or min of `field`, its first or last usable row; ties are all marked) or by `value` (the rows of `field` equal to it). Give the column to a color channel with a scale of two colors, and the best month stands out from the bars around it.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The field the rows are chosen by. |
| `pick` | one of `max`, `min`, `first`, `last` |  | Which rows: the largest or smallest number, the first or last row that has one. Or give `value`. |
| `value` | any |  | The rows of `field` equal to this, text or a number, instead of `pick`. |
| `as` | string | `"highlight"` | Name of the new column. |
| `yes` | string | `"yes"` | What a marked row holds; it is what a legend would show. |
| `no` | string | `"no"` | What the other rows hold. |

## transform.marimekko

Version 2, 2.0 KB. A Marimekko (mosaic) chart: one column per `category`, as wide as its share of the whole; within it each row takes a height in proportion to `field`. It writes the corners (x0, x1, y0, y1) in 0..1 for a rect on two linear scales with the domain [0, 1], `share` (the part of its column a row takes, 0..1), and `label` (the name of the category on the tallest cell of its column, the one with room for it, for a mark.text). Columns and cells keep the order of the data. Rows without a positive value are left out.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The size of each cell (positive numbers; others are left out). |
| `category` | field, **required** |  | The field that makes the columns. |
| `gap` | number | `0.003` | Space between the columns, as a share of the width. |
| `as` | list |  | Names of the four corner columns. Default [x0, x1, y0, y1]. |
| `shareAs` | string | `"share"` | Name of the share column. |
| `labelAs` | string | `"label"` | Name of the label column. |

## transform.quartiles

Version 2, 2.1 KB. The five-number summary of `field` (min/max here mean the Tukey whiskers, not the raw extremes): one row of low/q1/median/q3/high/count per distinct value of `group` (default: one row for the whole dataset). With `outliers` (default true), a sample further than 1.5x the IQR from the box is left out of the whiskers and reported as its own row instead, with `value` set and the summary fields NaN — draw the box from a rect (q1 to q3) or mark.boxplot, and the outliers from a plain mark.point reading `value`, both keyed on the same `group` field; the two kinds of row tell themselves apart by which fields are NaN, the same way a hidden category already tells a mark not to draw a row. A tooltip shows each kind of row only the fields it has.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to summarize (the raw sample values). Missing and non-numeric values are ignored. |
| `group` | field |  | A separate summary per value of this field (the boxplot's category axis). A missing value is a group of its own, like transform.aggregate. Default: one summary. |
| `outliers` | boolean | `true` | true: whiskers stop at 1.5x IQR, points further out become their own "value" row. false: whiskers stretch to the true min/max, no outlier rows. |

## transform.sankey

Version 1, 3.5 KB. The layout of a Sankey diagram, for mark.sankey: one row per flow, from `source` to `target`, its thickness in proportion to `value`. Columns come from the flows themselves: a node goes to the right of everything that flows into it, and a node nothing leaves to the last column; the nodes of a column are ordered so that ribbons cross as little as they can, and every value is the same height in every column. It keeps the rows and writes on each flow where its ribbon runs, in shares of the plot: `x0` and `x1`, the columns it leaves and reaches (0 the first, 1 the last); `y0` and `y1`, the top of the ribbon at either end (0 the top of the plot, 1 its bottom); and `thickness`. A row with no positive value or no name, or a flow from a node to itself, gets none. Flows have to run one way: a loop is an error that names it.

Needs: `lib.columns`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `source` | field, **required** |  | Field with the name of the node a flow leaves. |
| `target` | field, **required** |  | Field with the name of the node a flow arrives at. |
| `value` | field, **required** |  | Numeric field: the size of the flow. |
| `nodeGap` | number | `0.03` | Space between the nodes of a column, as a share of the height of the plot; it shrinks when a column is full, so the gaps take at most half of it. |
| `as` | list |  | Names of the five new columns: [x0, x1, y0, y1, thickness]. |

## transform.sort

Version 1, 1.7 KB. Puts the rows in the order of `field` (`order` "asc" or "desc"), and with `limit` keeps only the first N: the top 10 products is `field` revenue, `order` "desc", `limit` 10. With `group` the order and the limit apply within each group (the top 3 per region), and the groups follow each other in order of first appearance. A band scale lists its categories in row order, so this also orders the bars. Missing values go last either way; numbers come before text when a field mixes them; ties keep data order. Columns stay as they are.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Field to sort by. |
| `order` | one of `asc`, `desc` | `"asc"` | Direction. |
| `limit` | number |  | Keep only the first N rows (of each group with `group`). |
| `group` | field |  | Field that splits the rows: each group sorted and limited on its own. |

## transform.stack

Version 3, 1.8 KB. Stacks the values of `field` on top of each other within every value of `by` (the category axis). Adds two columns, the start and the end of each row's segment (`as`, default `<field>0` and `<field>1`). Series are stacked in order of first appearance of `group`; negatives stack downward from 0 separately from positives; missing values contribute nothing and get NaN. Use the columns as y2 and y of a rect or area. `center` puts the middle of every stack on 0, so the layers flow around a center line: a streamgraph (draw it with mark.area, y = end, y2 = start, curve smooth, and no y axis, since only the thickness of a layer means anything). With `follows` the stack is rebuilt when a legend filter hides a series, so the rest close up and a 100% stack adds up to 100% again.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to stack. |
| `by` | field, **required** |  | Field whose values are the stacks (the x of a stacked bar). |
| `group` | field |  | Field that tells the series apart. Without it rows stack in data order. |
| `as` | list |  | Names of the two new columns: [start, end]. |
| `normalize` | boolean | `false` | Scale every stack to 0..1 (100% stacked). |
| `center` | boolean | `false` | Put the middle of every stack on 0 (a streamgraph). With normalize the stacks run from -0.5 to 0.5. |
| `follows` | scale |  | The color scale of `group`: series it does not show (a legend filter hid them) are left out of the stack. Without it they leave a gap, and a 100% stack keeps counting them. |

## transform.treemap

Version 4, 3.2 KB. A treemap: each row becomes a rectangle whose area is its `field`, laid out as near-square cells (squarified), largest at the top left. With `group`, rows are first gathered into one block per group (an area per region, then per product inside it), and with `subgroup` each block is divided once more (region, country, product). Writes the corners in 0..1 (`x0`, `x1`, `y0`, `y1`, y up) and a `label` for the cells big enough to hold one. Draw with mark.rect (x = x0, x2 = x1, y = y1, y2 = y0) on two linear scales with domain [0, 1] and no axes; color by the group; label with mark.text at (x0, y1). Set `aspect` to the width / height of the plot so the cells come out square.

Needs: `lib.columns`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The size of each cell (positive numbers; others are left out). |
| `group` | field |  | Field that gathers cells into blocks, one per distinct value. |
| `subgroup` | field |  | Field that gathers the cells of a block into smaller blocks: a third level. Needs `group`. |
| `name` | field |  | Field with each cell's name, copied to `label` for cells that are big enough. |
| `aspect` | number | `1.6` | Width / height of the plot the treemap fills (for a 640 × 400 chart with no axes, about 1.6). |
| `padding` | number | `0.004` | Space between cells, as a share of the plot height. |
| `labelMin` | number | `0.02` | Cells smaller than this share of the whole get no label (so small ones stay clean). |
| `as` | list |  | Names of the four corner columns. Default [x0, x1, y0, y1]. |
| `labelAs` | string | `"label"` | Name of the label column. |

## transform.waterfall

Version 3, 1.7 KB. A waterfall (bridge) chart: how a starting value becomes an ending one through gains and losses. In row order, each row adds its `field` to a running total; the transform writes where each bar starts and ends (`<field>0`, `<field>1`), its kind (`step`: "increase", "decrease" or "total"), what it stands for (`amount`: the change, or the total) and its upper end (`top`, for a label above it). Rows marked by the `total` field are subtotals: their bar goes from 0 to the running total, and their own value is ignored. Draw with mark.rect (y = `<field>1`, y2 = `<field>0` on a band x), colored by `step` through a color scale.

Needs: `lib.columns`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The change each row makes (negative for a loss). |
| `total` | field |  | Field that marks subtotal rows (true, 1, "yes" or "total"): their bar shows the running total so far. |
| `start` | number | `0` | Where the running total begins. |
| `as` | list |  | Names of the start and end columns. Default [<field>0, <field>1]. |
| `kindAs` | string | `"step"` | Name of the column that says "increase", "decrease" or "total". |
| `amountAs` | string | `"amount"` | Name of the column with what each bar stands for: the change of a step, the running total of a subtotal. Label bars with it. |
| `topAs` | string | `"top"` | Name of the column with the upper end of each bar, where a label above it goes. |

## transform.window

Version 3, 3.7 KB. A value per row computed from the rows before it (and around it) in the same series: `cumsum` a running total; `sum`, `mean`, `min`, `max` over a moving window of `size` rows (a 7-day moving average is `mean` with size 7 on daily rows); `diff` and `pctChange` the change from the previous row (pctChange is a fraction: 0.1 = +10%); `total` the sum of the whole group on every row of it (a line of totals over stacked bars) and `share` each row as a part of that sum (0.25 = 25%), so rows are not collapsed as by aggregate; `rank` the place of each row in its group by `field`, 1 for the largest (`order` "asc": for the smallest), ties sharing a place (1, 2, 2, 4): rank by year with group = the year, and a line per item over the years is a bump chart. Rows are taken in the order of `sort` (a date or number field; data order without it), separately for every value of `group`. Adds one column (`as`, default "<op>_<field>") and keeps every row in place. Missing values are skipped by the running total and the window and get NaN themselves; a window that does not have `size` rows yet (the start of a series) is NaN unless `partial` is true.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | Numeric field to compute from. |
| `op` | one of `cumsum`, `sum`, `mean`, `min`, `max`, `diff`, `pctChange`, `total`, `share`, `rank`, **required** |  | cumsum \| sum \| mean \| min \| max \| diff \| pctChange \| total \| share \| rank. total, share and rank look at the whole group, so they need no sort; a row with no value still gets the total, and no rank. |
| `order` | one of `desc`, `asc` | `"desc"` | For rank: "desc" gives place 1 to the largest value (sales), "asc" to the smallest (a time, a cost). |
| `size` | number |  | Rows in the window of sum, mean, min, max (required for them). |
| `align` | one of `trailing`, `center` | `"trailing"` | "trailing": the row and the size - 1 rows before it. "center": the row in the middle of its window. |
| `partial` | boolean | `false` | Compute windows cut short by the start or end of a series from the rows they have. |
| `sort` | field |  | Field that orders the rows (the x of the chart). Rows without it get NaN. |
| `group` | field |  | Field that splits the rows into series, each computed on its own; a missing value is a series of its own. |
| `as` | string |  | Name of the new column. |

## mark.arc

Version 3, 4.8 KB. Pie and donut chart: one slice per row, its angle proportional to `value`. Needs no x/y scales (declare only a color scale for the colors); the pie fills the plot area. Rows whose value is not a positive number are left out. Slices are laid out clockwise from 12 o'clock. A gauge or a progress ring is the same mark: `startAngle` -90 and `endAngle` 90 make a half circle, `total` the maximum (the rest of the arc is an empty track), `center` writes the figure in the middle.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `value` | **required** | none (a plain field) | Numeric field: the size of each slice. |
| `color` | optional | `color`, `sequential` | Slice color per row from a color scale; a hidden category leaves its slice out. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `innerRadius` | number | `0` | Hole size as a fraction of the radius (0 = pie, 0.5 = donut). |
| `startAngle` | number | `0` | Where the first slice starts, in degrees clockwise from 12 o'clock. |
| `endAngle` | number |  | Where the arc ends, in degrees as startAngle; default a full circle (startAngle + 360). -90 to 90 is the upper half circle of a gauge. The chart is fitted to the arc, so a half circle fills the width. |
| `total` | number |  | The whole the slices are shares of: 100 for a score out of 100, 1 for a share, the target of a progress ring. The slices take their share of the arc and the rest is an empty track. Without it the slices fill the arc. What goes past it is cut at the end of the arc. |
| `center` | one of `none`, `value`, `percent` | `"none"` | The figure in the middle, written with `labelFormat`: the sum of the values ("value"), or their share of `total` ("percent"). Goes with innerRadius (a hole to write in). |
| `padAngle` | number | `1` | Gap between slices, in degrees. |
| `sort` | one of `none`, `desc`, `asc` | `"none"` | Order of the slices by value; "none" keeps the data order. |
| `label` | one of `none`, `percent`, `value` | `"none"` | Text outside each slice (slices under 3% get none). |
| `labelFormat` | any |  | How to write that text, as `format` on an axis. A share is a fraction: { "style": "percent", "maximumFractionDigits": 1 } writes 45.1%. |
| `fill` | string |  | One color for all slices, when there is no color channel. |
| `opacity` | number | `1` |  |

## mark.area

Version 10, 2.5 KB. A filled band per series between y and y2 (or `baseline`, default 0). Stack with transform.stack and use its two columns as y2 and y. `group` or a `color` channel splits the rows into series, like mark.line. Missing values break the area. `fade` makes the fill fade out towards the bottom (put a line mark on top for the edge); `curve` matches a smooth or a step line. x also takes a band scale, as on mark.line.

Needs: `lib.curve`.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `log`, `time`, `band` |  |
| `y` | **required** | `linear`, `log`, `time` |  |
| `y2` | optional | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Lower edge of the band. |
| `color` | optional | `color` | One area per distinct value of the field, colored by a color scale. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `baseline` | number | `0` | Where the area starts when there is no y2. Keep it inside the scale domain. |
| `group` | field |  | Field whose distinct values become separate areas. |
| `fill` | string |  | Any CSS color. Default: theme color by series index. |
| `opacity` | number | `0.85` | Fill opacity (0.45 by default with `fade`). |
| `toBottom` | boolean | `false` | Fill down to the bottom edge of the plot instead of to `baseline`: the area under a line whose axis does not start at 0 (a sparkline, a KPI trend). |
| `fade` | boolean | `false` | The fill fades from the color at the top of the plot to transparent at the bottom, and the area has no outline: the soft area under a line. |
| `curve` | one of `linear`, `smooth`, `step` | `"linear"` | Same as mark.line: "smooth" is a monotone curve through the points, "step" holds each value until the next one. |

## mark.boxplot

Version 2, 2.7 KB. A box (q1 to q3), a line across it at the median, and whiskers out to low/high — the usual shape for transform.quartiles' output. `x` is the category (a band scale, one box per category) or a plain position on a continuous one; the five value channels share the scale of `y` by default. Outliers are not drawn by this mark: transform.quartiles reports them as their own rows (only `value` set, the others NaN), meant for a plain mark.point layered on top reading the same `x` and `value`.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `band`, `linear`, `log`, `time` |  |
| `low` | **required** | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Bottom of the lower whisker. |
| `q1` | **required** | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Bottom of the box (25th percentile). |
| `median` | **required** | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Line drawn across the box. |
| `q3` | **required** | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Top of the box (75th percentile). |
| `high` | **required** | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Top of the upper whisker. |
| `color` | optional | `color`, `sequential` | Box and whisker color per row, from a color scale; rows the scale gives no color are not drawn. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `width` | number | `0.6` | Box width: a fraction (0-1) of the category band, or, off a band scale, a fixed number of px. |
| `fill` | string |  | Box fill. Default: theme color by mark index (or the `color` channel). |
| `fillOpacity` | number | `0.85` |  |
| `strokeWidth` | number | `1.5` | Width of the box outline and the whiskers. |
| `opacity` | number | `1` |  |

## mark.candlestick

Version 1, 2.2 KB. Open-high-low-close candles, one per row: a body from `open` to `close`, a thin wick from `low` to `high`, in one color when the price rose and in another when it fell. `x` is a date on a time scale (candles as wide as the nearest two allow) or a category on a band scale; the four prices share the scale of `y`. A row with one of its prices missing has no candle.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `band`, `time`, `linear` |  |
| `open` | **required** | `linear`, `log` | uses the scale of `y` unless told otherwise. Price at the start of the period. |
| `high` | **required** | `linear`, `log` | uses the scale of `y` unless told otherwise. Highest price of the period. |
| `low` | **required** | `linear`, `log` | uses the scale of `y` unless told otherwise. Lowest price of the period. |
| `close` | **required** | `linear`, `log` | uses the scale of `y` unless told otherwise. Price at the end of the period. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `width` | number | `0.7` | Width of a body, as a share (0-1) of the step between candles. |
| `up` | string | `"var(--bc-good, #12a150)"` | Color of a candle whose close is not below its open. |
| `down` | string | `"var(--bc-bad, #e5484d)"` | Color of a candle whose close is below its open. |
| `strokeWidth` | number | `1` | Width of the wick. |
| `opacity` | number | `1` |  |

## mark.line

Version 15, 3.8 KB. A line per series: one path however many points. Rows are joined in x order (unsorted data is sorted); missing values break the line. `group` splits the rows into one line per distinct value; a `color` channel does the same and colors each line from its color scale. `curve: "smooth"` draws a smooth curve that still passes through every point and never overshoots between two of them; `curve: "step"` holds each value until the next point (a price, a tariff). x also takes a band scale: the points sit in the middle of their categories, joined in the order of the band scale domain — a slope chart (two categories, before and after) or a line over named periods.

Needs: `lib.curve`.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `log`, `time`, `band` |  |
| `y` | **required** | `linear`, `log`, `time` |  |
| `color` | optional | `color` | One line per distinct value of the field, colored by a color scale. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `group` | field |  | Field whose distinct values become separate lines (long-format data). |
| `stroke` | string |  | Any CSS color. Default: theme color by line index. |
| `strokeWidth` | number | `2` |  |
| `dash` | list |  | Dash pattern, e.g. [4, 3]. |
| `opacity` | number | `1` |  |
| `curve` | one of `linear`, `smooth`, `step` | `"linear"` | "smooth": a monotone cubic curve through the points — no peaks or dips the data does not have. "linear": straight segments. "step": each value holds until the next point, then the line jumps: prices, tariffs, stock levels, anything that changes at moments and stays. |
| `label` | one of `none`, `name`, `value`, `both` | `"none"` | A label at the end of each line, in its color: the series name, its last value, or both — so a legend is rarely needed. Labels that would overlap are moved apart. Leave room on the right (padding.right, about 70–110 px). |
| `format` | any |  | How the end label writes the last value (a preset or Intl options, as guide.axis `format`). |
| `name` | string |  | The end label of a line that is not split into series (default: the y field). |

## mark.point

Version 12, 3.9 KB. One circle per row. Channels x and y, optional color (a field on a color scale); constant params r, fill, opacity. Either channel also takes a band scale, centered in its band — a category axis plus a value axis draws a dot plot (Cleveland dot plot). A `size` channel on a scale.size makes it a bubble chart: the area of each circle follows the value, big bubbles are drawn first so small ones stay on top. `swarm` on a category axis spreads the points of each category across its band so none overlap: a beeswarm, every sample visible; on a narrow screen its points shrink so they still fit. An opaque dot that rows repeat on one spot is drawn once; with `opacity` below 1 every one is drawn, so piles show.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `log`, `time`, `band` |  |
| `y` | **required** | `linear`, `log`, `time`, `band` |  |
| `color` | optional | `color`, `sequential` | Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn. |
| `size` | optional | `size` | Radius per row from a scale.size (a bubble chart); rows without a size (missing or negative) are not drawn. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `r` | number | `3` | Radius in px (when there is no `size` channel). |
| `fill` | string |  | Any CSS color. Default: theme color by mark index. |
| `opacity` | number | `1` | Bubbles overlap: 0.7 lets the ones behind show through. |
| `stroke` | string |  | Outline color; bubbles read better with the card color as one ("var(--bc-tooltip-bg, #fff)", which follows the dark theme). |
| `swarm` | boolean | `false` | Spread the points of each category across its band so that none overlap, keeping each at its value: a beeswarm. Needs a band scale on one axis and a value on the other. When a category does not fit its band (on a phone, say), all points of the mark shrink as little as makes them fit (see `swarmShrink`); a point that still finds no room is laid over the others: use a taller chart, or for thousands of points a violin (transform.density). |
| `swarmGap` | number | `1` | Space between the points of a swarm, px; it shrinks with the points. |
| `swarmShrink` | number | `0.5` | How much smaller the points of a swarm may get when a category does not fit its band, as a share of their radius: 0.5 lets them get half as big, 0 keeps them as given (at most 0.9). |

## mark.polygon

Version 1, 2.0 KB. Closed shapes through the rows in their order: the regions of transform.contour, or any outline given point by point. `group` makes a shape of the rows with one value, drawn as one path, in the order the values first come (the last on top); `ring` splits a shape into several outlines, a run of rows each. An outline inside another that runs the other way round is a hole, as the rings of transform.contour do. With `filled: false` only the outlines are drawn (contour lines). The tooltip finds the shape the pointer is in, the top one first.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `log`, `time` | Position of each point of an outline. |
| `y` | **required** | `linear`, `log`, `time` | Position of each point of an outline. |
| `color` | optional | `color`, `sequential` | Color of a shape, from its first row; a value the scale hides is not drawn. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `group` | field |  | Rows with the same value make one shape. Default: all rows are one. |
| `ring` | field |  | In a shape, a run of rows with the same value is one closed outline. Default: one outline per shape. |
| `filled` | boolean | `true` | false draws only the outlines, in the color of the shape. |
| `fill` | string |  | Any CSS color, when there is no color channel. Default: theme color by mark index. |
| `opacity` | number | `1` | Fill opacity. |
| `stroke` | string |  | Outline color of a filled shape. Default: none. |
| `strokeWidth` | number | `1` |  |

## mark.rect

Version 12, 3.7 KB. Rectangles. On a band scale a channel spans the band; on a continuous scale it spans from `<channel>2` (or from `baseline`) to the value. bar = band + linear; range bar = x/x2. With no band at all (months on a time x, the amount on y) a bar stands at its position, as wide as most of the smallest step in the data. `dodge` turns a bar chart into a grouped one: it splits each band into one bar per distinct value of the field, side by side (for a stacked bar, use `color` with transform.stack instead — dodge and stack are different arrangements of the same `color`/grouping field). `shape: "hexagon"` draws a hexagon in the box instead, for the cells of transform.hexbin.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `band`, `linear`, `log`, `time` |  |
| `y` | **required** | `band`, `linear`, `log`, `time` |  |
| `x2` | optional | `linear`, `log`, `time` | uses the scale of `x` unless told otherwise. Other end of the rectangle along x. |
| `y2` | optional | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Other end of the rectangle along y. |
| `color` | optional | `color`, `sequential` | Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn. |
| `dodge` | optional | none (a plain field) | Field that splits the band-scale axis into side-by-side bars, one per distinct value (grouped bar). Usually the same field as `color`. One distinct value (or none) draws a plain bar, unchanged. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `baseline` | number | `0` | Where bars start on a continuous axis without a second channel. Keep it inside the scale domain (scale `zero: true` for 0). |
| `fill` | string |  | Any CSS color. Default: theme color by mark index. |
| `opacity` | number | `1` |  |
| `radius` | number | `0` | Corner radius in px. |
| `shape` | one of `rect`, `hexagon` | `"rect"` | "hexagon": a hexagon pointy at the top in the box the rectangle would fill, its corners on the middle of the top and bottom edges and a quarter of the way down the sides. The boxes transform.hexbin writes tile with it. |
| `thickness` | number | `1` | Share of the band a bar fills, centered (0.4 = a slim bar; a bullet chart draws the value slimmer than the ranges behind it). |
| `dodgePadding` | number | `0.1` | Gap between the bars of one dodged category, as a fraction of each bar's share of the band. |

## mark.rule

Version 5, 2.1 KB. Lines at values: a target, a threshold, an average, the target tick of a bullet chart. `y` alone draws a horizontal line across the plot at that value (`{ "value": 50000 }` for a constant, in the units of the y scale); `x` alone a vertical one. On a band scale the line spans the band (`thickness` of it), so y = category and x = target gives a short tick across each bar. With x2 / y2 it runs between two values, along the middle of the band on a band scale (a range, a dumbbell). The same line is drawn once however many rows repeat it.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | optional | `band`, `linear`, `log`, `time` |  |
| `y` | optional | `band`, `linear`, `log`, `time` |  |
| `x2` | optional | `linear`, `log`, `time` | uses the scale of `x` unless told otherwise. Other end along x. |
| `y2` | optional | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. Other end along y. |
| `color` | optional | `color` | Line color per row, from a color scale. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `stroke` | string |  | Any CSS color. Default: the theme text color. |
| `strokeWidth` | number | `2` |  |
| `dash` | list |  | Dash pattern, e.g. [4, 3]. |
| `opacity` | number | `1` |  |
| `thickness` | number | `0.7` | On a band scale, the share of the band the line spans (1 = the whole band). |
| `label` | string |  | Text at the end of the line ("Target 50K"). |

## mark.sankey

Version 3, 4.7 KB. A Sankey diagram: one row per flow, from `source` to `target`, its thickness in proportion to `value`, drawn where transform.sankey lays it out (put it in `transforms` with the same three fields). Needs no scales and no axes; every node is named on the chart, and has a color of the palette. A label too long for the space between columns loses the total, then the end of the name; two labels that face each other across the last gap share it. Hovering a node lights up its flows. Give the same name to the same node in `source` and `target`, and different names to different stages (a "Direct" channel and a "Direct" segment would be one node).

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `source` | **required** | none (a plain field) | Field with the name of the node a flow leaves. |
| `target` | **required** | none (a plain field) | Field with the name of the node a flow arrives at. |
| `value` | **required** | none (a plain field) | Numeric field: the size of the flow. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `nodeWidth` | number | `12` | Width of a node, in px. |
| `format` | any |  | How the total of a node is written after its name. Without it, only the name. |
| `linkOpacity` | number | `0.35` | Opacity of the ribbons. |
| `nodeLabels` | list |  | What a tooltip calls what flows into and out of a node: ["In", "Out"] by default. Translate it on a page in another language. |
| `layout` | list |  | Names of the five columns transform.sankey writes, when its `as` renames them: [x0, x1, y0, y1, thickness]. |
| `labelMin` | number | `11` | Nodes shorter than this many px get no label, so that labels do not overlap. |

## mark.text

Version 10, 4.8 KB. A text label per row at (x, y): value labels on bars, annotations on points. The text comes from the `text` field: numbers are written with `format` (a preset such as "percent" or an object of Intl options), or rounded to `decimals`, or to 6 significant digits. On a band scale the label is centered in its band. Rows without text are skipped, and the same label on the same spot is written once (a total a transform repeated on each row of its quarter). To keep a label readable on a colored cell, give it `on`: the same field as the cell's color. A label never runs into its neighbours or out of its cell: on a band x scale (anchor middle) it must fit the step from one category to the next, and with `x2` / `y2` it must fit the box from (x, y) to (x2, y2), keeping `dx` / `dy` as the margin on the far side too (the cells of a treemap); with anchor or baseline "middle" it sits in the middle of the box. A label that does not fit is drawn smaller, down to `minSize`, and is left out below that.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `linear`, `log`, `time`, `band` |  |
| `y` | **required** | `linear`, `log`, `time`, `band` |  |
| `x2` | optional | `linear`, `log`, `time` | uses the scale of `x` unless told otherwise. The other side of the box the label has to fit in (with y2: the cell it labels). |
| `y2` | optional | `linear`, `log`, `time` | uses the scale of `y` unless told otherwise. The other side of the box the label has to fit in, vertically. |
| `text` | **required** | none (a plain field) | Field with the text to show. |
| `color` | optional | `color`, `sequential` | Text color per row, from a color scale. |
| `on` | optional | `color`, `sequential` | uses the scale of `color` unless told otherwise. The color the text sits on (the field a heatmap cell is colored by): the text turns dark or light to stay readable. On a palette color a theme can set the text with `--bc-on-c<N>`. Rows with no such color get no text. |

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
| `negative` | one of `same`, `flip` | `"same"` | "flip" mirrors the placement of a row whose value is below zero, so that the label of a negative bar sits past its end, not inside it: `baseline` and `dy` on a value y, `anchor` and `dx` on a value x (with a band y, as in horizontal bars). |
| `collide` | one of `show`, `hide` | `"show"` | "hide" keeps labels off each other, for names on points: in row order, a label that would touch one already placed tries the other side of its point (mirrored `baseline` and `dy`) and is left out if that is taken too. Sort the rows to choose which labels win. |
| `minSize` | number | `8` | The smallest font size a label that does not fit may shrink to; a label that would need less is not drawn. Set it to `size` to never shrink. |

## mark.violin

Version 1, 2.9 KB. The shape of a distribution per category, from the rows of transform.density (one row per point of a curve): a violin, mirrored on both sides of its band, or with `side: "one"` a ridge standing on the bottom of its band and rising into the one above (a ridgeline, joy plot). Put the categories on a band scale: on x the violins stand up and the value runs along y; on y the shapes lie down and the value runs along x (the usual ridgeline). All shapes share one width scale, so a wider shape is a denser spot; `normalize: "each"` fits every shape to its band instead. Shapes further down are drawn over the ones above them.

| Channel | | Accepted scales | Notes |
| --- | --- | --- | --- |
| `x` | **required** | `band`, `linear`, `log`, `time` | The category (band) for violins, or the value for ridges. |
| `y` | **required** | `band`, `linear`, `log`, `time` | The value for violins, or the category (band) for ridges. |
| `density` | **required** | none (a plain field) | Numeric field with the density at each point (`density` of transform.density). |
| `color` | optional | `color`, `sequential` | Fill per category, from a color scale; a category the scale hides is not drawn. |

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `side` | one of `both`, `one` | `"both"` | "both": a violin, the curve mirrored around the middle of the band. "one": a ridge on one side, rising from the bottom of the band (on a band y) or from its left (on a band x). |
| `extent` | number |  | How much of the band the widest point fills: default 0.9 for a violin, 1.6 for a ridge (above 1 a ridge rises into the band above it, as ridgelines do). |
| `normalize` | one of `all`, `each` | `"all"` | "all": one width scale for every shape, so they compare. "each": every shape as tall as its band, to read shapes rather than sizes. |
| `fill` | string |  | Any CSS color, when there is no color channel. Default: the first theme color. |
| `opacity` | number | `0.85` | Fill opacity. |
| `stroke` | string |  | Outline color. Default: none for a violin; the card color for a ridge, so a ridge in front stands apart from the one behind it. |
| `strokeWidth` | number | `1.5` |  |

## guide.axis

Version 12, 6.6 KB. Labels for a positional scale, with an axis line and optional tick marks. Side defaults from the scale orientation; set `position` for a second axis. `format` writes the tick labels (currency, percent, dates), `title` names the axis. The quiet default: no tick marks, a line only along a horizontal axis; pair a value axis with guide.grid. Category labels too wide for their band wrap onto two lines; text categories that still do not fit (a narrow screen) all go at an angle, rather than some of them being left out, while dates and numbers show every few.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale, **required** |  |  |
| `position` | one of `top`, `right`, `bottom`, `left` |  |  |
| `title` | string |  | Text that names the axis (with its unit, for example "Revenue, USD"). Rotated on a vertical axis. |
| `format` | any |  | How to write the tick labels: numbers and dates on a linear, log or time scale, and on a band scale categories that are dates ("2024-04-01" from an aggregate by quarter) or numbers; text categories stay as they are. A preset ("percent", "compact", "integer", "year", "quarter" (Q2 2024), "month", "day", "date", "datetime") or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 } or { "month": "short", "year": "2-digit" }. Also "locale" (default "en-US"), "prefix" and "suffix". |
| `line` | one of `auto`, `on`, `off` | `"auto"` | The axis line. "auto": drawn along a horizontal axis (the baseline bars stand on), left out on a vertical one, where grid lines do the job. |
| `ticks` | boolean | `false` | Small tick marks at the labels. |
| `count` | number |  | About how many labels to show: 12 for the months of a year. Labels that would not fit are still thinned. |
| `anchor` | one of `start`, `end` | `"start"` | Which end thinned labels count from: "end" keeps the last one, for a report about the latest period. |

## guide.grid

Version 2, 0.6 KB. Grid lines at the ticks of a positional scale (the same ticks its axis shows). Draws behind the marks. An axis given `count` needs the same `count` here, or the lines and the labels part.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale, **required** |  |  |
| `count` | number |  | About how many lines: the `count` of the axis on the same scale. |

## guide.kpi

Version 7, 4.2 KB. A key figure as the heading of a chart: a label, the value in large type, and its change against a comparison, green when it goes the good way and red when not. It takes the room it needs at the top, so a line or an area drawn in the same chart becomes the sparkline under the number. The value is one number from a field: the last row by default (`aggregate`), compared with the row before it; or compare with another field (`against`: a target, last year). A chart may consist of this guide alone (no marks) for a tile with just the number.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `field` | field, **required** |  | The numeric field the figure comes from. |
| `label` | string |  | What the figure is ("Revenue", "Active users"), above it. |
| `aggregate` | one of `last`, `first`, `sum`, `mean`, `min`, `max`, `count` | `"last"` | How the rows make one number: the last row (the latest period, in data order), the first, or the sum, mean, min, max or count of the field. |
| `compare` | one of `previous`, `first`, `none` |  | What the change is measured against: the row before the last ("previous", the default with aggregate "last"), the first row ("first": change over the period), or nothing. "previous" and "first" compare single rows, so they go with aggregate "last" only; a sum or a mean is compared through `against`. |
| `against` | field |  | Compare with another field instead, aggregated the same way (a target, the same period last year). |
| `delta` | one of `percent`, `absolute` | `"percent"` | The change as a percentage of the comparison, or as a difference written with `format` (or `deltaFormat`). |
| `deltaFormat` | any |  | How to write the change when it is not in the same unit as the value: a share of 66.4% that moved by 1.8 points is { "maximumFractionDigits": 1, "suffix": " pp" }. A preset or an object of Intl options, as in `format`. With delta "percent" it gets the change as a fraction (0.12 for 12%). It writes the difference in the units of the field, so a share kept as 0..1 needs `deltaScale`. |
| `deltaScale` | number | `1` | What an absolute change is multiplied by before it is written: 100 for a share kept as 0..1 that moved by 0.093 and is to read "+9.3 pp". |
| `better` | one of `up`, `down` | `"up"` | Which way is good: "down" for costs, churn, response times. |
| `format` | any |  | How to write the value (a preset such as "compact" or "percent", or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }). |
| `note` | string |  | A few words after the change ("vs last month", "vs target"), or in its place when there is no change. |
| `rowField` | field |  | Names the row the figure comes from, after the label: with aggregate "max" and field "month", "Best month: 2025-09". For aggregate last, first, min and max: a sum has no row of its own. |
| `rowFormat` | any |  | How to write `rowField`, as in `format`: "month" for a date. |
| `size` | number | `30` | Font size of the value, px. |

## guide.legend

Version 10, 5.2 KB. Legend of a color scale. A categorical scale (`color`) lists every value with a swatch, and values a filter hides stay listed, dimmed. A continuous scale (`sequential`) draws a color bar with a few labels; a `size` scale draws a few round values as circles of their size (the key of a bubble chart). On the right or left it is a column, on top or bottom a row that wraps onto more lines when it is wider than the plot. Takes space on its side like an axis, so list it after an axis on the same side to sit outside it.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale, **required** |  | A color, sequential or size scale. |
| `position` | one of `top`, `right`, `bottom`, `left`, `auto` | `"right"` | "auto" is a row on top while the items fit on two lines, and a column on the right when long labels would need more; it is decided again when the chart changes width. |
| `title` | string |  | What the legend shows, on a line above it: "Region", "Revenue, $M". |
| `format` | any |  | How to write the labels of a color bar or a size key (a `sequential` or `size` scale): a preset ("percent", "compact", ...) or an object of Intl options; see guide.axis `format`. |

## interaction.animate

Version 2, 2.2 KB. Plays the chart in once, when it is first drawn: bars grow from their baseline, lines and areas are drawn from left to right, a pie opens from its center, anything else fades in. Never again on zoom, filter or update of the view, and not at all for readers who ask their system for reduced motion. Uses the browser's own animation of the SVG layer (no timer loop); on a canvas chart it fades the canvas in.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `effect` | one of `auto`, `grow`, `wipe`, `pop`, `fade` | `"auto"` | "auto" picks by the marks: grow for bars, wipe for lines and areas, pop for a pie, fade otherwise. |
| `duration` | number | `700` | Milliseconds. |
| `delay` | number | `0` | Milliseconds before it starts (stagger the cards of a dashboard). |

## interaction.brush

Version 5, 3.7 KB. Drag a rectangle over the plot to zoom to it: on the scales in `scales` (default x) the view becomes the selected range, on a category (band) scale the categories under the selection. Shift + drag by default, so it does not fight with the pan of interaction.zoom; Escape cancels while dragging, double-click resets. A drag shorter than `minSize` px is not a selection.

Needs: `lib.pointer`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scales` | list | `["x"]` | Names of the scales to zoom. One horizontal scale selects a vertical band, one vertical scale a horizontal band, both a box. |
| `modifier` | one of `shift`, `alt`, `ctrl`, `none` | `"shift"` | Key that must be held to start a selection. With "none" every drag is a selection, so the pan of interaction.zoom never starts. |
| `fit` | list |  | Scales to refit to the selected window (usually ["y"]). |
| `minSize` | number | `6` | Smallest selection, in px, along each selected axis. |

## interaction.crosshair

Version 5, 2.0 KB. A vertical line across the plot that follows the pointer, so the reader can read a date off several series at once. It snaps to the nearest datum of a line or area (or of every mark, with `snap: "all"`); `snap: "off"` follows the pointer freely. On a touch screen it follows a tap and the sliding finger, and stays until the reader touches somewhere else. Works with or without the tooltip.

Needs: `lib.pointer`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `snap` | one of `lines`, `all`, `off` | `"lines"` | What the line jumps to: the nearest point of a line or area ("lines"), of any mark ("all"), or nothing (it follows the pointer). |
| `horizontal` | boolean | `false` | Also a horizontal line through the datum. |

## interaction.legend-filter

Version 4, 2.5 KB. Click an item of a categorical legend to hide or show that category; double-click isolates it (double-click again shows everything). Hidden categories are drawn by no mark and stay in the legend, dimmed. The visible set is the view of the color scale, so it can also be set with setView. Hiding everything shows everything.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scale` | scale |  | The color scale to filter. Default: the scale of the first legend. |
| `legend` | string |  | The id of a legend outside the chart, in the page, shared by several charts. Its items are elements with `data-bc-legend-index`. The composer writes this for facets; there is no need to set it by hand. |
| `fit` | list |  | Scales to refit to the visible rows after a change (usually ["y"]); by default they keep their domain. |

## interaction.tooltip

Version 15, 8.5 KB. Shows the datum under the pointer: a marker plus a card with the fields behind it — the category or date as its heading, then one line per value. Every mark finds its own datum (MarkDef.pick); the closest one wins. The default content is written with textContent only; `content` replaces it with what a function returns. On a touch screen a tap shows the card and sliding the finger moves it along the data; it stays after the finger lifts, until the reader touches somewhere else. For a vertical line that follows the pointer, add interaction.crosshair. A shape that stands for several rows (a line through a total repeated on each row of its quarter) shows only the fields they share.

Needs: `lib.pointer`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `fields` | list |  | Fields to show. Default: the fields the mark reads (its channels and group). |
| `formats` | any |  | How to write values, per field: { "revenue": { "style": "currency", "currency": "USD" }, "share": "percent", "date": "date" }. Each is a preset or an object of Intl options (see guide.axis `format`). Fields without one are written as they are (numbers to 6 significant digits). |
| `labels` | any |  | What to call the fields, per field: { "median": "Median, ms", "rev": "Revenue" }. Fields without one are shown under their own name. |
| `content` | any |  | Name of a function registered with BC.defineFn (or, in a spec built in JS, the function itself). It gets a TooltipDatum and returns what to show: a string (text), { html }, a DOM Node, an array of those, null/false to hide the tooltip, or undefined for the default content. { html } is set with innerHTML and is not escaped — build it from trusted strings, never straight from a row value the data may contain. |
| `heading` | field |  | The field at the head of the card. Default: the category or date the datum stands on. Give it when that is not what names the datum, as in a calendar, where x is the week and the row is a day. |
| `marker` | one of `auto`, `dot`, `box`, `none` | `"auto"` | "dot" draws a small circle at the point; "box" highlights the whole shape (used automatically for rect marks like bar/heatmap, where a dot would land on an edge); "auto" picks box when the mark reports its bounds and dot otherwise; "none" shows the tooltip text without a marker. |

## interaction.zoom

Version 7, 2.5 KB. Wheel zoom around the cursor, drag to pan, double-click to reset. A drag another interaction claims (interaction.brush, with its modifier held) is left to it. Works on continuous scales (linear, log, time; a log scale zooms by ratios) by changing their view through setView; the layout stays frozen.

Needs: `lib.pointer`, `lib.view`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scales` | list | `["x"]` | Names of the scales to control. |
| `wheel` | one of `ctrl`, `always`, `off` | `"ctrl"` | "ctrl": Ctrl/Cmd + wheel (and trackpad pinch) zooms, so the page still scrolls; "always": plain wheel zooms. |
| `fit` | list |  | Scales to auto-fit to the zoomed window (usually ["y"]): their domain is recomputed from the rows that are visible. |
| `pan` | boolean | `true` |  |
| `maxZoom` | number | `50` | How far in you can go, as a multiple of the full domain. |

## interaction.zoom-controls

Version 6, 2.6 KB. A small button bar over one corner of the chart: "100%" clears the controlled scales back to their full domain; "−"/"+" step a continuous one in and out around the center of its current view. A band scale only gets "100%" (there is nothing continuous to step).

Needs: `lib.view`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `scales` | list | `["x"]` | Names of the scales to control, the same as interaction.zoom and interaction.brush. Default ["x"] — set it to match whichever scales those use, so "100%" undoes everything they did. |
| `fit` | list |  | Scales to refit after a "−"/"+" click (usually ["y"]), the same as interaction.zoom's `fit`. |
| `step` | number | `0.5` | How much "−"/"+" grow or shrink a continuous scale's span, as a factor of the current span (0.5 = double/halve). |
| `maxZoom` | number | `50` | How far "+" can go, as a multiple of the full domain. |
| `titles` | any |  | What the buttons say to a mouse and to a screen reader, in the language of the page: { "reset": "...", "out": "...", "in": "..." }. Default English. |
| `corner` | one of `top-right`, `top-left`, `bottom-right`, `bottom-left` | `"top-right"` | Which corner of the chart the buttons sit in. |

## renderer.canvas

Version 2, 5.9 KB. Draws a display list on one <canvas>, scaled to its container and sharp on high-density screens. Meant for charts with tens of thousands of marks (a big scatter plot), where an SVG element per mark gets slow: about 5 times faster to redraw at 50,000 points. A single long line is one path either way, so it gains little; decimate it instead. It reads the same CSS variables as the SVG renderer (themes, dark mode) and follows changes of the color scheme, but a canvas has no elements: CSS classes and native tooltips on marks do not exist here. Zoom, brush, tooltip and legend filter work as usual, and so do fading fills.

## renderer.svg

Version 4, 3.2 KB. Draws a display list as one <svg> scaled to its container via viewBox. Paths have no implicit fill: marks set `fill: "none"` for strokes. A style with `fade` gets a vertical gradient over the plot, from the fill color to transparent.
