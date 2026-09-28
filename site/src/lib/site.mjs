// What the pages know about the library: recipes, the release that was built for the site, the block manifest.
// Everything comes from files of the repository, so the site cannot describe something that does not exist.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const { resolveDataset, jsonForScript, escapeText } = require(path.join(repo, 'scripts', 'compose.js'));
const { embedPages } = require(path.join(repo, 'scripts', 'site-demos.js'));

export { jsonForScript, embedPages };
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
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
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
    charts.set(r.name, r.charts.map((c) => ({ ...c, spec: { ...c.spec, data: `${r.name}:${c.spec.data}` } })));
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

/** The repository, for links to its files: blob/HEAD and tree/HEAD follow the default branch. */
export const REPO = 'https://github.com/boligolov/blockcharts';
export const repoFile = (p) => `${REPO}/blob/HEAD/${p}`;
export const repoTree = (p) => `${REPO}/tree/HEAD/${p}`;
/** Where the site lives, for canonical URLs and link previews. */
export const SITE = 'https://blockcharts.online';

/**
 * The three steps on the landing page, made by the real composer: the blocks a small spec needs, and the error it
 * reports for a misspelt field. If the composer changes its wording or its choice of blocks, the page changes with it.
 */
export function composeDemo() {
  const { compose } = require(path.join(repo, 'scripts', 'compose.js'));
  const data = { orders: [{ region: 'North', revenue: 42 }, { region: 'South', revenue: 58 }] };
  const spec = { data: 'orders', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'region', y: 'revenue' }], interaction: [{ type: 'tooltip' }] };
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
 * Sizes of the code exactly as a composed page carries it (dist/min: minified, no banner): the core, with its gzip
 * size, and every block. The composer's report sizes are sums of these, so every number on a page agrees.
 */
export function loadPageCode() {
  const zlib = require('node:zlib');
  const dir = path.join(repo, 'dist', 'min');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const core = fs.readFileSync(path.join(dir, m.core.file));
  const blocks = Object.entries(m.blocks).map(([name, b]) => ({ name, bytes: b.bytes }));
  return { core: { bytes: core.length, gzip: zlib.gzipSync(core, { level: 9 }).length }, blocks, all: core.length + blocks.reduce((n, b) => n + b.bytes, 0) };
}
