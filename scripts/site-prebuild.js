// Everything the site needs from the library, made before Astro runs (node scripts/site-prebuild.js):
//   site/public/release/                 the real kits, loader and blocks, so every page loads them from its own origin
//   site/public/examples/<name>.report.html   what the composer makes from each recipe
//   site/src/data/reports.json           { name: bytes } of those reports, for the pages
//   site/src/data/palette.css            the chart colors: the core's light palette and the composer's dark one
//   site/public/blockcharts.skill        the agent skill as an uploadable zip, the download the site links to
// Needs `npm run build && npm run manifest` first (the site scripts in package.json do it). Run from site/ alone, where
// the root's dependencies are not installed, it says to build from the root (notReady), not that a module is missing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { compose, readPage, DARK_PALETTE, paletteVars } = require('./compose.js');

const repo = path.join(__dirname, '..');

/** null when the root has what the site is made from: its dependencies installed (esbuild minifies the release, fflate
 *  packs the skill) and the library built. Otherwise what to run, also for a host told to build site/ alone. */
function notReady(root = repo) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.devDependencies || {}).filter((n) => !fs.existsSync(path.join(root, 'node_modules', n, 'package.json')));
  const built = ['dist/manifest.json', 'dist/min/manifest.json'].filter((f) => !fs.existsSync(path.join(root, f)));
  const missing = [];
  if (deps.length) missing.push(`the root's dependencies are not installed (no ${deps.join(', ')})`);
  if (built.length) missing.push(`the library is not built (no ${built.join(', ')})`);
  if (!missing.length) return null;
  return [
    `The site is made from the library, which is built at the repository's root, and ${missing.join(' and ')}.`,
    'Build from the root:  npm ci && npm --prefix site ci && npm run site',
    '(npm run site builds the library first; before npm --prefix site run dev, run npm run build && npm run manifest.)',
    'A host builds from the root too. On Cloudflare: Root directory empty (not "site"), that build command, and the',
    'deploy command npx wrangler deploy --config site/wrangler.jsonc (site/README.md, Deploy).',
  ].join('\n');
}
const site = path.join(repo, 'site');
/** Where the site lives: canonical URLs, the sitemap, link previews. */
const SITE = 'https://blockcharts.online';

/** A composed report is a file to download and open, not a page to find: search engines are sent to its example page. */
function forDownload(html, name) {
  const head = '<meta name="robots" content="noindex">\n<link rel="canonical" href="' + SITE + '/examples/' + name + '/">\n';
  if (html.split('</head>').length !== 2) throw new Error(`report ${name}: no single </head> to put the robots tag before`);
  return html.replace('</head>', () => head + '</head>');
}

/** The chart colors in the site's own switch of themes: light from the core (BC.palette, what a chart falls back on), dark
 *  from the composer, so the site, a composed report and a chart without a page around it show the same colors. */
function paletteCss(distDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(distDir, manifest.core.file), 'utf8'), sandbox);
  const light = paletteVars(Array.from(sandbox.BC.palette));
  const dark = paletteVars(DARK_PALETTE);
  return [
    '/* made by scripts/site-prebuild.js */',
    `:root{${light}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${dark}}}`,
    `:root[data-theme='dark']{${dark}}`,
    '',
  ].join('\n');
}

function prebuild() {
  const distDir = path.join(repo, 'dist');
  const problem = notReady();
  if (problem) throw new Error(problem);
  // loaded here, as they need the root's dependencies (esbuild, fflate), which notReady has just found
  const { buildRelease } = require('./build-dist.js');
  const { checkSkill, packSkill } = require('./build-skill.js');
  const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-site-release-'));
  try {
    const release = buildRelease({ distDir, outDir: tmp, kits });
    const target = path.join(site, 'public', 'release');
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(tmp, target, { recursive: true });

    const recipesDir = path.join(repo, 'skills', 'blockcharts', 'recipes');
    const reportsDir = path.join(site, 'public', 'examples');
    fs.rmSync(reportsDir, { recursive: true, force: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    const sizes = {};
    for (const f of fs
      .readdirSync(recipesDir)
      .filter((n) => n.endsWith('.json'))
      .sort()) {
      const name = f.replace(/\.json$/, '');
      const r = compose({ ...readPage(path.join(recipesDir, f)), baseDir: recipesDir });
      if (r.diagnostics.length) throw new Error(`recipe ${name} has diagnostics: ${JSON.stringify(r.diagnostics)}`);
      fs.writeFileSync(path.join(reportsDir, `${name}.report.html`), forDownload(r.html, name));
      sizes[name] = r.bytes;
    }
    fs.mkdirSync(path.join(site, 'src', 'data'), { recursive: true });
    fs.writeFileSync(path.join(site, 'src', 'data', 'reports.json'), JSON.stringify(sizes, null, 2) + '\n');
    fs.writeFileSync(path.join(site, 'src', 'data', 'palette.css'), paletteCss(distDir));
    // the download is the committed skill, and only while it is current
    const stale = checkSkill();
    if (stale.length) throw new Error(`skills/blockcharts is out of date, run npm run skill: ${stale.join(', ')}`);
    fs.writeFileSync(path.join(site, 'public', 'blockcharts.skill'), packSkill());
    return { release, reports: Object.keys(sizes).length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { prebuild, notReady, forDownload, SITE };

if (require.main === module) {
  try {
    const r = prebuild();
    console.log(`site data: release ${r.release.version} and ${r.reports} reports`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
