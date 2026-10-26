// The link-preview image (site/public/og.png, 1200×630): a screenshot of the landing hero, drawn by the real blocks.
// Needs a built site (npm run site) and Chrome; run it again when the hero changes: npm run og.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const dist = path.join(__dirname, '..', 'site', 'dist');
const out = path.join(__dirname, '..', 'site', 'public', 'og.png');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

function serve() {
  const server = http.createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(dist)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${dist}/index.html not found: run npm run site first`);
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 735 }, deviceScaleFactor: 1200 / 1400, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.hero svg');
    // the hero alone, centred in a desktop-wide frame and scaled down to 1200×630: no header, no caption, no animation half-way
    await page.addStyleTag({ content: 'header.site{display:none} *{transition:none!important;animation:none!important} .hero{min-height:735px;display:flex;align-items:center;padding:0} .hero .window-caption{display:none}' });
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(`the landing page has errors: ${errors.join('; ')}`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1400, height: 735 } });
    console.log(`${path.relative(process.cwd(), out)}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
