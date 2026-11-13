# Roadmap

What is still to do. Done work is in the git history and in [docs/Design.md](docs/Design.md); how the
project is laid out and tested is in [docs/development.md](docs/development.md). Remove an item in the same
commit that finishes it.

The skill (`skills/blockcharts/`) is the main product; the principles (`docs/spec/`), the library (`src/`)
and the ways to ship it (composer, kits, loader, npm) serve it.

## The production review

A strict review before release, on 2026-11-10 at skill 0.33.0 (commit 924b85f): code, skill text, recipes, the site,
every recipe looked at in Chrome on a desk and a phone. 64 findings in six groups, fixed in this order, one commit and
one note in [docs/Design.md](docs/Design.md#the-production-review) each.

Done (skill 0.33.1–0.33.46): A, safety (5); B, silent wrong results in validation and data (21); C1–C20, layout
and interaction (end labels, zoomed picks, step lines, bars on a time axis, a target's label, CJK breaks, Sankey, legends,
vertical axis names, tooltip cards, the edge dot, the real-Chrome suite `npm run test:chrome`, text the same size in
every card, a waterfall's figures on a phone, a Marimekko's column names, hexbins inside the plot, a Gantt's first
month, an axis's top label, the color of a tooltip's dot, cards on error bars, dumbbells and lollipops, KPI tiles two to a
row on a phone, a treemap laid out for its plot, even gaps in a legend); D1, a chart's name for a screen reader and the
legend filter from the keyboard; D2, the site's text at 4.5:1 (its own colors; the charts' are below); D3, the
headings of the site and the reports one level at a time, a skip link, copy buttons that say what they copy; E1,
tooltips in the reader's words (no "–" lines, names from the transforms, a bin's range, a warning about code names);
text measured in the chart's own font (CI's Chrome suite in DejaVu Sans, a web font laid out again when it comes); E2,
the recipes as SKILL.md advises (a line and its points in one color, two scales with a legend and titled axes, currency
and percent on the axes, the dashboard on the composer's grid); E4, a CSV example in SKILL.md an agent can copy as it
is; E5, no tool in the skill an agent cannot run (binary columns left to pipelines: the composer's gzip does nearly as
well); E6, the KPI and zoom paragraphs of SKILL.md say what the block is before how to size it; E3, a note under a
chart for its reader and `how` for the agent (the recipes' notes written from their data, a warning on a note with code);
E7, the trigger description leaves out charts in an app's own code and says a table of figures is a heatmap with
numbers (SKILL.md tells what to do with a table request; the heatmap recipe writes its figures).

Left, in this order:

- [ ] **F1** README and docs/spec/principles.md: every size and count is stale (34 vs 58 blocks, kits 60 → 86.7 KB …).
      Generate them or link /blocks/#sizes.
- [ ] **F2** site/public/og.png is stale (21 of 42 blocks, 69.8 KB): `npm run og` and check it.
- [ ] **F3** guide.astro says "A Canvas renderer … is planned"; site-demos.js says "Charts are SVG".
- [ ] **F4** /blocks/ parameter tables cut the doc column on a phone (16 of 63 tables), also the /guide/ kit table and
      /embed/data/: stack the rows below about 600 px.
- [ ] **F6** "48 KB smallest report" (Stats.astro) vs 39.5 KB in the gallery; "everything" is 179.6 / 182.5 / 183 KB.
- [ ] **F7** /embed/kit/ inline code widens the page to 526 px on a phone (site-demos.js).
- [ ] **F8** Install.astro "updates itself"; principles v1.0 vs 1.1 (README, Principles.astro); the compose path in
      [name].astro; HowItWorks "above"; mouse-only hints on phones (Hero, examples index); titles "Bar chart: chart
      example"; no 404 page; README "no dependencies"; the canvas bench says 50,000 points where it measured 21,000;
      0.1.0 vs 0.33.x versions unexplained; browser minimums (ES2020, DecompressionStream: Safari 16.4+, Firefox 113+).
- F5 (`npm install blockcharts` is a 404, `cdn.example.com` placeholders, blockcharts.online does not resolve) waits for
  the release below: publishing and deploying are the owner's step.

Found along the way:

- [ ] Text in a chart's own colors reads under 4.5:1 on a white card (WCAG AA; found by D2, in Chrome): the end
      labels of `mark.line` are in their line's color, made for marks (3:1), so on the light palette Fabrikam (c2)
      reads 2.2:1, c1 3.1, c3 3.7, c4 3.9 (bump-chart, slope, moving-average, lines-by-series); moving-average's
      "Daily" is in `--bc-axis`, 1.5:1 (1.8 dark); a KPI tile's change in `--bc-good` #11a05a is 3.4:1 and in
      `--bc-bad` #e5484d 3.9 (the composer's defaults, which the site repeats). In dark only "Daily" fails. A shade
      of each color for text, or labels in `--bc-text` with a swatch of the line's color; the composer and site.css
      change together.
- [ ] The zoom controls' "100%" button is named "Reset zoom to the full range" by default (found by D3, axe-core's
      label-content-name-mismatch): a person who says what they see ("click 100%") does not reach it, as its name
      leaves the word out. "100%: reset the zoom", or the name starting with the text it shows.
- [ ] The legend filter of a canvas chart has no keys: a canvas has no elements to focus. Buttons of the page over the
      legend (as the composer draws above a facet), or keys on the canvas itself with a ring it draws.

- [ ] From 720 px to about 1050 px (a tablet, a narrow window) a grid of 4 columns makes cards narrower than 200 px (136 at 800): the
      donut of executive-dashboard is laid out at 200 px and scaled down, its legend at 8 px (the KPI tiles are laid out at
      their width since C19). The grid could take fewer columns in that range.
- [ ] calculated-field on a phone: the figures over its eight quarters are 9.5 px (profit) and 9 px (margin); eight bars
      in 324 px with figures at nearly one height. Like the waterfall, a figure on every bar could take the value axis's
      place.
- [ ] Date categories on a band axis are thinned by the width of the whole label on one line, so twelve months in
      Japanese show every other month on a desk although "2024年 / 1月" on two lines would fit (guide.axis `fitWritten`).
- [ ] A time axis on a phone shows two labels where four fit (found by E2): it asks for `plot.w / 80` ticks whatever its
      labels say, and months step by 1, 3 or 6, so in 324 px candlestick has "Jan 24 | Jan 25" for 22 months,
      error-bars, executive-dashboard and wide-table "Jan | Jul" for a year, lines-by-series and stacked-area-100 (before
      its `count`) "Jan 2024 | Apr 2024" for five or six months. A count from the labels' measured width (as a band's
      `fits`, shared with the grid), capped so a wide desk does not get ticks finer than the data, and a two-month step.
