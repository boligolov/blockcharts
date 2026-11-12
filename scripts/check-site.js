// Checks the built site (site/dist) without a browser: every link and script points at a file that exists, every #anchor exists,
// every chart spec on every page is valid against the data on that page, checked by the real core with the real kit, and
// every page has what search engines and link previews read (title, description, canonical, image, sitemap), and its text reads
// at 4.5:1 in both themes (the tokens of site.css, the colors of highlighted code).
//   node scripts/check-site.js [siteDir]      (default site/dist; SITE_BASE as when it was built)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SITE } = require('./site-prebuild.js');
const { scalesFitting } = require('./build-manifest.js');

const repo = path.join(__dirname, '..');
const unescapeHtml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// WCAG 2 contrast of two colors given as #rgb or #rrggbb
const luminance = (hex) => {
  const h = hex.slice(1).length === 3 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// which tokens of site.css are text and which are what text stands on; charts stand on cards (and their tooltip's)
const TEXT_ON = [
  [
    ['fg', 'muted', 'faint', 'accent', 'accent-strong', 'good'],
    ['bg', 'surface', 'surface-2', 'code-bg', 'accent-soft'],
  ],
  [['good'], ['good-soft']],
  [['accent-ink'], ['accent', 'accent-strong']],
  [
    ['bc-text', 'bc-label', 'bc-kpi'],
    ['surface', 'bc-tooltip-bg'],
  ],
];
const CODE_ON = ['bg', 'code-bg'];

/** The text of the site reads at 4.5:1 (WCAG AA) in both themes: the tokens of site.css, every text color on every
 * background, and the colors of highlighted code (`--shiki-light`/`--shiki-dark` on the pages) where code stands. */
function checkContrast(css, pages) {
  const problems = [];
  const block = (re) => {
    const m = css.match(re);
    return m && Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
  };
  const themes = {
    light: block(/^:root \{([^}]*)\}/m),
    dark: block(/^@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{([^}]*)\}/m),
  };
  const chosen = block(/^:root\[data-theme='dark'\] \{([^}]*)\}/m);
  if (!themes.light || !themes.dark || !chosen) return ['site.css: the three blocks of theme tokens are not where they were'];
  // the dark theme is written twice, for the system's choice and the visitor's
  if (JSON.stringify(themes.dark) !== JSON.stringify(chosen))
    problems.push("site.css: the dark tokens of :root[data-theme='dark'] differ from those of prefers-color-scheme: dark");
  for (const [theme, t] of Object.entries(themes)) {
    const color = (name) => {
      if (!HEX.test(t[name] || '')) problems.push(`site.css: --${name} of the ${theme} theme is not a hex color (${t[name]})`);
      return t[name];
    };
    for (const [texts, grounds] of TEXT_ON)
      for (const fg of texts)
        for (const bg of grounds) {
          const r = contrast(color(fg), color(bg));
          if (r < 4.5) problems.push(`site.css: --${fg} on --${bg} reads ${r.toFixed(2)}:1 in the ${theme} theme (4.5 at least)`);
        }
    const used = new Set();
    for (const text of pages)
      for (const m of text.matchAll(new RegExp(`--shiki-${theme}:(#[0-9a-f]{6})\\b`, 'gi'))) used.add(m[1].toLowerCase());
    if (!used.size) problems.push(`no highlighted code with --shiki-${theme} colors on any page`);
    for (const c of used)
      for (const bg of CODE_ON) {
        const r = contrast(c, color(bg));
        if (r < 4.5)
          problems.push(`highlighted code: ${c} on --${bg} reads ${r.toFixed(2)}:1 in the ${theme} theme (site/src/lib/highlight.mjs)`);
      }
  }
  return [...new Set(problems)];
}

const withoutScripts = (text) => text.replace(/<script\b[\s\S]*?<\/script>/g, '');

/** The headings of a page go down one level at a time from its h1: a screen reader moving by headings hears the outline,
 * and a skipped level reads as a section missing. */
function checkHeadings(rel, text) {
  const problems = [];
  let prev = 0;
  for (const m of withoutScripts(text).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const level = +m[1];
    if (level > prev + 1) {
      const words = unescapeHtml(m[2].replace(/<[^>]+>/g, '')).trim();
      problems.push(`${rel}: h${level} "${words}" comes after ${prev ? `an h${prev}` : 'no heading'} (a level skipped)`);
    }
    prev = level;
  }
  return problems;
}

/** What a page of the site is like to read with a keyboard or a screen reader: its headings (above), its first link skips
 * to the content past the header, and every copy button says what it copies, unlike the others on the page. */
