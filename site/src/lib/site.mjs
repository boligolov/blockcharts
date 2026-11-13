// What the pages know about the library: recipes, the release that was built for the site, the block manifest.
// Everything comes from files of the repository, so the site cannot describe something that does not exist.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const { resolveDataset, jsonForScript, escapeText } = require(path.join(repo, 'scripts', 'compose.js'));
/** embedPages: the demo pages; cdnBase(version): where jsDelivr serves the release/ files of a published version. */
const { embedPages, cdnBase } = require(path.join(repo, 'scripts', 'site-demos.js'));
/** What code weighs, as the docs and the release say it (scripts/sizes.js): gzip sizes, the core of a report, everything. */
const sizes = require(path.join(repo, 'scripts', 'sizes.js'));
const { gzipSize } = sizes;

/** The version of the principles (their first paragraph) and of the skill (SKILL.md, plugin.json), as the files say. */
export const principlesVersion = () => require(path.join(repo, 'scripts', 'build-docs.js')).principlesVersion();
export const skillVersion = () => require(path.join(repo, 'scripts', 'build-skill.js')).skillVersion();

/** The roles of blocks, in the order a page loads them. */
export const { ROLES, scaleWords, scalesFitting } = require(path.join(repo, 'scripts', 'build-manifest.js'));

export { jsonForScript, embedPages, cdnBase };
export const esc = escapeText;
export const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const read = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8');

/** The URL prefix of the site, always with a trailing slash ("/" or "/blockcharts/"). */
export const baseUrl = (raw) => (raw.endsWith('/') ? raw : raw + '/');

export function loadRelease() {
  const file = path.join(repo, 'site', 'public', 'release', 'manifest.json');
  if (!fs.existsSync(file)) throw new Error('site/public/release not found: run npm run site (it builds the release first)');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The manifest with the docs of every block and parameter (the release one is small on purpose). */
export function loadBlocks() {
  return JSON.parse(read('dist', 'manifest.json'));
}

/** The size of the report file a reader downloads (code, data, styles and page), as the prebuild wrote it. */
export function reportFileBytes(name) {
  return fs.statSync(path.join(repo, 'site', 'public', 'examples', `${name}.report.html`)).size;
}

/** The bytes of code (core and blocks) in each composed report, by recipe. */
export function loadReportSizes() {
  return JSON.parse(fs.readFileSync(path.join(repo, 'site', 'src', 'data', 'reports.json'), 'utf8'));
}

export function loadRecipes() {
  const dir = path.join(repo, 'skills', 'blockcharts', 'recipes');
  const need = {};
  const order = [];
  for (const m of read('skills', 'blockcharts', 'SKILL.md').matchAll(/^\|\s*([^|]+?)\s*\|\s*`recipes\/([\w-]+)\.json`\s*\|/gm)) {
    need[m[2]] = m[1];
    order.push(m[2]);
  }
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  const missing = order.filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`SKILL.md lists recipes that do not exist: ${missing.join(', ')}`);
  return order.concat(names.filter((n) => !order.includes(n)).sort()).map((name) => {
    const text = fs.readFileSync(path.join(dir, name + '.json'), 'utf8');
    const page = JSON.parse(text);
    const charts = page.charts.map((c) => (c.spec ? c : { spec: c }));
    const data = {};
    for (const [n, input] of Object.entries(page.data)) data[n] = resolveDataset(n, input, dir);
    return { name, text, page, charts, data, title: page.title, need: need[name] || page.title };
  });
}

/** Datasets of several recipes in one page: names are prefixed so that two recipes can both have a "sales". */
export function lakeOf(recipes) {
  const lake = {};
  const charts = new Map();
  for (const r of recipes) {
    for (const n of Object.keys(r.data)) lake[`${r.name}:${n}`] = r.data[n];
    charts.set(
      r.name,
      r.charts.map((c) => ({ ...c, spec: { ...c.spec, data: `${r.name}:${c.spec.data}` } })),
    );
  }
  return { lake, charts };
}

