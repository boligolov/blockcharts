# Development

## Repository layout

```
skills/blockcharts/     the skill — the main product: SKILL.md, README.md, recipes/ (written by hand),
                        LICENSE, reference/, runtime/ (generated, committed), .claude-plugin/plugin.json
src/                    the library in TypeScript: bc.d.ts (contracts), core.ts, loader.ts,
                        blocks/<role>.<type>.ts — one file per block,
                        frameworks/*.mts — the React, Vue and Svelte wrappers and <block-chart> (tsconfig.frameworks.json)
scripts/                build, compose, release, site and test scripts (plain Node; the composer needs nothing else)
  compose.js              the composer: page.json -> one HTML file (also shipped inside the skill)
  build-manifest.js       dist/manifest.json, by running every built block against a stub BC
  minify.js               dist/min/ — the minified code the composer, the skill and the release use
  build-skill.js          the skill's generated parts, dist/blockcharts.skill, --check
  build-dist.js           release/ — kits, single blocks, the loader, the schemas, the wrappers, the manifest with SRI hashes
  build-schema.js         the JSON Schemas of a chart spec and of a page.json, made from the manifest
  build-docs.js           the figures README.md and the principles quote (sizes, counts, kits), --check
  sizes.js                what code weighs: the one definition the site, the docs and the release use
  site-prebuild.js        what the site needs before Astro runs; check-site.js checks the built site,
                          check-site-phone.js opens it in Chrome at phone widths (npm run test:site)
  site-demos.js           the site's embedding examples; og-image.js the link-preview image (npm run og)
  csv.js                  CSV parsing for the composer (also shipped inside the skill)
  encode-columns.js       binary columns for long numeric series from a pipeline
  test*.js                the test suites (below); fake-dom.js and run-page.js are their browser stand-ins
docs/                   the documentation (an index: docs/README.md)
  spec/                   the principles (principles.md) and their CHANGELOG.md
  skill.md                installing the skill
  development.md          this file
  Design.md               the design journal: every decision and why
site/                   blockcharts.online (Astro, its own package.json, a workspace of the root); serves the skill's download
test/apps/              six apps made by the real toolchains (Vite + React, Vite + Vue, SvelteKit, Next.js, Angular CLI,
                        plain JavaScript), with their own package.json and lockfile, not a workspace: npm run test:apps
test/bench/             the same charts drawn by blockcharts and seven other libraries, timed in Chrome: npm run bench
.claude-plugin/         the Claude Code plugin marketplace (one plugin: the skill)
.github/workflows/      ci.yml: format check, npm test, the Chrome suites and npm run site on every push and pull request;
                        apps.yml: npm run test:apps, when the library, the scripts or the apps change
kits.json               which blocks each kit contains
wrangler.jsonc          Cloudflare's configuration for the site (it deploys site/dist; site/README.md, Deploy)
LICENSE  README.md  ROADMAP.md  package.json  package-lock.json (the site's too)  tsconfig*.json  .node-version
```

Built output is never committed, except the skill's generated parts (the plugin marketplace installs the
folder straight from git, so it must be complete): `dist/` (tsc output, manifest, `min/`, the `.skill`),
`release/`, `site/dist`, `site/public/release`, `site/public/examples`, `site/public/blockcharts.skill`.

## Setup

