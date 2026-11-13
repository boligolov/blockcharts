# blockcharts.online

The website: a landing page for the skill (the main product) and a developer section — a gallery of every
recipe, grouped by kind of chart and each with the blocks it is built from and what they weigh, the ways to embed charts in your own pages, the guide and the block reference. Built with
[Astro](https://astro.build): plain HTML and CSS at build time, no framework runtime in the browser. Same
section structure as asciicharts.online (hero with install, principles, features, ways in, numbers, gallery),
designed for people who read business reports: light by default, one blue accent, Inter (self-hosted), dark
theme on request or from the system.

## Nothing on it is typed in by hand

- Every chart is drawn live by the released blocks (`public/release/`), from the recipes of the skill.
- Every size — the core, the kits, the loader, the code in each composed report — is read from the release
  manifest and from the composer's output at build time.
- The weight under every example is the core and the blocks the composer put into its report, in bytes of
  `dist/min`; the build stops unless they add up to the composer's own count (`codeOf` in `src/lib/site.mjs`).
- The "How it works" spec, its list of blocks and its error message are made by the real composer
  (`composeDemo` in `src/lib/site.mjs`).
- The block map counts the blocks the hero report really carries; all code sizes are those of `dist/min`, the
  code the composer puts into a page, so every number on the site agrees with every other.
- The download, `public/blockcharts.skill`, is packed from `skills/blockcharts/` — and only while that folder
  is current.

## Build

From the repository root, not from here: the site is made from the library.

```sh
npm run site                          # the library, the release, reports, the skill zip, Astro, then scripts/check-site.js
SITE_BASE=/blockcharts/ npm run site  # served from a subfolder
cd site && npm run dev                # develop (run npm run build and npm run manifest in the root first)
```

`scripts/site-prebuild.js` writes `public/release/`, `public/examples/`, `public/blockcharts.skill` and
`src/data/reports.json` (all ignored by git). `scripts/check-site.js` then checks every link, script and anchor,
validates every chart on every page against that page's data, and checks what search engines read (below).

## Search engines and link previews

- Every page has its own title and description (70–200 characters, no markup), a canonical URL on
  `SITE` (`scripts/site-prebuild.js`), Open Graph and Twitter tags, one h1, and JSON-LD: the project on the
  landing page, breadcrumbs on the others.
- `sitemap-index.xml` comes from `@astrojs/sitemap` and lists exactly the indexable pages; `public/robots.txt` names it.
- A composed report (`examples/<name>.report.html`) is a download: `noindex`, with its example page as canonical.
- The link-preview image, `public/og.png` (1200×630, committed), is a screenshot of the landing hero in Chrome.
  It shows the hero's sizes (the blocks of the dashboard, its code, the core), which move with the code, so make it
  again before a deploy, and when the hero changes: `npm run site && npm run og`.

All of it is checked by `scripts/check-site.js`. On a phone: `npm run test:site` (`scripts/check-site-phone.js`, run
by CI, not by the build, as it needs Chrome) opens every page at 320, 360 and 390 px; none may be wider than the
screen, and no table may scroll sideways (a table of the site is `stack` or `sizes`, which check-site enforces).

## Deploy

`dist/` is a plain static site. It is meant for Cloudflare Workers, configured by `wrangler.jsonc` at the repository's
root, where the build runs: Root directory empty, build command `npm ci && npm --prefix site ci && npm run site`,
deploy command `npx wrangler deploy` (for a branch that is not production, `npx wrangler versions upload`), which are
Cloudflare's own and find the configuration there. check-site fails when it does not deploy `site/dist` or does not
serve `404.html` for an address the site does not have. Any static host works the same way. The site is made from the
library, so a host told to build `site/` alone (Root directory `site`, build command `npm run build`) stops at the
first step, `scripts/site-prebuild.js`, which says what is missing and these commands.

## Structure

```
src/
  layouts/Base.astro       html shell, meta tags, header and footer, theme, copy buttons and tabs
  components/              Hero, BlockMap, Install, HowItWorks, Stats, Customize, Principles, Features, WaysIn, Gallery;
                           GalleryCard, BlockChips, Weight, Snippet, Highlight, Logo
  pages/index.astro        the landing page, assembled from the components
  pages/privacy.astro      what is collected: nothing
  pages/examples, embed, guide.astro, blocks.astro   the developer section
  lib/site.mjs             everything the pages read from the repository, sizes included
  lib/catalog.mjs          the words about it: what each block does, the kinds of the gallery (every recipe in one)
  lib/highlight.mjs        code highlighting at build time (Shiki), JSON inside HTML snippets included
  styles/site.css          theme tokens (light, dark), landing sections, developer pages
```