- [ ] The browsers dashboard (in `dashboards/`, not in the repository) now stops with an error on a diverging color
      domain `[-2.1, 0, 2.1]`: the stricter domain reading of 0.33.10 caught it. Fix the dashboard or accept such domains.

## The repository and the site

- [ ] **Try the plugin install from the marketplace** (`/plugin marketplace add boligolov/blockcharts`, then
      `/plugin install blockcharts@blockcharts`) in a fresh Claude Code session, now that `main` is pushed.
- [ ] **Deploy the site** to blockcharts.online (Cloudflare, see [site/README.md](site/README.md#deploy)), so that
      `blockcharts.online/blockcharts.skill` — the download the README and docs link to — exists.

## Release

- [ ] **`npm publish`** of 0.1.0, then check the kits through unpkg and jsDelivr.
- [ ] **Submit the plugin to Anthropic's directory** (see [docs/development.md](docs/development.md#listing-the-plugin-in-claudes-directory)).
      The owner's step, after the repository is public.

## Evals

First run on 2026-11-01: [test/evals/README.md](test/evals/README.md). All reports were correct with and without the
skill, which cost 44% more tokens and gave heavier pages. Still to do:

- [ ] **Evals where the skill should matter**: large data, zoom, facets, a long dashboard. The present four do not separate it.
- [ ] **The chart check of `grade.js`** counts `svg` and `canvas`, so bars in HTML and CSS fail it falsely.
- [ ] **Run the evals again on skill 0.19.0**, to see whether the fixes of what the agents reported changed the reports.
- [ ] **Gaps the agents reported that are left**: a recipe with a ratio of totals, a top N with a grand total; the gap before a
      KPI note is too wide after a change with a suffix; a KPI tile scales as a picture on a phone; `transform.filter` cannot
      keep only rows with no value; a table of rows.

## Business blocks

Done: KPI tiles (guide.kpi), waterfall, funnel, treemap, target lines and bullet charts (mark.rule, bar
`thickness`), the dashboard grid in `page.json`, and the dashboard look (see docs/Design.md). Still to do:

- [ ] **Table** (much later; there is a lot to it): its own design question — an HTML table rather than SVG text (scrolls, selects, prints as a
      table), sortable, number formats shared with axes and tooltips, optional bars or heat in cells.

## Chart types other libraries have

Compared on 2026-11-05 with the galleries of ECharts and Highcharts (also Chart.js, Plotly, ApexCharts, amCharts, Vega-Lite).
Maps and tables are left out; radar and sunburst stay not planned (see below). In this order:

Done: recipes of what the blocks already drew (Gantt, dumbbell and lollipop, error bars and a confidence band, stacked bars
with a line, a population pyramid). The two gaps of a time axis they showed are fixed in skill 0.22.0: on a narrow chart
`scale.time` takes a finer step when a coarse one leaves fewer than two labels, and `guide.grid` takes the `count` of its axis.

Done in skill 0.21.0: a gauge and a progress ring (`mark.arc` `endAngle`, `total`, `center`), a step line (`curve: "step"`),
a total, a share and a rank of the group on every row (`transform.window` ops `total`, `share`, `rank`) with a bump chart, a
streamgraph (`transform.stack` `center`). They left:

Done in skill 0.29.0: a value repeated on every row of its group is drawn once by mark.text and mark.point, as by mark.rule,
so `bars-and-line` writes the total over each stack. Its tooltip shows only the fields those rows share (`Pick.rows`).

- [ ] **Distributions**: done in skill 0.23.0, violins and ridgelines (`transform.density`, `mark.violin`). A beeswarm is `mark.point`
      `swarm`. Done in skill 0.30.0, hexbin (`transform.hexbin`, `mark.rect` `shape: "hexagon"`, `scale.sequential` `exponent`); in 0.31.0 density contours (`transform.contour`, `mark.polygon`). Left: contours per group (one chart holds one table, so contours cannot be drawn over their points either); a square 2D histogram (transform.bin of two fields, drawn as rect) would
      need no new mark. A violin with a box plot inside it is two tables, which one chart cannot hold.
- Not planned: force-directed networks, chords, word clouds, 3D, Venn diagrams, polar rose and radial bars (they read like
  radar); trees, dendrograms, packed circles and icicles only if a report asks for them; a waffle chart is rect + calculate.

## What the dashboards found

The browsers and oil dashboards were built with the skill as a plain user. Their log is `dashboards/oil/FINDINGS.md`
(not in the repository); this is its state.

Done: every bug found (skill 0.13.1, 0.14.0), locale and `lang` on a page, section and chart, translatable UI strings,
facets (skill 0.15.0), Sankey (skill 0.16.0), candlesticks, calendar heatmaps and Marimekko (skill 0.17.0), the smaller gaps
(skill 0.18.0).

Missing chart kinds:

- [ ] **Table with sparklines**: put off on 2026-11-01, see Table above.
- Not planned: radar (a heatmap reads better), sunburst, a choropleth map (excluded by design).

Smaller gaps:

- [ ] End labels of a log axis land on the axis: not reproduced after `nice` was fixed in `scale.log`. Needs the chart that showed it.

Checked in Chrome on 2026-11-01, light and dark, with no console errors: the oil dashboard (hover, 12 legend filters, zoom, a
phone at 390 px); facets and Marimekko on SVG and canvas; upright titles on canvas; the Sankey node tooltip by touch; a calendar
faceted by year; legend filters of facets and Marimekko on both renderers; Sankey, Marimekko, candlesticks and a calendar in the
oil dashboard.

Not checked yet: fonts outside Windows, Safari, a review of the CJK text by native speakers (Claude read the notes, but not
the labels inside the charts, and it is no native speaker).

## Password-protected reports

- [ ] **Encrypt the whole page** (`compose --encrypt`): the charts, specs, notes and data go gzip → AES-256-GCM →
      base64 through WebCrypto, the key comes from a password by PBKDF2, and the file holds only a password form and
      the sealed block. Encrypting the datasets alone is not enough: titles, notes and field names stay readable.
      - The password comes from the environment (`BC_PASSWORD`), never from `page.json` or the page. The composer
        checks the plain specs first and encrypts last.
      - WebCrypto was probed on 2026-11-01 with 600 000 PBKDF2 iterations: `file://` and `localhost` work in Chrome 156,
        Edge 156 and Firefox 136; a wrong password and a changed byte are both rejected. Plain `http://` on a network
        address has no `crypto.subtle`, so such a page has to say why it cannot open. **Safari is not checked yet.**
      - To say plainly in the docs: a file can be attacked offline, so the password has to be long; access cannot be
        revoked once someone has the file and the password.
      - Tests: wrong password, damaged data, truncated data, `</script>` in the content, no `crypto.subtle`.

## Research

- [ ] **What in the core not every page needs.** The core goes on every page whatever its charts, and it has grown with
      them (about 2,200 lines in `src/core.ts`). Two build switches already drop what a composed page does not need:
      `CHECKS` (the validation the composer has already run) and `DECODE` (encoded data); see the top of `src/core.ts`
      and `CORE_VARIANTS` in `scripts/minify.js`. To find out:
      - how many bytes (minified and gzipped) each part of the core is, and which recipes reach it: the zoom pipeline
        (views, transforms that follow the view, `TransformView.fitting`), the responsive relayout (ResizeObserver), the
        layout of wide (CJK) text, number and date formatting, the error box;
      - for a part only some pages use, whether it becomes one more switch the composer turns off, or moves to a `lib.*`
        block that the blocks needing it `require`, as `lib.pointer` and `lib.ticks` are;
      - the same for the larger blocks: options few charts use (the spans of guide.axis for a Marimekko, the Sankey card
        and flows of interaction.tooltip).
      Worth doing only if the smallest page gets noticeably lighter (39.5 KB in the gallery): decide from the numbers.

## Ideas, not decided

- An MCP server with one tool, `compose_report`, for agents that cannot run `node`.
- Level 2 and 3 of the zoom pipeline (gesture preview, DOM patching by ref) — measurements show SVG does
  not need them yet.

## Working rules

- One logical change per commit. Commit messages end with the `Co-Authored-By` line.
- `main` is the default branch; larger work goes on a branch and is merged by the owner.
- Run `npm test` before every commit and read the last line of every suite: **a pipe (`| tail`) hides the
  exit code**.
- A change to `src/` or the composer is followed by `npm run skill`; a change to `skills/blockcharts/` bumps
  the skill's version (`SKILL.md` `metadata.version` and `plugin.json`).
- A new block comes with a recipe that uses it and tests that include hostile and boundary input; a new
  check is proven by breaking the code once and seeing the test fail.
- Layout, positioning and interactions are verified in a real browser, not only on the fake DOM.