The library and the composer run on Node.js 22+ (`engines`); the site needs 22.22.1 or later, and `.node-version` (24) is what
the project is developed and built on (CI, Cloudflare). The library has no runtime dependencies; the dev dependencies are
TypeScript, esbuild (minification), fflate (the `.skill` zip and every gzip size), Prettier (formatting),
playwright-core (the checks in the system Chrome: `npm run test:chrome`, `npm run test:frameworks`, `npm run test:site`,
`npm run test:apps`, `npm run bench`, `npm run og`), Ajv (the schemas' test) and React, React DOM, Vue and Svelte, which the wrappers
are tested with; for an app that uses a wrapper, its framework is an optional peer dependency. The toolchains of
`test/apps` (Vite, SvelteKit, Next.js, Angular CLI) are that folder's own (`npm ci --prefix test/apps`), and so are
the libraries `npm run bench` compares blockcharts with (`npm ci --prefix test/bench`).
The site is an npm workspace of the root (`site/package.json` lists its dependencies), so one install, into one
`node_modules`, from one lockfile, sets up both. `allowScripts` in package.json lets esbuild run its install script and
not sharp, which comes with Astro and which the site does not use (npm 11 runs no dependency's install script unlisted).

```sh
npm install
npm test
```

## Formatting

The sources (`src/`, `scripts/`, the site's `.mjs` and `.css`) are formatted by Prettier, configured in
`.prettierrc.json`. `npm run format` rewrites them, `npm run format:check` (run by CI) fails on a file it
would change. Generated code and the skill's runtime copy are not formatted.

## Tests

`npm test` builds (`tsc`, also for `tsconfig.frameworks.json`), makes the manifest and the minified code, then runs seven suites. Read the last
line of each: `N of N passed`.

| suite | what it checks |
|---|---|
| `test.js` (+ `test-blocks.js`, `test-data.js`, `test-business.js`, `test-edges.js`) | the core and every block on a fake DOM: validation, scales, marks, guides, interactions, zoom, encoded and binary data |
| `test-canvas.js` | the canvas renderer against a recording 2D context |
| `test-compose.js` | the composer: block choice, validation with paths, escaping, compression, determinism, hostile input |
| `test-csv.js` | CSV in a page: parsing, types, errors naming the dataset |
| `test-skill.js` | the skill: front matter, the committed folder equals a fresh build, every recipe composes and draws with the packaged runtime, the recipes use every block, the plugin and marketplace, `claude plugin validate`, the `.skill` zip |
| `test-dist.js` | the release: manifest sizes and SRI hashes, determinism, kits, the loader, the wrappers' files and exports, minified code drawing the same as the source; the figures README and the principles quote |
| `test-schema.js` | the JSON Schemas: strict Ajv, every recipe valid, the keys and presets the core and the composer know, broken specs and pages refused by the schema and by the core or the composer at the same path |

The fake DOM cannot see layout: `getBoundingClientRect` and `getComputedStyle` are stubs. Anything about
positions, overlays or two interactions sharing the chart's host element is checked in a real browser too:
`npm run test:chrome` (`scripts/test-chrome.js`, also run by CI) composes pages, opens them in the system
Chrome through playwright-core and measures where things land, at phone and desk widths. `npm run test:frameworks`
(`scripts/test-frameworks.js`, also run by CI) bundles each wrapper of the release with its real framework, runs it in
Chrome (React in StrictMode), clicks a bar, puts three charts on one page (two sharing a dataset of the app: each
click reaches its own chart, one chart redrawn or taken away leaves the others as they were), renders React and Vue on
a server and compiles an app's code against the types.

`npm run test:apps` (`scripts/test-apps.js`, after `npm ci --prefix test/apps`) goes further, with the toolchains an
app is really made with: the tarball `npm pack` makes, unpacked into `test/apps/node_modules`, used by six apps
(Vite + React, Vite + Vue single-file components, SvelteKit prerendered, Next.js App Router rendered on the server,
Angular CLI with `<block-chart>`, plain JavaScript). Each is built for production by its own CLI and run on its dev
server, and checked in Chrome on the same page of three charts, with nothing in the console (hydration included);
for SvelteKit and Next.js the server's HTML is checked too. Then each draws every chart of every recipe (71, and five
times that), mounted, given new data and unmounted three times, and the run prints what each phase takes, the heap
and the DOM of the charts, and what is left after: a dataset a component made, a DOM node, an event listener, or heap
that grows with every cycle by more than a chart's share fails it. See [test/apps/README.md](../test/apps/README.md).

`npm run bench` (`scripts/bench.js`, after `npm ci --prefix test/bench`) is not a test: it times blockcharts against
Chart.js, ECharts, uPlot, Observable Plot, Recharts, ApexCharts and Plotly drawing the same charts (bars and a line,
with axes and a tooltip) in Chrome, 1, 20 and 355 of them, in rounds of shuffled runs (`--runs=100`), and prints the
medians and quartiles of the time to a painted frame, the main thread's time, the heap, the DOM and the gzipped JS.
`--cpu=4` slows the CPU down as DevTools does. Run it on a quiet machine. `--save` keeps the figures in
`test/bench/results.json` (and `results-cpu4.json`), which the site's `/benchmarks/` page shows; the page checks
what it says against them, so a run that no longer supports it stops `npm run site`. See
[test/bench/README.md](../test/bench/README.md).

A new block needs a recipe (or a feature in one) that uses it — `test-skill.js` fails otherwise — and a
test proving each new check can fail. An interaction that sends events to a script of the page (it declares
`events`, as `interaction.click` does) is the exception: a report has no such script, so no recipe may use it. On the site a new block needs its line in `BLOCK_SUMMARY` and a new
recipe its kind in `GALLERY` (both in `site/src/lib/catalog.mjs`): `npm run site` stops without them.

Code that two blocks would both carry goes into a lib block (`src/blocks/lib.*.ts`). A block lists it in
`requires` and reaches it through `BC.get('lib.…').exports` when it runs. `test-dist.js` fails when two
compiled blocks share a run of 300 characters of the same code.

## The skill

`skills/blockcharts/` is committed complete. `SKILL.md`, `README.md`, `.claude-plugin/plugin.json` and
`recipes/` are edited in place; `LICENSE`, `reference/blocks.md` and `runtime/` are generated:

```sh
npm run skill                         # refresh the generated parts, write dist/blockcharts.skill
node scripts/build-skill.js --check   # exit 1 if the committed folder differs from a fresh build (a test does this)
```

So after any change to `src/`, to the composer, or to the root `LICENSE`, run `npm run skill` and commit
what it changes. It also rewrites the figures that README.md and `docs/spec/principles.md` quote (what the core,
the blocks, the kits and four example pages weigh, how many blocks and recipes there are): each stands between
`<!-- build:name -->` and `<!-- /build -->`, and `test-dist.js` fails while one is not the build's
(`node scripts/build-docs.js --check`). A size that says gzip is fflate's at level 9 everywhere, the same bytes on
every machine.

## Releasing

### A new version of the skill

The skill has a version in two places that must agree (a test checks): `metadata.version` in `SKILL.md`'s
front matter and `version` in `skills/blockcharts/.claude-plugin/plugin.json`. Claude Code offers plugin
users an update only when that version goes up, so **every change to `skills/blockcharts/` bumps it**
(`0.1.1` for a fix or a wording change, `0.2.0` for something new) — including a regenerated runtime. Then
deploy the site, which serves the new `blockcharts.skill`.

### The npm package and the CDN files

The library's version is `version` in `package.json` and `VERSION` in `src/core.ts` (the release build refuses
to run while they differ). `npm pack` / `npm publish` build `release/` first (`prepack`). Files of a published version never
change; a CDN path always names a version.

### The site

blockcharts.online is built by `npm run site` from the repository root: the library, the release, the
composed example reports and the skill's download, then Astro, then `scripts/check-site.js` (links, scripts,
anchors, and every chart on every page validated against its data). The output is `site/dist`, a plain
static site. `npm run test:site` (also run by CI) then opens every page in the system Chrome at 320, 360 and 390
px and fails on a page wider than the screen or a table that scrolls sideways. To look at it locally, `npm run dev`
builds the library and starts Astro's dev server with live reload, and `npm run serve` builds the site as above and
serves `site/dist`; both at http://localhost:4321/. See [site/README.md](../site/README.md).

### Listing the plugin in Claude's directory

Anthropic's directory is the catalogue people browse on claude.ai; submit from
[claude.ai/directory/manage](https://claude.ai/directory/manage): repository `boligolov/blockcharts`, plugin
path `skills/blockcharts`. The listing page is `skills/blockcharts/README.md` (at least 40 words outside code
blocks; it must say everything the plugin runs, sends or fetches — a test checks the basics). The repository
must be public; raise the version with every change.
