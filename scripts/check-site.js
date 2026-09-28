// Checks the built site (site/dist) without a browser: every link and script points at a file that exists, every #anchor exists,
// and every chart spec on every page is valid against the data on that page, checked by the real core with the real kit.
//   node scripts/check-site.js [siteDir]      (default site/dist; SITE_BASE as when it was built)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  const kitFile = path.join(root, 'release', 'kits', 'full.js');
  const kit = fs.existsSync(kitFile) ? fs.readFileSync(kitFile, 'utf8') : null;
  if (!kit) problems.push('release/kits/full.js is missing, so charts cannot be validated');

  for (const f of html) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const text = textOf.get(f);
    stats.pages++;
    if (!/^<!doctype html>/i.test(text)) problems.push(`${rel}: no doctype`);
    if (!/<title>[^<]+<\/title>/.test(text)) problems.push(`${rel}: no title`);

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
