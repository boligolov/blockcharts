# Roadmap

What is still to do. Done work is in the git history and in [docs/Design.md](docs/Design.md); how the
project is laid out and tested is in [docs/development.md](docs/development.md). Remove an item in the same
commit that finishes it.

The skill (`skills/blockcharts/`) is the main product; the principles (`docs/spec/`), the library (`src/`)
and the ways to ship it (composer, kits, loader, npm) serve it.

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

## Block audit

Audited on 2026-11-01. Scales, transforms and renderers are clean; these are the leaks, in the order to fix them:

- [ ] **The layout of `mark.sankey`** moves to a transform, as treemap, funnel and Marimekko have it.
- [ ] **Marks name the scale types they accept** (`scales: ['linear', 'log', 'time', 'band']` on a channel), so a scale
      block of a new name fits no built-in mark. A scale could declare what it is (positional, a number, categories) and a
      channel accept that.

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
      `swarm`. Left: hexbin and density contours; a square 2D histogram (transform.bin of two fields, drawn as rect) would
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
