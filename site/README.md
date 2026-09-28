# blockcharts.online

The website: a landing page for the skill (the main product) and a developer section — live examples of every
recipe, the ways to embed charts in your own pages, the guide and the block reference. Built with
[Astro](https://astro.build): plain HTML and CSS at build time, no framework runtime in the browser. Same
section structure as asciicharts.online (hero with install, principles, features, ways in, numbers, gallery),
designed for people who read business reports: light by default, one blue accent, Inter (self-hosted), dark
theme on request or from the system.

## Nothing on it is typed in by hand

- Every chart is drawn live by the released blocks (`public/release/`), from the recipes of the skill.
- Every size — the core, the kits, the loader, the code in each composed report — is read from the release
  manifest and from the composer's output at build time.
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
and validates every chart on every page against that page's data.

## Deploy

`dist/` is a plain static site. It is meant for Cloudflare Workers (`wrangler.jsonc`): build command
`npm ci && npm --prefix site ci && npm run site` from the repository root, deploy command
`npx wrangler deploy --config site/wrangler.jsonc`. Any static host works the same way.

## Structure

```
src/
  layouts/Base.astro       html shell, meta tags, header and footer, theme, copy buttons and tabs
  components/              Hero, BlockMap, Install, HowItWorks, Stats, Customize, Principles, Features, WaysIn, Gallery;
                           Card, Snippet, Highlight, Logo
  pages/index.astro        the landing page, assembled from the components
  pages/privacy.astro      what is collected: nothing
  pages/examples, embed, guide.astro, blocks.astro   the developer section
  lib/site.mjs             everything the pages read from the repository
  lib/highlight.mjs        code highlighting at build time (Shiki), JSON inside HTML snippets included
  styles/site.css          theme tokens (light, dark), landing sections, developer pages
```
