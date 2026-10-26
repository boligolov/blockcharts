// Checks the built site (site/dist) without a browser: every link and script points at a file that exists, every #anchor exists,
// every chart spec on every page is valid against the data on that page, checked by the real core with the real kit, and
// every page has what search engines and link previews read (title, description, canonical, image, sitemap).
//   node scripts/check-site.js [siteDir]      (default site/dist; SITE_BASE as when it was built)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SITE } = require('./site-prebuild.js');

const repo = path.join(__dirname, '..');
const unescapeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

async function checkSite(siteDir, options) {
  const root = path.resolve(siteDir || path.join(repo, 'site', 'dist'));
  const base = ((options && options.base) || process.env.SITE_BASE || '/').replace(/\/?$/, '/');
  const problems = [];
  const stats = { pages: 0, links: 0, charts: 0 };
  if (!fs.existsSync(root)) return { problems: [`${root} not found: run npm run site first`], stats };

  // the sources: Vite's dependency scan takes every <script src="..."> in the text of an .astro file for an import — also one
  // inside a string meant as a snippet — and the dev server fails on a path it cannot resolve. Snippets use scriptTag().
  const sources = path.join(repo, 'site', 'src');
  if (fs.existsSync(sources)) {
    for (const f of walk(sources).filter((n) => n.endsWith('.astro'))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/<script\b([^>]*)\bsrc=["'`]/g)) {
        if (!/\bis:inline\b/.test(m[1])) problems.push(`${path.relative(repo, f)}: a literal <script src="..."> in the source breaks the dev server's dependency scan; build it with scriptTag() from lib/site.mjs`);
      }
    }
  }

  const html = walk(root).filter((f) => f.endsWith('.html'));
  const idsOf = new Map();
  const textOf = new Map();
  for (const f of html) {
    const text = fs.readFileSync(f, 'utf8');
    textOf.set(f, text);
    idsOf.set(f, new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
  }
  const fileFor = (urlPath) => {
    let f = path.join(root, decodeURIComponent(urlPath));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    return f.startsWith(root) && fs.existsSync(f) ? f : null;
  };

  // the release folder is the real kit: pages are checked against it
  // what search engines and link previews read: a page is found by its own title and description, under one address;
  // a composed report is a download, kept out of the index and pointed at its example page
  const home = SITE + base;
  const titles = new Map();
  const indexable = new Set();
  const attr = (text, re) => { const m = text.match(re); return m ? unescapeHtml(m[1]) : null; };
  const seo = (rel, text) => {
    const report = rel.match(/^examples\/([\w-]+)\.report\.html$/);
    const canonical = attr(text, /<link rel="canonical" href="([^"]*)"/);
    if (report) {
      if (!/<meta name="robots" content="noindex">/.test(text)) problems.push(`${rel}: a report without noindex`);
      if (canonical !== `${home}examples/${report[1]}/`) problems.push(`${rel}: canonical ${canonical}, not its example page`);
      return;
    }
    const page = rel.replace(/(^|\/)index\.html$/, '$1');
    if (canonical !== home + page) problems.push(`${rel}: canonical ${canonical}, not ${home + page}`);
    else if (!/<meta name="robots" content="noindex/.test(text)) indexable.add(canonical);
    if (!/^<!doctype html>\s*<html lang="[a-z]{2}/i.test(text)) problems.push(`${rel}: no lang on <html>`);
    const title = attr(text, /<title>([^<]*)<\/title>/);
    if (title && titles.has(title)) problems.push(`${rel}: the same title as ${titles.get(title)}`);
    else if (title) titles.set(title, rel);
    const description = attr(text, /<meta name="description" content="([^"]*)"/);
    if (!description) problems.push(`${rel}: no description`);
    else if (description.length < 70 || description.length > 200) problems.push(`${rel}: a description of ${description.length} characters (70–200 show well)`);
    if (description && /[<>]/.test(description)) problems.push(`${rel}: markup in the description`);
    const image = attr(text, /<meta property="og:image" content="([^"]*)"/);
    if (!image || !image.startsWith(home) || !fileFor(image.slice(home.length))) problems.push(`${rel}: og:image ${image} is not a file of the site`);
    const h1 = (text.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) problems.push(`${rel}: ${h1} h1 headings`);
    for (const m of text.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) problems.push(`${rel}: an image without alt`);
  };

  const kitFile = path.join(root, 'release', 'kits', 'full.js');
  const kit = fs.existsSync(kitFile) ? fs.readFileSync(kitFile, 'utf8') : null;
  if (!kit) problems.push('release/kits/full.js is missing, so charts cannot be validated');

  for (const f of html) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const text = textOf.get(f);
    stats.pages++;
    if (!/^<!doctype html>/i.test(text)) problems.push(`${rel}: no doctype`);
    if (!/<title>[^<]+<\/title>/.test(text)) problems.push(`${rel}: no title`);
    seo(rel, text);

    for (const m of text.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const url = unescapeHtml(m[1]);
      if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue; // external links are not followed
      stats.links++;
      const [pathPart, hash] = url.split('#');
      let target = f;
      if (pathPart) {
        if (!pathPart.startsWith(base)) { problems.push(`${rel}: "${url}" does not start with the site base ${base}`); continue; }
        target = fileFor(pathPart.slice(base.length));
        if (!target) { problems.push(`${rel}: "${url}" points at nothing`); continue; }
      }
      if (hash && target.endsWith('.html') && !(idsOf.get(target) || new Set()).has(hash)) problems.push(`${rel}: "${url}" has no such anchor`);
    }

    // charts: the specs of this page against the data of this page
    const specs = [...text.matchAll(/<script[^>]*data-bc-chart[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (!specs.length || !kit) continue;
    const dataText = (text.match(/<script[^>]*id="bc-data"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
    const sandbox = { console: { warn() {}, error() {}, log() {} }, atob, Blob, DecompressionStream, TextDecoder };
    vm.createContext(sandbox);
    try {
      vm.runInContext(kit, sandbox, { filename: 'full.js' });
      // blocks a page defines itself (inline classic scripts calling BC.define) are part of its charts too
      for (const [, src] of text.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        if (/\bBC\.define\(/.test(src)) vm.runInContext(src, sandbox, { filename: `${rel} (inline block)` });
      }
      if (dataText) {
        const lake = JSON.parse(dataText);
        for (const name of Object.keys(lake)) sandbox.BC.data(name, lake[name]);
      }
      await sandbox.BC.ready();
    } catch (e) {
      problems.push(`${rel}: cannot load the page data: ${e.message}`);
      continue;
    }
    specs.forEach((s, i) => {
      stats.charts++;
      let spec;
      try { spec = JSON.parse(s); } catch (e) { problems.push(`${rel}: chart ${i} is not valid JSON`); return; }
      for (const d of Array.from(sandbox.BC.validate(spec))) {
        if (d.level === 'error') problems.push(`${rel}: chart ${i} ${d.path}: ${d.message}`);
      }
    });
  }

  // the sitemap lists every page that may be indexed, and nothing else; robots.txt names it (it is read at the root only)
  const maps = fs.existsSync(path.join(root, 'sitemap-index.xml')) ? walk(root).filter((f) => /[\\/]sitemap-\d+\.xml$/.test(f)) : [];
  if (!maps.length) problems.push('no sitemap-index.xml with its sitemaps');
  const listed = new Set(maps.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unescapeHtml(m[1]))));
  for (const u of indexable) if (!listed.has(u)) problems.push(`sitemap: ${u} is missing`);
  for (const u of listed) if (!indexable.has(u)) problems.push(`sitemap: ${u} is not an indexable page`);
  const robots = fs.existsSync(path.join(root, 'robots.txt')) ? fs.readFileSync(path.join(root, 'robots.txt'), 'utf8') : '';
  if (base === '/' && !robots.includes(`Sitemap: ${home}sitemap-index.xml`)) problems.push(`robots.txt does not name ${home}sitemap-index.xml`);
  return { problems, stats };
}

module.exports = { checkSite };

if (require.main === module) {
  checkSite(process.argv[2]).then((r) => {
  if (r.problems.length) {
    console.error(`site: ${r.problems.length} problem(s)\n - ${r.problems.join('\n - ')}`);
    process.exit(1);
  }
  console.log(`site ok: ${r.stats.pages} pages, ${r.stats.links} links, ${r.stats.charts} charts`);
  });
}
