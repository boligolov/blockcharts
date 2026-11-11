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

test('tooltip: the dot by the heading has the color of the shape, with a ring that keeps it in sight on the card', async () => {
  // [recipe, the shape hovered, where in it, the shape whose color the dot takes]
  const cases = [
    ['candlestick', 'rect[data-bc-row="0"]', [0.5, 0.5], 'rect[data-bc-row="0"]'], // fell: red
    ['candlestick', 'rect[data-bc-row="2"]', [0.5, 0.5], 'rect[data-bc-row="2"]'], // rose: green
    ['heatmap', 'rect[data-bc-row="19"]', [0.5, 0.5], 'rect[data-bc-row="19"]'], // a dark cell
    ['bullet', 'rect[data-bc-mark="0"][data-bc-row="0"]', [0.95, 0.15], 'rect[data-bc-mark="3"][data-bc-row="0"]'], // the band: the bar
  ];
  for (const scheme of ['light', 'dark']) {
    for (const [name, hovered, [fx, fy], owner] of cases) {
      const p = await open(recipe(name), 1100);
      await p.emulateMedia({ colorScheme: scheme });
      const box = await p.evaluate((s) => {
        const el = document.querySelector('.bc-chart ' + s);
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }, hovered);
      await p.mouse.move(box.x + box.w * fx, box.y + box.h * fy, { steps: 2 });
      await p.waitForTimeout(100);
      const got = await p.evaluate((s) => {
        const sw = [...document.querySelectorAll('.bc-tooltip')]
          .find((t) => getComputedStyle(t).display !== 'none')
          .querySelector('.bc-tooltip-swatch');
        return {
          dot: getComputedStyle(sw).backgroundColor,
          ring: getComputedStyle(sw).boxShadow,
          shape: getComputedStyle(document.querySelector('.bc-chart ' + s)).fill,
        };
      }, owner);
      assert.strictEqual(got.dot, got.shape, `${name} ${hovered} (${scheme})`);
      assert(/inset/.test(got.ring), `${name} (${scheme}): a ring, ${got.ring}`);
      assert.deepStrictEqual(p.errors, []);
      await p.close();
    }
  }
});

test("tooltip: an error bar's whisker, a dumbbell's bar and a lollipop's stem show their card and light up, desk and phone", async () => {
  // [recipe, the chart's title, the row of its rule (mark 0), where along the line from its top or left end, the heading]
  const cases = [
    ['error-bars', 'Improvement by dose', 1, 0.15, 'Dose 10 mg'],
    ['dumbbell', 'Customer satisfaction', 2, 0.5, 'East'],
    ['dumbbell', 'Net promoter score', 1, 0.5, 'Web app'],
  ];
  for (const width of [1100, 390]) {
    for (const [name, title, row, at, heading] of cases) {
      const p = await open(recipe(name), width);
      const line = await p.evaluate(
        ([title, row]) => {
          const card = [...document.querySelectorAll('.bc-section')].find((s) => s.textContent.includes(title));
          const el = card.querySelector(`[data-bc-layer="marks"] path[data-bc-mark="0"][data-bc-row="${row}"]`);
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        },
        [title, row],
      );
      // a 2-3 px line: one px off its middle, as a hand would be
      await p.mouse.move(line.left + line.width * at + 1, line.top + line.height * at + 1, { steps: 2 });
      await p.waitForTimeout(100);
      const got = await p.evaluate(() => {
        const tip = [...document.querySelectorAll('.bc-tooltip')].find((t) => getComputedStyle(t).display !== 'none');
        if (!tip) return null;
        const host = tip.parentNode;
        const lit = host.querySelector('.bc-tooltip-highlight');
        const r = lit.getBoundingClientRect();
        return {
          heading: tip.querySelector('.bc-tooltip-heading').textContent,
          lit: getComputedStyle(lit).display !== 'none' && { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        };
      });
      const where = `${name} "${title}" at ${width} px`;
      assert(got, `${where}: a card`);
      assert.strictEqual(got.heading, heading, where);
      assert(got.lit, `${where}: the line lights up`);
      const slack = 0.5;
      assert(
        got.lit.left <= line.left + slack &&
          got.lit.right >= line.right - slack &&
          got.lit.top <= line.top + slack &&
          got.lit.bottom >= line.bottom - slack,
        `${where}: the box holds the whole line: ${JSON.stringify({ line, lit: got.lit })}`,
      );
      const across = line.width < line.height ? got.lit.right - got.lit.left : got.lit.bottom - got.lit.top;
      assert(across >= 7 && across <= 12, `${where}: a box about 8 px across, ${across}`);
      assert.deepStrictEqual(p.errors, []);
      await p.close();
    }
  }
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

// ───────────────────────── hexbin, Gantt, text at the edges ─────────────────────────

for (const width of [1100, 390, 360]) {
  test(`hexbin at ${width} px: regular hexagons inside the plot, from edge to edge along one axis`, async () => {
    const page = recipe('hexbin');
    const p = await open(page, width);
    // the same chart once more beside it, with its handle: a zoom to the whole view puts the plot's clip on
    const got = await p.evaluate(
      (spec) =>
        new Promise((done) => {
          const first = document.querySelector('.bc-section svg[viewBox]').parentElement;
          const host = document.createElement('div');
          host.style.width = first.getBoundingClientRect().width + 'px';
          first.parentElement.appendChild(host);
          const h = BC.chart(host, spec);
          const svg = host.querySelector('svg');
          const hexes = [...svg.querySelectorAll('[data-bc-layer="marks"] path')].map((e) => e.getBBox());
          h.setView('x', h.getView().x);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const c = svg.querySelector('clipPath rect');
              done({
                diagnostics: h.diagnostics,
                hexes: hexes.map((b) => [b.x, b.y, b.x + b.width, b.y + b.height]),
                plot: c && [
                  +c.getAttribute('x'),
                  +c.getAttribute('y'),
                  +c.getAttribute('x') + +c.getAttribute('width'),
                  +c.getAttribute('y') + +c.getAttribute('height'),
                ],
              });
            }),
          );
        }),
      page.charts[0].spec,
    );
    assert.deepStrictEqual(got.diagnostics, []);
    assert(got.plot && got.hexes.length > 100, `${got.hexes.length} hexagons`);
    const [l, t, r, b] = got.plot;
    const ext = [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...got.hexes.map((h) => h[k])));
    assert(ext[0] >= l - 0.05 && ext[1] >= t - 0.05 && ext[2] <= r + 0.05 && ext[3] <= b + 0.05, `inside: ${ext} in ${got.plot}`);
    const across = Math.abs(ext[0] - l) < 0.05 && Math.abs(ext[2] - r) < 0.05;
    const up = Math.abs(ext[1] - t) < 0.05 && Math.abs(ext[3] - b) < 0.05;
    assert(across || up, `edge to edge: ${ext} in ${got.plot}`);
    for (const h of got.hexes) {
      const ratio = (h[2] - h[0]) / (h[3] - h[1]);
      assert(Math.abs(ratio / (Math.sqrt(3) / 2) - 1) < 0.005, `a hexagon ${ratio} wide per tall`);
    }
    assert.deepStrictEqual(p.errors, []);
    await p.close();
  });
}

