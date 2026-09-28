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
- [ ] **A link-preview image** (`og.png`, 1200×630) from a real hero screenshot; `Base.astro` has the Open Graph
      tags but no image yet.

## Release

- [ ] **`npm publish`** of 0.1.0, then check the kits through unpkg and jsDelivr.
- [ ] **Submit the plugin to Anthropic's directory** (see [docs/development.md](docs/development.md#listing-the-plugin-in-claudes-directory)).
      The owner's step, after the repository is public.

## Evals

- [ ] **Skill evals** as in asciicharts (`test/evals/`): realistic report requests (sales from a CSV, monthly
      KPIs, a dashboard of four charts, dirty numbers), run with and without the skill by independent
      agents, graded by a script: the page composed without errors, the charts asked for are there, the
      numbers on them match the data, the page is small. Record the results in `test/evals/README.md`.

## Business blocks

After the repository and the site are done. Each is a block (or a few), with a recipe and tests:

- [ ] **KPI tile**: a number, its change against a previous period (up/down, colored by meaning), a sparkline.
- [ ] **Table**: sortable, number formats shared with axes and tooltips, optional bars or heat in cells.
- [ ] **More chart types** for business reports: funnel, waterfall (bridge), bullet chart (value against
      target), treemap, sparkline as its own small chart, and lines/bars against a target or threshold.
- [ ] **Dashboard layout** in `page.json`: a grid of tiles and charts instead of one column.

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
