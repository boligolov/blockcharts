# blockcharts principles

**Version 1.0.** blockcharts is a chart library cut into atoms. A page never carries the library: it carries
exactly the blocks its own charts need to be drawn, and nothing more. These principles say how that works
and what follows from it, for a person writing a report, an agent writing one for them, and anyone writing
a block or a composer.

The words MUST, SHOULD and MAY in §12 are used as in RFC 2119. Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## 1. Exactly what the charts need, nothing more

A charting library is usually one bundle: every chart type, every interaction, every option, loaded by
every page that draws a single bar chart. blockcharts turns that around. The page carries the **core**
(26 KB minified, about 10 KB gzipped: data loading, validation, the drawing pipeline) and **only the blocks
its charts use**, each between 0.4 and 8 KB. A chart without zoom carries no zoom; a page without a
pie carries no arcs.

What a chart uses is not chosen by anyone: it is read from the spec (`BC.needs(spec)`) and closed over the
blocks' declared dependencies (`closure` in the manifest). Nobody lists blocks by hand, so no list can be
too long or too short. Sizes below are minified code, measured on the example pages:

| page | blocks | code in the page |
|---|---|---|
| a pie chart | 6 | 44.8 KB |
| a bar chart with labels and a tooltip | 8 | 47.1 KB |
| monthly totals and a ranking from raw CSV rows | 12 | 59.7 KB |
| an executive dashboard: KPI tiles, a trend, a donut, a waterfall and a funnel, animated | 20 | 74.8 KB |
| everything blockcharts has | 34 | 115.3 KB |

Blocks are shared across the page: five charts with axes carry `guide.axis` once. The same rule holds
however the code arrives (§11): a composed report inlines exactly its blocks, the loader fetches exactly
them, and a kit can be built for exactly one page.

## 2. Blocks are atoms: one role, one job

A chart library usually grows one feature per chart type: a bar chart, a pie chart, a heatmap, each with
its own options and its own code. blockcharts has none of those. It has **blocks**, each doing one job,
named `<role>.<type>`:

| role | job | examples |
|---|---|---|
| `scale` | maps values to positions or colors | `linear`, `time`, `band`, `color`, `sequential` |
| `transform` | reshapes rows before drawing | `aggregate`, `stack`, `bin`, `quartiles`, `decimate`, `waterfall`, `funnel`, `treemap` |
| `mark` | draws rows | `rect`, `line`, `area`, `point`, `text`, `arc`, `boxplot`, `rule` |
| `guide` | explains a scale or the chart | `axis`, `grid`, `legend`, `kpi` |
| `interaction` | lets the reader explore | `tooltip`, `crosshair`, `zoom`, `brush`, `legend-filter`, `zoom-controls`, `animate` |
| `renderer` | puts the picture on screen | `svg`, `canvas` |

A chart type is a **composition**: a bar chart is `band + linear + rect`, a heatmap `band + band + rect +
sequential`, a histogram `bin + rect`, a pie `arc + color`, a waterfall `waterfall + rect`, a bullet chart
`rect + rect + rule`, a KPI tile `kpi` over a `line`. A new kind of chart is usually a new recipe,
not new code; when it does need code, that is one new block, and only pages that use it pay for it.

Blocks talk to each other only through the core. Every block declares what it `requires`, its parameters
and its channels. Defining a block that is already there changes nothing (the first definition stays), so
bundles can overlap without harm.

## 3. Customizable at every level

Because a chart is a composition, changing it never means forking the library. From the lightest touch to
the deepest:

1. **Parameters.** Every block documents its own: number and date formats (`Intl`, any locale), axis
   titles and positions, bar radius and padding, tooltip fields and markers, zoom limits.
2. **CSS.** Charts take every color from CSS variables (`--bc-c0`…`--bc-c7`, `--bc-text`, `--bc-axis`,
   `--bc-grid`, …) and their text from the page's own font; axes, grids and legends carry classes
   (`bc-axis`, `bc-grid`, `bc-legend-item`, …). A brand palette, a dark theme or a print style is a
   stylesheet, not a spec change.
3. **The set of blocks.** A kit is a list of blocks in `kits.json`; a kit for exactly one page is one
   command (`node scripts/build-dist.js --page page.json`). Ship bars and a tooltip and nothing else, if
   that is all you draw.
4. **Functions by name.** The few things that need code — a tooltip body of your own — are registered once
   with `BC.defineFn(name, fn)` and referred to from the spec by name.