for (const width of [1100, 390, 360]) {
  test(`gantt at ${width} px: the time axis starts on 1 January and names it`, async () => {
    const p = await open(recipe('gantt'), width);
    const got = await p.evaluate(() => {
      const svg = document.querySelector('.bc-section svg[viewBox]');
      const line = svg.querySelector('[data-bc-layer="axes"] path.bc-axis');
      const left = line.getBoundingClientRect().left;
      const labels = [...svg.querySelectorAll('[data-bc-layer="axes"] text.bc-axis-label')]
        .map((t) => ({ text: t.textContent, ...t.getBoundingClientRect().toJSON() }))
        .filter((t) => /^[A-Z][a-z]{2}$/.test(t.text));
      return { left, labels };
    });
    const names = got.labels.map((t) => t.text);
    assert.strictEqual(names[0], 'Jan', names.join(' '));
    assert.strictEqual(names[names.length - 1], 'Jul', names.join(' '));
    const jan = got.labels[0];
    assert(
      Math.abs((jan.left + jan.right) / 2 - got.left) < 1,
      `Jan stands at the start of the axis: ${jan.left}..${jan.right} / ${got.left}`,
    );
    // a plan wants its months: on a phone too every other one at least
    assert(names.length >= (width > 500 ? 7 : 4), names.join(' '));
    await p.close();
  });
}

for (const width of [1100, 390]) {
  test(`every recipe at ${width} px: no line of text reaches above or below its chart`, async () => {
    const out = [];
    for (const file of fs.readdirSync(path.join(__dirname, '../skills/blockcharts/recipes'))) {
      const p = await open(recipe(file.replace(/\.json$/, '')), width);
      const bad = await p.evaluate(() => {
        const found = [];
        for (const svg of document.querySelectorAll('.bc-section svg[viewBox]')) {
          const s = svg.getBoundingClientRect();
          for (const t of svg.querySelectorAll('text')) {
            const r = t.getBoundingClientRect();
            // up and down only: across, a label's width is the font's, and the fonts of the test machines differ more
            const over = Math.max(s.top - r.top, r.bottom - s.bottom);
            if (r.width && over > 0.5) found.push(`"${t.textContent.slice(0, 30)}" by ${over.toFixed(2)} px`);
          }
        }
        return found;
      });
      for (const b of bad) out.push(`${file}: ${b}`);
      assert.deepStrictEqual(p.errors, [], file);
      await p.close();
    }
    assert.deepStrictEqual(out, []);
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