function checkReading(rel, text) {
  const problems = checkHeadings(rel, text);
  const html = withoutScripts(text);
  const body = html.slice(html.search(/<body\b/));
  const first = body.match(/<a\b[^>]*>/);
  const to = first && attr1(first[0], 'href');
  if (!to || !to.startsWith('#')) problems.push(`${rel}: the first link is not a skip link to the content`);
  else if (!new RegExp(`\\bid="${to.slice(1)}"`).test(html)) problems.push(`${rel}: the skip link points at no #${to.slice(1)}`);
  const said = new Set();
  for (const m of html.matchAll(/<button\b[^>]*\bclass="copy"[^>]*>/g)) {
    const name = attr1(m[0], 'aria-label');
    if (!name || !/^Copy \S/.test(name))
      problems.push(`${rel}: a copy button that does not say what it copies (${name || 'no aria-label'})`);
    else if (said.has(name)) problems.push(`${rel}: two copy buttons both say "${name}"`);
    said.add(name);
  }
  return problems;
}
const attr1 = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unescapeHtml(m[1]) : null;
};

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
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
        if (!/\bis:inline\b/.test(m[1]))
          problems.push(
            `${path.relative(repo, f)}: a literal <script src="..."> in the source breaks the dev server's dependency scan; build it with scriptTag() from lib/site.mjs`,
          );
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

  const css = path.join(repo, 'site', 'src', 'styles', 'site.css');
  if (!fs.existsSync(css)) problems.push(`${css} not found`);
  else problems.push(...checkContrast(fs.readFileSync(css, 'utf8'), [...textOf.values()]));

  // the release folder is the real kit: pages are checked against it
  // what search engines and link previews read: a page is found by its own title and description, under one address;
  // a composed report is a download, kept out of the index and pointed at its example page
  const home = SITE + base;
  const titles = new Map();
  const indexable = new Set();
  const attr = (text, re) => {
    const m = text.match(re);
    return m ? unescapeHtml(m[1]) : null;
  };
  const seo = (rel, text) => {
    const report = rel.match(/^examples\/([\w-]+)\.report\.html$/);
    const canonical = attr(text, /<link rel="canonical" href="([^"]*)"/);
    if (report) {
      if (!/<meta name="robots" content="noindex">/.test(text)) problems.push(`${rel}: a report without noindex`);
      if (canonical !== `${home}examples/${report[1]}/`) problems.push(`${rel}: canonical ${canonical}, not its example page`);
      problems.push(...checkHeadings(rel, text));
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
    else if (description.length < 70 || description.length > 200)
      problems.push(`${rel}: a description of ${description.length} characters (70–200 show well)`);
    if (description && /[<>]/.test(description)) problems.push(`${rel}: markup in the description`);
    const image = attr(text, /<meta property="og:image" content="([^"]*)"/);
    if (!image || !image.startsWith(home) || !fileFor(image.slice(home.length)))
      problems.push(`${rel}: og:image ${image} is not a file of the site`);
    const h1 = (text.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) problems.push(`${rel}: ${h1} h1 headings`);
    for (const m of text.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) problems.push(`${rel}: an image without alt`);
    problems.push(...checkReading(rel, text));
  };

  // the blocks page says, for each channel, which scales it accepts: they are worked out from what the scales declare (the
  // manifest of the build the page is made from), so a page that lost them (and reads "any") would say every scale fits
  const manifestFile = path.join(repo, 'dist', 'manifest.json');
  const blocksPage = path.join(root, 'blocks', 'index.html');
  if (!textOf.has(blocksPage)) problems.push('blocks/index.html is missing');
  else if (!fs.existsSync(manifestFile)) problems.push(`${manifestFile} is missing, so the blocks page cannot be checked`);
  else {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const page = unescapeHtml(textOf.get(blocksPage));
    let checked = 0;
    for (const [name, b] of Object.entries(manifest.blocks))
      for (const [ch, c] of Object.entries(b.channels || {})) {
        if (!c.accepts) continue;
        checked++;
        const list = scalesFitting(c.accepts, manifest).join(', ');
        const row = new RegExp(
          `<td><code>${ch}</code></td><td>(?:<b>required</b>|optional)</td><td>${list.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(one that`,
        );
        const start = page.indexOf(`<div class="block" id="${name}"`);
        const next = page.indexOf('<div class="block"', start + 1);
        const section = start < 0 ? '' : page.slice(start, next < 0 ? undefined : next);
        if (!list || !row.test(section))
          problems.push(`blocks/index.html: channel "${ch}" of ${name} does not list the scales it accepts (${list || 'none fit'})`);
      }
    if (!checked) problems.push('blocks/index.html: no channel in the manifest says which scales it accepts');
  }

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
        if (!pathPart.startsWith(base)) {
          problems.push(`${rel}: "${url}" does not start with the site base ${base}`);
          continue;
        }
        target = fileFor(pathPart.slice(base.length));
        if (!target) {
          problems.push(`${rel}: "${url}" points at nothing`);
          continue;
        }
      }
      if (hash && target.endsWith('.html') && !(idsOf.get(target) || new Set()).has(hash))
        problems.push(`${rel}: "${url}" has no such anchor`);
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
      try {
        spec = JSON.parse(s);
      } catch (e) {
        problems.push(`${rel}: chart ${i} is not valid JSON`);
        return;
      }
      for (const d of Array.from(sandbox.BC.validate(spec))) {
        if (d.level === 'error') problems.push(`${rel}: chart ${i} ${d.path}: ${d.message}`);
      }
    });
  }

  // the sitemap lists every page that may be indexed, and nothing else; robots.txt names it (it is read at the root only)
  const maps = fs.existsSync(path.join(root, 'sitemap-index.xml')) ? walk(root).filter((f) => /[\\/]sitemap-\d+\.xml$/.test(f)) : [];
  if (!maps.length) problems.push('no sitemap-index.xml with its sitemaps');
  const listed = new Set(
    maps.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unescapeHtml(m[1]))),
  );
  for (const u of indexable) if (!listed.has(u)) problems.push(`sitemap: ${u} is missing`);
  for (const u of listed) if (!indexable.has(u)) problems.push(`sitemap: ${u} is not an indexable page`);
  const robots = fs.existsSync(path.join(root, 'robots.txt')) ? fs.readFileSync(path.join(root, 'robots.txt'), 'utf8') : '';
  if (base === '/' && !robots.includes(`Sitemap: ${home}sitemap-index.xml`))
    problems.push(`robots.txt does not name ${home}sitemap-index.xml`);
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