5. **Blocks of your own.** A block is a classic script that calls `BC.define`, the same contract the
   built-in blocks use. A target line, a new mark or a new interaction is one small file, validated,
   themed and composed like the rest — and carried only by the pages that name it
   ([an example](https://blockcharts.online/embed/block/)).

## 4. The page is the product

A report is **one HTML file**. It opens from disk by double-click, works offline, needs no server, no
account and no build step, and looks the same on every machine. It can be emailed, attached to a ticket,
put in a shared folder or archived next to the data it was made from, and it still opens in ten years,
because everything it needs is inside it — and, by §1, nothing it does not need. On a screen narrower than the
chart, the chart is laid out again at that width, so its text stays readable on a phone.

## 5. The chart is data, not code

A chart is a **JSON spec**: the dataset, named scales, transforms, marks with their channels, guides and
interactions. No functions, no callbacks, no `NaN` in the spec. That makes a spec easy to write
(for a person or an agent — there is no API to misremember), easy to check, safe to store, and the same
page every time. What truly needs code lives outside the spec, named from it (§3.4, §3.5).

## 6. Everything is declared once

- **Datasets** live once per page, named, in one data block; any number of charts refer to them by name.
- **Scales** are declared once per chart, by name. Their domain is gathered from every channel that
  refers to them, so a line and its points share one scale without saying so.
- **Guides attach to scales, not marks**: two marks on the same scales share one axis. A second axis on
  the same side (dual axis) is just a second scale with `position`.
- **Marks read fields through channels**: `"y": "revenue"` is the field `revenue` on the scale `y`.

## 7. Checked before it is written

A report is wrong in the worst way when it opens and quietly shows the wrong thing. So a composer
**checks every chart against the real data before it writes anything**: unknown fields, a scale of the
wrong kind for a mark, a missing required parameter, a format that does not parse. Then it draws each
chart once in a sandbox, to catch what only drawing shows. Each problem is reported with its place in the
JSON — `charts[2].marks[0].y: unknown field "revnue" in dataset "orders"` — so a person or an agent can fix
it; until every chart is valid, no file is written.

In the browser the same rule holds: a broken chart shows its error in its own box; the rest of the page
still works.

## 8. Heavy data stays small and fast

The weight of a report is usually its data, not its code:

- large datasets are stored **gzipped** in the page automatically;
- long numeric series can be **binary columns** (raw float or integer values), far smaller than JSON text;
- raw rows are **aggregated** in the page (`transform.aggregate`: sum per month, count per region), so the
  source table can go in as it is;
- a line of hundreds of thousands of points is **decimated** to what the screen can show, again at every
  zoom (`transform.decimate`);
- tens of thousands of marks are drawn on one **canvas** (`renderer.canvas`) instead of as SVG elements.

Each of these is a block: a page pays for it only when it needs it.

## 9. Same input, same bytes

A composer is a pure function from the page description to the HTML file: the blocks in a fixed order,
compression without timestamps, no absolute paths. The same input gives the same bytes, so a report can be
regenerated, diffed and kept under version control. Dates are read and shown in UTC and the default number
locale is fixed, so a page reads the same in every time zone and on every machine.

## 10. Nothing leaves the page

A composed report loads nothing from the network: no CDN, no fonts, no analytics. Data can come only from
the page itself or from files next to its description, never from a URL. Text from the data cannot break
out of its place: data, specs, titles and styles are escaped for the tag they live in, so a value like
`</script><script>…` is shown as text.

## 11. One set of files, three ways in

The same built blocks serve three uses; which one is a question of hosting, not of features:

| way | what the page gets | for |
|---|---|---|
| **composer** | exactly the page's blocks and data, inlined into one file | reports, dashboards, anything shared as a file |
| **kit** | core and a chosen set of blocks in one script, from a CDN or `npm` | your own pages and apps |
| **loader** | a 2 KB script that fetches only the blocks the page's charts need | sites with many different charts |

Files of a released version never change; the release manifest carries an SRI hash for each, so a page
can pin exactly the code it trusts.

## 12. Requirements

For a **page** (a composed report):

1. It MUST open from the file system with no network access and show every chart.
2. It MUST contain only the blocks its charts need (the closure of `BC.needs` over its specs) and any
   blocks explicitly requested with `include`.
3. Every spec in it MUST be plain JSON and MUST have passed validation against the page's data.
4. Composing the same input twice MUST give byte-identical files.
5. Text from data, specs, titles and styles MUST NOT be able to end the tag it is in.

For a **block** — a page's own blocks as much as the built-in ones:

6. It MUST do one job of one role and be named `<role>.<type>`.
7. It MUST declare its dependencies (`requires`), parameters and channels in its `BC.define` call, and
   MUST NOT reach into another block other than through the core.
8. Defining it again MUST leave the first definition in place.
9. It MUST NOT load anything from the network.
10. It SHOULD stay small: a block that grows past a few kilobytes is probably two blocks.

For a **composer** or **loader**:

11. It MUST choose blocks mechanically from the specs and the manifest, never from a hand-written list.
12. A composer MUST write nothing while any chart has an error, and MUST report each error with its path in
    the input.
