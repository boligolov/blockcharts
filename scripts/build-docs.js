// The figures README.md and the docs quote, written from the build: what the code weighs, how many blocks and recipes
// there are, the kits, the version of the principles. Each stands between two comments that a rendered page does not show:
//   each a block of <!-- build:block-range -->0.4–12 KB<!-- /build -->.
// A figure that is a table stands on lines of its own between them.
//   node scripts/build-docs.js           rewrite them (npm run skill does it)
//   node scripts/build-docs.js --check   exit 1 while one is not the build's (test-dist.js does it)
// Needs npm run build && npm run manifest first. Sizes are those of scripts/sizes.js, as on the site.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compose, readPage } = require('./compose.js');
const { buildRelease } = require('./build-dist.js');
const { ROLES } = require('./build-manifest.js');
const { gzipSize: gzip, blockSizes, coreFile, reportCore, libraryCode } = require('./sizes.js');

const repo = path.join(__dirname, '..');
/** The files that quote figures, from the repository's root. */
const DOCS = ['README.md', 'docs/README.md', 'docs/spec/principles.md'];
const MARK = /<!-- build:([\w-]+) -->([\s\S]*?)<!-- \/build -->/g;
const recipesDir = path.join(repo, 'skills', 'blockcharts', 'recipes');

const kb1 = (n) => (n / 1024).toFixed(1);
const kb0 = (n) => String(Math.round(n / 1024));

/** The pages §1 of the principles weighs: a recipe each, and what it shows. */
const PAGES = [
  ['pie', 'a pie chart'],
  ['bar', 'a bar chart with labels and a tooltip'],
  ['report-from-csv', 'monthly totals and a ranking from raw CSV rows'],
  ['executive-dashboard', 'an executive dashboard: KPI tiles, a trend, a donut, a waterfall and a funnel, animated'],
];

const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

/** The version of the principles, as their own first paragraph states it ("**Version 1.1.**"). */
function principlesVersion() {
  const m = fs.readFileSync(path.join(repo, 'docs', 'spec', 'principles.md'), 'utf8').match(/^\*\*Version (\d+\.\d+)\.\*\*/m);
  if (!m) throw new Error('docs/spec/principles.md: no "**Version N.N.**" to read the version from');
  return m[1];
}

/** Every figure the docs can quote, by name: a line of text, or a Markdown table. */
function figures() {
  const distDir = path.join(repo, 'dist');
  const lib = libraryCode();
  const core = reportCore();
  const sizes = blockSizes().map((b) => b.bytes);
  const recipes = fs.readdirSync(recipesDir).filter((f) => f.endsWith('.json'));
  const page = (name) => {
    const r = compose({ ...readPage(path.join(recipesDir, name + '.json')), baseDir: recipesDir });
    return { blocks: r.blocks.length, bytes: r.bytes };
  };
  const pages = PAGES.map(([name, label]) => ({ name, label, ...page(name) }));
  const bar = pages.find((p) => p.name === 'bar');
  const dashboard = pages.find((p) => p.name === 'executive-dashboard');

  const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-docs-'));
  let release;
  try {
    release = buildRelease({ distDir, outDir: tmp, kits });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  const names = (role) =>
    Object.keys(manifest.blocks)
      .filter((n) => n.startsWith(role + '.'))
      .map((n) => n.slice(role.length + 1))
      .sort();
  return {
    'principles-version': principlesVersion(),
    blocks: String(lib.count),
    recipes: String(recipes.length),
    'block-range': `${kb1(Math.min(...sizes))}–${kb0(Math.max(...sizes))} KB`,
    core: `${kb0(core.length)} KB minified, about ${kb0(gzip(core))} KB gzipped`,
    'core-gzip': `${kb0(gzip(core))} KB`,
    'core-saving': `${kb0(coreFile(null).length - core.length)} KB`,
    bar: `${bar.blocks} of the ${lib.count} blocks, ${kb0(bar.bytes)} KB of code instead of ${kb0(lib.bytes)}`,
    'dashboard-blocks': String(dashboard.blocks),
    loader: `${kb0(release.loader.bytes)} KB`,
    pages: table(
      ['page', 'blocks', 'code in the page'],
      pages
        .map((p) => [p.label, p.blocks, `${kb1(p.bytes)} KB`])
        .concat([['everything blockcharts has', lib.count, `${kb1(lib.bytes)} KB`]]),
    ),
    kits: table(
      ['Kit', 'Blocks', 'Contents', 'Minified (gzip)'],
      Object.keys(kits).map((n) => [
        `\`${n}\``,
        release.kits[n].blocks.length,
        kits[n].doc,
        `${kb0(release.kits[n].js.bytes)} KB (${kb0(release.kits[n].js.gzip)} KB)`,
      ]),
    ),
    roles: table(
      ['Role', 'Blocks'],
      ROLES.map((role) => [
        role,
        names(role)
          .map((n) => `\`${n}\``)
          .join(', ') + (role === 'lib' ? ' (code other blocks share; a spec never names it)' : ''),
      ]),
    ),
  };
}

/** What stands between the markers of a figure: a table on lines of its own, a line of text as it is. */
const inner = (value) => (value.includes('\n') ? `\n\n${value}\n\n` : value);

/** The text with every figure the build's; a marker naming no figure is an error. */
function render(text, values, file) {
  return text.replace(MARK, (all, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key))
      throw new Error(`${file}: <!-- build:${key} --> names no figure (there are ${Object.keys(values).join(', ')})`);
    return `<!-- build:${key} -->${inner(values[key])}<!-- /build -->`;
  });
}

/** The figures of a text that are not the build's, as "file: name". */
function stale(text, values, file) {
  const out = [];
  for (const m of text.replace(/\r\n/g, '\n').matchAll(MARK)) {
    if (!Object.prototype.hasOwnProperty.call(values, m[1])) out.push(`${file}: build:${m[1]} names no figure`);
    else if (m[2] !== inner(values[m[1]])) out.push(`${file}: build:${m[1]} is not the build's`);
  }
  return out;
}

/** Every stale figure of the docs; [] when they are current. */
function checkDocs(values = figures()) {
  return DOCS.flatMap((f) => stale(fs.readFileSync(path.join(repo, f), 'utf8'), values, f));
}

/** Writes the figures into the docs; returns the files it changed. */
function buildDocs(values = figures()) {
  const changed = [];
  for (const f of DOCS) {
    const file = path.join(repo, f);
    const text = fs.readFileSync(file, 'utf8');
    const next = render(text, values, f);
    if (next !== text) {
      fs.writeFileSync(file, next);
      changed.push(f);
    }
  }
  return changed;
}

module.exports = { figures, render, stale, checkDocs, buildDocs, principlesVersion, DOCS };

if (require.main === module) {
  try {
    if (process.argv.includes('--check')) {
      const problems = checkDocs();
      if (problems.length) {
        console.error(`the docs quote figures of another build (run npm run skill):\n  ${problems.join('\n  ')}`);
        process.exit(1);
      }
      console.log('docs: current');
    } else {
      const changed = buildDocs();
      console.log(`docs: ${changed.length ? changed.join(', ') + ' updated' : 'current'}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
