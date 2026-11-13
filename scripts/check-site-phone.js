// Opens every page of the built site in Chrome at phone widths and fails when a page is wider than the screen or a table
// scrolls sideways: what check-site.js, which reads the HTML without a browser, cannot see (a long URL in a sentence, a
// grid whose columns are wider than a phone, a column of a table hidden past the edge).
//   node scripts/check-site-phone.js [siteDir]      (npm run test:site; default site/dist, after npm run site)
// Needs the system Chrome (playwright-core, channel "chrome"), so it is not part of npm run site, which a host builds.
const fs = require('fs');
const http = require('http');
const path = require('path');

const WIDTHS = [320, 360, 390];
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

/** The pages of the site: every index.html, as the path it is served at (the reports and the release are files). */
function pagesOf(root, rel = '') {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return r === 'release' || r === '_astro' ? [] : pagesOf(root, r);
    return e.name === 'index.html' ? [`/${rel ? rel + '/' : ''}`] : [];
  });
}

function serve(root) {
  const server = http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** In the page: how wide it is, the tables that scroll, and the elements that reach past the screen outside any box that
 *  scrolls or clips (a pre of code scrolls on purpose). */
function measure() {
  const vw = document.documentElement.clientWidth;
  const name = (el) =>
    el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const tables = [...document.querySelectorAll('table')]
    .filter((t) => t.scrollWidth > t.clientWidth + 1 || t.parentElement.scrollWidth > t.parentElement.clientWidth + 1)
    .map((t) => `${name(t)} "${((t.querySelector('th') || {}).textContent || '').trim()}" scrolls`);
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect();
    if (!box.width || box.right <= vw + 1) continue;
    let held = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(a).overflowX)) held = true;
    if (!held) wide.push(`${name(el)} ends at ${Math.round(box.right)} px ("${(el.textContent || '').trim().slice(0, 40)}")`);
  }
  return { vw, width: document.documentElement.scrollWidth, tables, wide: wide.slice(-1) };
}

async function checkPhone(siteDir) {
  const { chromium } = require('playwright-core');
  const root = path.resolve(siteDir || path.join(__dirname, '..', 'site', 'dist'));
  if (!fs.existsSync(path.join(root, 'index.html')))
    return { problems: [`${root}/index.html not found: run npm run site first`], pages: 0 };
  const pages = pagesOf(root).sort();
  const server = await serve(root);
  const browser = await chromium.launch({ channel: 'chrome' });
  const problems = [];
  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      for (const p of pages) {
        errors.length = 0;
        await page.goto(`http://127.0.0.1:${server.address().port}${p}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const r = await page.evaluate(measure);
        if (r.width > r.vw)
          problems.push(`${p} at ${width} px: the page is ${r.width} px wide; ${r.wide.join('; ') || 'nothing found outside a scroller'}`);
        for (const t of r.tables) problems.push(`${p} at ${width} px: ${t}`);
        for (const e of errors) problems.push(`${p} at ${width} px: ${e}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { problems, pages: pages.length };
}

module.exports = { checkPhone, WIDTHS };

if (require.main === module) {
  checkPhone(process.argv[2]).then(
    (r) => {
      if (r.problems.length) {
        console.error(`site on a phone: ${r.problems.length} problem(s)\n - ${r.problems.join('\n - ')}`);
        process.exit(1);
      }
      console.log(`site on a phone: ${r.pages} pages at ${WIDTHS.join(', ')} px, none wider than the screen, no table scrolls`);
    },
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