/** The blocks of every chart of a recipe, and the smallest kit that holds them all. */
export function kitFor(recipe, release, blocksOf) {
  const blocks = blocksOf(recipe);
  const fits = Object.entries(release.kits).filter(([, k]) => blocks.every((b) => k.blocks.includes(b)));
  fits.sort((a, b) => a[1].js.bytes - b[1].js.bytes);
  return { name: fits[0][0], blocks };
}

/** Blocks a recipe needs, asked of the core itself (the same way the composer does). */
export function blocksNeeded(recipe) {
  const { compose } = require(path.join(repo, 'scripts', 'compose.js'));
  return compose({ ...recipe.page, baseDir: path.join(repo, 'skills', 'blockcharts', 'recipes') }).blocks;
}

const recipesDir = path.join(repo, 'skills', 'blockcharts', 'recipes');
let minManifest;
const minOf = () => (minManifest ||= JSON.parse(read('dist', 'min', 'manifest.json')));

/** What a composed page carries, split into its parts: the core the composer picked and each block (role order), in
 *  bytes of dist/min, the files it inlines. Their sum must be the composer's own count, or the build stops. */
function weigh(composed, what) {
  const m = minOf();
  const variant = Object.entries(m.core.variants || {}).find(([, v]) => v.file === composed.core);
  const core = { name: variant ? `core.${variant[0]}` : 'core', bytes: variant ? variant[1].bytes : m.core.bytes };
  const blocks = composed.blocks.map((name) => ({ name, role: name.split('.')[0], bytes: m.blocks[name].bytes }));
  const bytes = core.bytes + blocks.reduce((n, b) => n + b.bytes, 0);
  if (bytes !== composed.bytes)
    throw new Error(`${what}: the core and the blocks add up to ${bytes} bytes, the composer counts ${composed.bytes}`);
  return { core, blocks, bytes };
}

const composedCache = new Map();
/** The composer's result for a recipe, made once per build. */
function composedOf(recipe) {
  if (!composedCache.has(recipe.name)) {
    const { compose } = require(path.join(repo, 'scripts', 'compose.js'));
    composedCache.set(recipe.name, compose({ ...recipe.page, baseDir: recipesDir }));
  }
  return composedCache.get(recipe.name);
}

const codeCache = new Map();
/** The code of a recipe's report (all its charts): { core, blocks, bytes }. */
export function codeOf(recipe) {
  if (!codeCache.has(recipe.name)) codeCache.set(recipe.name, weigh(composedOf(recipe), `recipe ${recipe.name}`));
  return codeCache.get(recipe.name);
}

/**
 * What a recipe's report shows, entry by entry, as the composer settled it (a facet becomes its panels on shared
 * scales, with one legend). `prefix` renames the datasets and shared legends to `<recipe>:<name>`, for a page that
 * holds several recipes (lakeOf).
 */
export function entriesOf(recipe, prefix = false) {
  const entries = composedOf(recipe).entries;
  if (!prefix) return entries;
  const legend = (id) => (id ? `${recipe.name}-${id}` : id);
  const respec = (spec) => ({
    ...spec,
    data: `${recipe.name}:${spec.data}`,
    ...(spec.interaction ? { interaction: spec.interaction.map((x) => (x.legend ? { ...x, legend: legend(x.legend) } : x)) } : {}),
  });
  return entries.map((e) =>
    e.panels
      ? { ...e, legendId: legend(e.legendId), panels: e.panels.map((p) => ({ ...p, spec: respec(p.spec) })) }
      : e.spec
        ? { ...e, spec: respec(e.spec) }
        : e,
  );
}

/** The code one chart of a recipe would need on a page of its own (an entry of recipe.page.charts). */
export function chartCodeOf(recipe, entry, i) {
  const key = `${recipe.name}#${i}`;
  if (!codeCache.has(key)) {
    const { compose } = require(path.join(repo, 'scripts', 'compose.js'));
    codeCache.set(key, weigh(compose({ ...recipe.page, charts: [entry], baseDir: recipesDir }), `chart ${i} of ${recipe.name}`));
  }
  return codeCache.get(key);
}

