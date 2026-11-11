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

Done (skill 0.33.1–0.33.32): A, safety (5); B, silent wrong results in validation and data (21); C1–C18, layout
and interaction (end labels, zoomed picks, step lines, bars on a time axis, a target's label, CJK breaks, Sankey, legends,
vertical axis names, tooltip cards, the edge dot, the real-Chrome suite `npm run test:chrome`, text the same size in
every card, a waterfall's figures on a phone, a Marimekko's column names, hexbins inside the plot, a Gantt's first
month, an axis's top label, the color of a tooltip's dot, cards on error bars, dumbbells and lollipops).

Left, in this order:

- [ ] **C19** KPI tile: `phoneColumns: 2` shrinks it to 66% (highlight-bar); stretched with an empty bottom on a desk;
      the executive Orders / Conversion / Churn tiles have no tooltip; phone tiles are about 300 px tall.
- [ ] **C20** Treemap: Latin America cells unlabelled (`labelMin` 0.03); legend items have uneven gaps (treemap,
      streamgraph). The cells are laid out for `aspect`, not for the plot: on a phone (a plot of 324 × 400) they are
      about three times taller than wide. Read the plot's aspect when none is given, as hexbin does.
- [ ] **D1** Charts are `role="img"` with no name (renderer.svg, renderer.canvas); the legend filter cannot be reached
      by keyboard (guide.legend, interaction.legend-filter).
- [ ] **D2** Site: `--faint #8b93a1` is 2.8–3.1:1 in light, 4.43:1 in dark (site.css).
- [ ] **D3** Site: 51 pages skip a heading level; no skip link; every copy button says only "Copy".
- [ ] **E1** Tooltips show internals and raw values: highlight-bar (ISO date, raw number, a helper field), waterfall
      `value1` (executive too), boxplot outlier "count 10" and q1/q3/low/high, histogram bin0/bin1, bars-and-line
      quarterTotal/line, funnel stepRate "–", moving-average avg7/toDate, dumbbell y2024/y2025, pie/donut "share 19"
      with no %, dual-axis "month 1", error-bars forecast "– – –", scatter-large axis titles x/y, scatter-groups A/B
      with no axis titles. Some are block defaults (the helper fields of waterfall and stack), some are the recipes.
- [ ] **E2** Recipes against SKILL.md's own advice: dashboard (custom css, no layout, teal points on a blue line, a
      scatter with no axis titles), report-from-csv (same colors; the bar axis is not currency; on a phone the line has
      only Jan/Apr), dual-axis (no legend, no axis titles), stacked-area-100 (0.0–1.0, not %).
- [ ] **E3** Recipe notes are prose for the agent but are shown to readers under the charts (example pages,
      downloadable reports): backticks, "transform.stack", "NaN". Decided: a separate field for the caption a reader
      sees, so notes stay for the agent; its semantics are still to settle.
- [ ] **E4** SKILL.md: the inline CSV example has literal newlines inside a JSON string.
- [ ] **E5** SKILL.md: `runtime/encode-columns.js` is named as a tool but has no CLI.
- [ ] **E6** SKILL.md: the KPI paragraph comes before the `kpi` guide is introduced and has a sentence with no verb;
      the zoom paragraph is out of order too.
- [ ] **E7** The trigger description: leave out charts embedded in an app's own code; a hint for "table" requests (a
      heatmap with text).
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

- [ ] From 720 px to about 1050 px (a tablet, a narrow window) a grid of 4 columns makes cards narrower than 200 px (136 at 800): the
      KPI tiles and the donut of executive-dashboard are laid out at 200 px and scaled down, text 7.5–8 px. The grid could
      take fewer columns in that range.
- [ ] calculated-field on a phone: the figures over its eight quarters are 9.5 px (profit) and 9 px (margin); eight bars
      in 324 px with figures at nearly one height. Like the waterfall, a figure on every bar could take the value axis's
      place.
- [ ] Date categories on a band axis are thinned by the width of the whole label on one line, so twelve months in
      Japanese show every other month on a desk although "2024年 / 1月" on two lines would fit (guide.axis `fitWritten`).
- [ ] In a wider font than the widths labels are laid out by (Verdana; DejaVu Sans, the sans-serif of many Linux
      desktops and of CI) some labels reach out of the chart sideways: marimekko "100%" by 3.4 px, top-n "Echo shelf" 1.2,
      small-multiples "Apr" 0.9, executive and waterfall "Revenue" at 45° 0.8, stacked-area-100 and bullet 0.6–0.7. The
      Chrome suite checks only up and down for that reason.
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
