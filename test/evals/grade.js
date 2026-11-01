// Grades one eval run in real Chrome, with the network cut: a page that needs a CDN fails as it would in an inbox.
//   node test/evals/grade.js <run_dir> <eval_name>
// <run_dir> holds report.html. Writes grading.json: expectations[] of { text, passed, evidence }.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const MAX_BYTES = 1024 * 1024;
const MIN_CHART = 100; // px: anything smaller is an icon, not a chart

/** How a figure may be written on a page: exactly, with thousands separators, or rounded to millions or thousands. */
function spellings(value) {
  const out = new Set([String(value), value.toLocaleString('en-US'), value.toLocaleString('en-US').replace(/,/g, ' ')]);
  if (Number.isInteger(value) && Math.abs(value) >= 1e6) {
    for (const d of [1, 2, 3]) out.add((value / 1e6).toFixed(d) + 'M').add((value / 1e6).toFixed(d) + ' M').add((value / 1e6).toFixed(d) + ' million');
  }
  if (Number.isInteger(value) && Math.abs(value) >= 1e4) {
    out.add(Math.round(value / 1e3).toLocaleString('en-US') + 'K').add(Math.round(value / 1e3).toLocaleString('en-US') + 'k');
    out.add((value / 1e3).toFixed(1) + 'K').add((value / 1e3).toFixed(1) + 'k');
  }
  return [...out];
}

async function inspect(file) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const seen = { errors: [], requests: [] };
  const open = async (options) => {
    const context = await browser.newContext(options);
    await context.route('**/*', (route) => {
      if (route.request().url().startsWith('file:')) return route.continue();
      seen.requests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => seen.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) seen.errors.push(m.text());
    });
    await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'));
    await page.waitForTimeout(1000);
    return page;
  };
  const laptop = await open({ viewport: { width: 1280, height: 900 } });
  const facts = await laptop.evaluate((min) => {
    const big = [...document.querySelectorAll('svg, canvas')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width >= min && r.height >= min && !e.parentElement.closest('svg');
    });
    const texts = [...document.querySelectorAll('svg text')].map((t) => t.textContent);
    return { charts: big.length, text: document.body.innerText + ' ' + texts.join(' ') };
  }, MIN_CHART);
  const phone = await open({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  facts.overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await browser.close();
  return { ...facts, ...seen };
}

async function grade(file, expected) {
  const expectations = [];
  const check = (text, passed, evidence) => expectations.push({ text, passed: !!passed, evidence: String(evidence).slice(0, 300) });
  if (!fs.existsSync(file)) {
    check('report.html exists', false, file);
    return { expectations, bytes: 0 };
  }
  const bytes = fs.statSync(file).size;
  const html = fs.readFileSync(file, 'utf8');
  const seen = await inspect(file);
  check('report.html exists', true, `${bytes} bytes`);
  check('no script errors with the network off', !seen.errors.length, seen.errors.join(' | ') || 'none');
  check('asks for nothing on the network', !seen.requests.length, seen.requests.join(' ') || 'none');
  check(`at least ${expected.charts} chart(s) drawn offline`, seen.charts >= expected.charts, `${seen.charts} drawn`);
  check(`no more than ${MAX_BYTES / 1024} KB`, bytes <= MAX_BYTES, `${Math.round(bytes / 1024)} KB`);
  check('no sideways scroll on a phone', seen.overflow <= 0, `${seen.overflow}px`);
  for (const figure of expected.figures) {
    const ways = spellings(figure);
    // a figure stands on its own: 34 is not on a page that says 2,345
    const found = ways.find((w) => new RegExp(String.raw`(?<![\d.,])${w.replace(/[.]/g, String.raw`\.`)}(?!\d|[.,]\d)`).test(seen.text));
    check(`the figure ${figure} is on the page`, found, found || 'not in the visible text');
  }
  for (const word of expected.words) {
    const ways = [].concat(word);
    check(`"${ways[0]}" is on the page`, ways.some((w) => seen.text.includes(w) || html.includes(w)), ways.join(' or '));
  }
  return { expectations, bytes };
}

module.exports = { grade, spellings };

if (require.main === module) {
  const [dir, name] = process.argv.slice(2);
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));
  if (!dir || !all[name]) {
    console.error(`usage: node grade.js <run_dir> <${Object.keys(all).join('|')}>`);
    process.exit(2);
  }
  grade(path.join(dir, 'report.html'), all[name]).then((result) => {
    fs.writeFileSync(path.join(dir, 'grading.json'), JSON.stringify(result, null, 2) + '\n');
    const passed = result.expectations.filter((e) => e.passed).length;
    console.log(`${name}: ${passed}/${result.expectations.length}, ${Math.round(result.bytes / 1024)} KB`);
    for (const e of result.expectations) if (!e.passed) console.log(`  FAIL ${e.text}: ${e.evidence}`);
  });
}
