// Layout in a real browser: what a fake DOM cannot see (where a card lands, what sticks out of the screen). Composes
// pages with the real composer, opens them in Chrome (playwright-core, channel "chrome") and measures. Run:
// npm run test:chrome
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const { compose } = require('./compose.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-chrome-'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

let browser;
/** A page of the given charts, open at `width` px, with what it logged as errors. */
async function open(page, width, height = 900) {
  const r = compose(page);
  assert.deepStrictEqual(
    r.diagnostics.filter((d) => d.level === 'error'),
    [],
  );
  const file = path.join(dir, `page-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, r.html);
  const p = await browser.newPage({ viewport: { width, height } });
  p.errors = [];
  p.on('console', (m) => m.type() === 'error' && p.errors.push(m.text()));
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(pathToFileURL(file).href);
  await p.waitForFunction(() => document.querySelectorAll('svg').length > 0);
  await p.waitForTimeout(150);
  return p;
}
/** How far the page reaches past the screen sideways (0 when it does not scroll). */
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const rectOf = (p, selector) =>
  p.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);

// ───────────────────────── the tooltip ─────────────────────────

const LONG = 'Regional distribution centre, consolidated after the merger of the northern and the western networks';
const notes = {
  title: 'Notes',
  data: {
    sites: [
      { x: 1, y: 3, site: LONG, code: 'X'.repeat(90) },
      { x: 5, y: 7, site: LONG, code: 'X'.repeat(90) },
      { x: 9, y: 4, site: LONG, code: 'X'.repeat(90) },
    ],
  },
  charts: [
    {
      title: 'Sites',
      spec: {
        data: 'sites',
        size: [640, 320],
        scales: { x: { type: 'linear' }, y: { type: 'linear' } },
        marks: [{ type: 'point', x: 'x', y: 'y', r: 6 }],
        interaction: [{ type: 'tooltip', fields: ['site', 'code', 'y'] }],
      },
    },
  ],
};

test('tooltip: a card of long text stays on a phone screen, wherever the point is', async () => {
  const p = await open(notes, 390);
  // a page of one's own, without the composer's border-box for everything
  await p.addStyleTag({ content: '*{box-sizing:content-box}' });
  const points = await p.$$eval('[data-bc-layer="marks"] circle', (cs) =>
    cs.map((c) => {
      const r = c.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }),
  );
  assert.strictEqual(points.length, 3);
  const widths = [];
  for (const [x, y] of points) {
    await p.mouse.move(x, y);
    await p.waitForTimeout(60);
    const tip = await rectOf(p, '.bc-tooltip');
    assert(tip.width > 0, 'the card is shown');
    const chart = await rectOf(p, 'svg');
    assert(
      tip.left >= chart.left - 0.5 && tip.right <= chart.right + 0.5,
      `the card is over the chart at ${x}: ${tip.left}..${tip.right} of ${chart.left}..${chart.right}`,
    );
    assert.strictEqual(await overflow(p), 0, 'and the page does not scroll sideways');
    const text = await p.$eval('.bc-tooltip', (t) => t.textContent);
    assert(text.includes(LONG.slice(0, 70)), 'the text is there, as far as a card writes it');
    widths.push(Math.round(tip.width));
  }
  assert(
    widths.every((w) => w === widths[0]),
    'the same card is the same size wherever it is: ' + widths,
  );
  assert.deepStrictEqual(p.errors, []);
  await p.close();
});

test('tooltip: a card is as wide as its text asks, wherever the card before it stood', async () => {
  const mixed = {
    ...notes,
    data: {
      sites: [
        { x: 1, y: 3, site: 'Regional distribution centre, Leeds', code: 'L1' },
        { x: 7, y: 7, site: 'Hull', code: 'H' },
        { x: 9, y: 4, site: 'York', code: 'Y' },
      ],
    },
  };
  const p = await open(mixed, 390);
  const [a, b] = await p.$$eval('[data-bc-layer="marks"] circle', (cs) =>
    cs.map((c) => {
      const r = c.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }),
  );
  const width = async ([x, y]) => {
    await p.mouse.move(x, y);
    await p.waitForTimeout(60);
    return (await rectOf(p, '.bc-tooltip')).width;
  };
  const first = await width(a);
  await width(b);
  assert.strictEqual(await width(a), first, 'after a short card on the right, the long one is as wide as before');
  await p.close();
});

test('tooltip: a chart wider than the screen keeps its card on the part the reader sees', async () => {
  const wide = { ...notes, charts: [{ ...notes.charts[0], minWidth: 900 }] };
  const p = await open(wide, 390);
  await p.addStyleTag({ content: '*{box-sizing:content-box}' });
  const svg = await rectOf(p, 'svg');
  assert(svg.width > 390, 'the chart is wider than the screen: ' + svg.width);
  const [x, y] = await p.$eval('[data-bc-layer="marks"] circle', (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  await p.mouse.move(x, y);
  await p.waitForTimeout(60);
  const tip = await rectOf(p, '.bc-tooltip');
  assert(tip.width > 0 && tip.left >= 0 && tip.right <= 390, `on the screen: ${tip.left}..${tip.right}`);
  await p.close();
});

test('tooltip: a short card on a desk is one line per field, beside the point', async () => {
  const p = await open({ ...notes, data: { sites: notes.data.sites.map((s) => ({ ...s, site: 'Leeds', code: 'L1' })) } }, 1100);
  const c = await p.$eval('[data-bc-layer="marks"] circle', (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  await p.mouse.move(c[0], c[1]);
  await p.waitForTimeout(60);
  const tip = await rectOf(p, '.bc-tooltip');
  const line = await p.$eval('.bc-tooltip-lines', (l) => l.children[1].getBoundingClientRect().height);
  assert(line < 22, 'a value is one line: ' + line);
  assert(tip.left > c[0], 'right of the point, where there is room');
  await p.close();
});

// ───────────────────────── value labels and slanted names on a phone ─────────────────────────

const recipe = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../skills/blockcharts/recipes', name + '.json'), 'utf8'));

/** The bridge chart of a page: the size of its figures, their boxes, and where its slanted names end. */
const bridgeOf = (p, title) =>
  p.evaluate((title) => {
    const card = [...document.querySelectorAll('.bc-section')].find((s) => s.textContent.includes(title));
    const svg = card.querySelector('svg[viewBox]');
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const figures = [...svg.querySelectorAll('[data-bc-layer="marks"] text')].map((t) => ({
      text: t.textContent,
      px: parseFloat(getComputedStyle(t).fontSize) * scale,
      ...rect(t),
    }));
    const names = [...svg.querySelectorAll('[data-bc-layer="axes"] text.bc-axis-label')].map((t) => ({
      slanted: /rotate\(-45/.test(t.getAttribute('transform') || ''),
      ...rect(t),
    }));
    return { svg: rect(svg), figures, names };
  }, title);

// 360 px: a small Android phone, the narrowest common screen
for (const [name, title, width] of [
  ['waterfall', 'From revenue to operating profit', 360],
  ['waterfall', 'From revenue to operating profit', 390],
  ['executive-dashboard', 'From revenue to operating profit', 390],
]) {
  test(`${name} at ${width} px: every figure at full size and clear of the others, the names at an angle with no empty band under them`, async () => {
    const p = await open(recipe(name), width);
    const { svg, figures, names } = await bridgeOf(p, title);
    assert.strictEqual(figures.length, 7);
    for (const f of figures) assert(f.px >= 11, `${f.text} is ${f.px} px`);
    for (let i = 1; i < figures.length; i++) {
      const [a, b] = [figures[i - 1], figures[i]];
      const apart = a.right + 2 <= b.left || a.bottom <= b.top || b.bottom <= a.top;
      assert(apart, `${a.text} and ${b.text} meet: ${a.right} / ${b.left}`);
    }
    // a loss's figure under its bar: below the figure of the bar before it, which stands above the same height
    const loss = figures.find((f) => f.text.startsWith('-'));
    assert(loss.top > figures[0].bottom, 'the first loss is under its bar, not beside the gain before it');
    assert(names.length === 7 && names.every((n) => n.slanted), 'seven names at 45°');
    for (const n of names) assert(n.left >= svg.left && n.bottom <= svg.bottom, `a name stays in the chart: ${n.left} / ${svg.left}`);
    const under = svg.bottom - Math.max(...names.map((n) => n.bottom));
    // the chart's padding (16 px) and a few px of a label's line box: not the 40 px band there was
    assert(under <= 28, `${under} px empty under the names`);
    assert.strictEqual(await overflow(p), 0);
    assert.deepStrictEqual(p.errors, []);
    await p.close();
  });
}

// ───────────────────────── the names of a Marimekko's columns ─────────────────────────

for (const width of [360, 390, 1100]) {
  test(`marimekko at ${width} px: every column named over its middle, at full size, in one row above the plot`, async () => {
    const p = await open(recipe('marimekko'), width);
    const got = await p.evaluate(() => {
      const svg = document.querySelector('svg[viewBox]');
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      // the cells of a column share its left and right edges: one column per left edge, in order
      const columns = [];
      for (const r of [...svg.querySelectorAll('[data-bc-layer="marks"] rect')].map(rect)) {
        const c = columns.find((c) => Math.abs(c.left - r.left) < 0.5);
        if (c) c.top = Math.min(c.top, r.top);
        else columns.push({ ...r });
      }
      const names = [...svg.querySelectorAll('[data-bc-layer="axes"] text.bc-axis-label')]
        .map((t) => ({
          text: t.textContent,
          px: parseFloat(getComputedStyle(t).fontSize) * scale,
          turned: !!t.getAttribute('transform'),
          ...rect(t),
        }))
        .filter((n) => !/%$/.test(n.text));
      return { svg: rect(svg), columns: columns.sort((a, b) => a.left - b.left), names };
    });
    const { svg, columns, names } = got;
    assert.deepStrictEqual(
      names.map((n) => n.text),
      ['Asia', 'Europe', 'Americas', 'Africa'],
    );
    assert.strictEqual(columns.length, 4);
    const top = Math.min(...columns.map((c) => c.top));
    names.forEach((n, i) => {
      const mid = (columns[i].left + columns[i].right) / 2;
      assert(n.left <= mid && mid <= n.right, `${n.text} stands over the middle of its column: ${n.left}..${n.right} / ${mid}`);
      assert(n.px >= 11 && !n.turned, `${n.text}: ${n.px} px, upright`);
      assert(n.bottom <= top + 1, `${n.text} is above the plot: ${n.bottom} / ${top}`);
      assert(n.left >= svg.left && n.right <= svg.right && n.top >= svg.top, `${n.text} stays in the chart`);
      if (i) assert(names[i - 1].right + 4 <= n.left, `${names[i - 1].text} and ${n.text} are apart: ${names[i - 1].right} / ${n.left}`);
    });
    assert.strictEqual(await overflow(p), 0);
    assert.deepStrictEqual(p.errors, []);
    await p.close();
  });
}

(async () => {
  browser = await chromium.launch({ channel: 'chrome' });
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name);
      console.log(e);
    }
  }
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} of ${tests.length} passed`);
  if (passed !== tests.length) process.exit(1);
})();