/** Everything: the most a composed page can carry, the core with the data decoder and every block there is. Every page
 *  of the site that compares a report with the whole library compares it with this, and so do the docs. */
export const libraryCode = () => sizes.libraryCode();

/** The repository, for links to its files: blob/HEAD and tree/HEAD follow the default branch. */
export const REPO = 'https://github.com/boligolov/blockcharts';
export const repoFile = (p) => `${REPO}/blob/HEAD/${p}`;
export const repoTree = (p) => `${REPO}/tree/HEAD/${p}`;
/** Where the site lives, for canonical URLs and link previews (set in scripts/site-prebuild.js). */
export const { SITE } = require(path.join(repo, 'scripts', 'site-prebuild.js'));

/**
 * The three steps on the landing page, made by the real composer: the blocks a small spec needs, and the error it
 * reports for a misspelt field. If the composer changes its wording or its choice of blocks, the page changes with it.
 */
export function composeDemo() {
  const { compose } = require(path.join(repo, 'scripts', 'compose.js'));
  const data = {
    orders: [
      { region: 'North', revenue: 42 },
      { region: 'South', revenue: 58 },
    ],
  };
  const spec = {
    data: 'orders',
    scales: { x: { type: 'band' }, y: { type: 'linear' } },
    marks: [{ type: 'rect', x: 'region', y: 'revenue' }],
    interaction: [{ type: 'tooltip' }],
  };
  const blocks = compose({ data, charts: [spec] }).blocks;
  let error = null;
  try {
    compose({ data, charts: [spec, { ...spec, marks: [{ type: 'rect', x: 'region', y: 'revnue' }] }] });
  } catch (e) {
    const d = (e.diagnostics || [])[0];
    if (d) error = `${d.path}:\n  ${d.message}`;
  }
  if (!error) throw new Error('composeDemo: the misspelt field was not reported');
  return { spec, blocks, error };
}

/**
 * Sizes of the code exactly as a composed page carries it (dist/min: minified, no banner): the core most reports carry
 * (the composer has run the checks, and no dataset is stored gzipped), with its gzip size, and every block. The
 * composer's report sizes are sums of these, so every number on a page agrees.
 */
export function loadPageCode() {
  const core = sizes.reportCore();
  return { core: { bytes: core.length, gzip: gzipSize(core) }, blocks: sizes.blockSizes() };
}

/**
 * What each piece weighs: the TypeScript source (with its comments and docs), the minified file a page carries,
 * and that file gzipped (as a web server sends it; inside one page the blocks compress better together). The core comes in
 * the variants the composer picks from (minify.js).
 */
export function loadSizes() {
  const dir = path.join(repo, 'dist', 'min');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const sizes = (file, src) => {
    const min = fs.readFileSync(path.join(dir, file));
    return { source: fs.statSync(path.join(repo, 'src', src)).size, min: min.length, gzip: gzipSize(min) };
  };
  const core = [{ name: 'core', ...sizes(m.core.file, 'core.ts') }];
  for (const [name, v] of Object.entries(m.core.variants || {}))
    core.push({ name: `core.${name}`, off: v.off, ...sizes(v.file, 'core.ts') });
  const blocks = Object.entries(m.blocks).map(([name, b]) => ({
    name,
    role: name.split('.')[0],
    version: b.version,
    requires: b.requires,
    ...sizes(b.file, `blocks/${name}.ts`),
  }));
  return { core, blocks };
}

/**
 * The HTML of a script tag, for the snippets a page shows (not for scripts it runs). It is built here, in a plain module,
 * because Vite's dependency scan reads every <script src> it finds in the text of an .astro file — also one inside a
 * string — and fails the dev server on a path it cannot resolve (a relative release/..., a placeholder .../loader.js).
 * `lines` puts each attribute on its own line, indented.
 */
export function scriptTag(src, attrs = {}, lines = false) {
  const parts = [`src="${src}"`, ...Object.entries(attrs).map(([k, v]) => (v === true ? k : `${k}="${v}"`))];
  const sep = lines ? '\n        ' : ' ';
  return '<' + 'script ' + parts.join(sep) + '></' + 'script>';
}
