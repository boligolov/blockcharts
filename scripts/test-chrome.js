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
/** A font as wide as DejaVu Sans, the sans-serif of a Linux runner: Verdana has its widths, and where Verdana is missing
 *  (on Linux) the page falls back on DejaVu Sans itself. The tests of text that must fit run in it as well as in the
 *  machine's own font, so a run on any machine sees what CI sees. */
const WIDE = 'Verdana, "DejaVu Sans", sans-serif';
/** Each font a test of fitting text runs in: the page's own, and WIDE. */
const FONTS = [null, WIDE];
const inFont = (font) => (font ? ' in a wide font' : '');

/** A page of the given charts, open at `width` px (in `font` when given), with what it logged as errors. */
async function open(page, width, height = 900, font = null) {
  const r = compose(page);
  assert.deepStrictEqual(
    r.diagnostics.filter((d) => d.level === 'error'),
    [],
  );
  const file = path.join(dir, `page-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, font ? r.html.replace('</head>', `<style>body{font-family:${font}}</style></head>`) : r.html);
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

for (const font of FONTS)
  test(`tooltip: a card is as wide as its text asks, wherever the card before it stood${inFont(font)}`, async () => {
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
    const p = await open(mixed, 390, 900, font);
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
      size: parseFloat(getComputedStyle(t).fontSize),
      px: parseFloat(getComputedStyle(t).fontSize) * scale,
      ...rect(t),
    }));
    const names = [...svg.querySelectorAll('[data-bc-layer="axes"] text.bc-axis-label')].map((t) => ({
      slanted: /rotate\(-45/.test(t.getAttribute('transform') || ''),
      ...rect(t),
    }));
    const bars = [...svg.querySelectorAll('[data-bc-layer="marks"] rect')].map(rect).sort((a, b) => a.left - b.left);
    return { svg: rect(svg), figures, names, bars };
  }, title);

// 360 px: a small Android phone, the narrowest common screen
for (const [name, title, width] of [
  ['waterfall', 'From revenue to operating profit', 360],
  ['waterfall', 'From revenue to operating profit', 390],
  ['executive-dashboard', 'From revenue to operating profit', 390],
]) {
  for (const font of FONTS)
    test(`${name} at ${width} px${inFont(font)}: every figure at full size and clear of the others, the names at an angle with no empty band under them`, async () => {
      const p = await open(recipe(name), width, 900, font);
      const { svg, figures, names, bars } = await bridgeOf(p, title);
      assert.strictEqual(figures.length, 7);
      // one size for the row, the full one, unless the font is too wide for it: a figure at full size wider than the room
      // between the bars beside it (bold DejaVu Sans at 360 px) makes the row smaller, by a px at most
      const sizes = [...new Set(figures.map((f) => f.size))];
      assert.strictEqual(sizes.length, 1, `one size for the row: ${sizes}`);
      const room = 2 * (bars[1].left - bars[0].left) - (bars[0].right - bars[0].left) - 4;
      const widest = Math.max(...figures.map((f) => ((f.right - f.left) * 11) / f.size));
      assert(
        figures.every((f) => f.px >= 11) || (widest > room && sizes[0] >= 10),
        `figures at ${sizes[0]} px, the widest ${widest.toFixed(1)} px at full size in ${room.toFixed(1)} px`,
      );
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

for (const width of [360, 390, 1100])
  for (const font of FONTS)
    test(`marimekko at ${width} px${inFont(font)}: every column named over its middle, at full size, in one row above the plot`, async () => {
      const p = await open(recipe('marimekko'), width, 900, font);
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

// ───────────────────────── a treemap's cells ─────────────────────────

test('treemap: near-square cells on a phone and, after the window widens, on a desk; every region named somewhere', async () => {
  const p = await open(recipe('treemap'), 390);
  /** Each cell's color, how much longer than wide (or wider than long) it is on the screen, and the names drawn in it. */
  const cells = () =>
    p.evaluate(() => {
      const svg = document.querySelector('.bc-section svg[viewBox]');
      const names = [...svg.querySelectorAll('[data-bc-layer="marks"] text')].map((t) => t.getBoundingClientRect());
      return [...svg.querySelectorAll('[data-bc-layer="marks"] path, [data-bc-layer="marks"] rect')].map((e) => {
        const r = e.getBoundingClientRect();
        const named = names.filter((n) => n.left >= r.left && n.right <= r.right && n.top >= r.top && n.bottom <= r.bottom).length;
        return { fill: e.getAttribute('fill'), shape: Math.max(r.width / r.height, r.height / r.width), named };
      });
    });
  const check = (got, where) => {
    assert.strictEqual(got.length, 11, where);
    const shapes = got.map((c) => c.shape);
    const mean = shapes.reduce((a, s) => a + s, 0) / shapes.length;
    assert(mean < 2 && Math.max(...shapes) < 4.5, `${where}: near square: ${shapes.map((s) => s.toFixed(1)).join(' ')}`);
    // Latin America's two cells are under 3% of the whole each, and went without a name
    const fills = new Set(got.map((c) => c.fill));
    assert.strictEqual(fills.size, 4, where);
    for (const f of fills)
      assert(
        got.some((c) => c.fill === f && c.named),
        `${where}: a cell of ${f} is named`,
      );
  };
  check(await cells(), 'phone');
  await p.setViewportSize({ width: 1100, height: 900 });
  await p.waitForTimeout(300);
  check(await cells(), 'desk');
  assert.deepStrictEqual(p.errors, []);
  await p.close();
});

// ───────────────────────── a screen reader and the keyboard ─────────────────────────

test('screen reader: every chart of the executive dashboard has a name, a KPI tile its figure, a filtered legend its buttons', async () => {
  const p = await open(recipe('executive-dashboard'), 1100);
  const tree = await p.locator('main').ariaSnapshot();
  const charts = [...tree.matchAll(/^\s*- (img|group) "([^"]*)"/gm)].map((m) => [m[1], m[2]]);
  assert.strictEqual(charts.length, 8, tree);
  for (const [, name] of charts) assert(name.trim(), 'named: ' + tree);
  assert(/^Revenue, December\. \$[\d.]+K\. \+[\d.]+% vs November$/.test(charts[0][1]), charts[0][1]);
  assert(
    charts.some(([role, name]) => role === 'group' && name === 'Revenue by channel'),
    tree,
  );
  // in a group only the switches are read out, not the ticks one after another
  assert(/- group "Revenue by channel":\n(\s+- button "[^"]+" \[pressed\]\n){5}/.test(tree + '\n'), tree);
  await p.close();
});

test('keyboard: Tab reaches the legend, Enter and Space hide and show, Shift+Enter isolates; the focus stays and shows', async () => {
  const p = await open(recipe('grouped-bar'), 1100);
  const state = () =>
    p.evaluate(() => {
      const svg = document.querySelector('.bc-section svg[viewBox]');
      const a = document.activeElement;
      return {
        focused: a && a.classList && a.classList.contains('bc-legend-item') ? a.textContent : null,
        ring: !!(a && a.matches && a.matches(':focus-visible') && getComputedStyle(a).outlineStyle === 'solid'),
        pressed: [...svg.querySelectorAll('[aria-pressed]')].map((e) => e.getAttribute('aria-pressed')).join(' '),
        bars: svg.querySelectorAll('[data-bc-layer="marks"] [data-bc-mark]').length,
      };
    });
  let s;
  for (let k = 0; k < 10 && !(s && s.focused); k++) {
    await p.keyboard.press('Tab');
    s = await state();
  }
  assert.strictEqual(s.focused, 'Hardware', 'Tab reaches the first item');
  assert(s.ring, 'and shows where it is');
  const press = async (key) => {
    await p.keyboard.press(key);
    await p.waitForTimeout(150);
    return state();
  };
  s = await press('Enter');
  assert.deepStrictEqual([s.focused, s.pressed, s.bars], ['Hardware', 'false true true', 8], 'hidden, and the focus stays on it');
  await p.keyboard.press('Tab');
  s = await press('Space');
  assert.deepStrictEqual([s.focused, s.pressed, s.bars], ['Software', 'false false true', 4]);
  assert.strictEqual(await p.evaluate(() => scrollY), 0, 'Space does not scroll the page');
  s = await press('Shift+Enter');
  assert.deepStrictEqual([s.pressed, s.bars], ['false true false', 4], 'Software alone');
  s = await press('Shift+Enter');
  assert.deepStrictEqual([s.focused, s.pressed, s.bars], ['Software', 'true true true', 12], 'everything again');
  // a click focuses the item too, without a ring
  await p.locator('.bc-legend-item').nth(2).click();
  await p.waitForTimeout(150);
  s = await state();
  assert.deepStrictEqual([s.focused, s.ring, s.pressed], ['Services', false, 'true true false']);
  assert.deepStrictEqual(p.errors, []);
  await p.close();
});

test('keyboard: the legend over a facet is buttons of the page; a key, held or not, toggles once, Shift+Enter isolates', async () => {
  const rows = [];
  for (const r of ['North', 'South'])
    for (const k of ['Tea', 'Coffee', 'Cocoa']) rows.push({ r, k, v: k.length + (r === 'North' ? 1 : 2) });
  const p = await open(
    {
      title: 'Facet',
      data: { d: rows },
      charts: [
        {
          title: 'Drinks by region',
          facet: { field: 'r' },
          spec: {
            data: 'd',
            size: [300, 200],
            scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
            guides: [{ type: 'legend', scale: 'color' }],
            marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
            interaction: [{ type: 'legend-filter' }],
          },
        },
      ],
    },
    1100,
  );
  const names = await p.$$eval('.bc-facet svg', (s) => s.map((e) => e.getAttribute('aria-label')));
  assert.deepStrictEqual(names, ['Drinks by region: North', 'Drinks by region: South'], 'a panel by its card and value');
  const bars = () => p.$$eval('.bc-facet svg', (s) => s.map((e) => e.querySelectorAll('[data-bc-layer="marks"] [data-bc-mark]').length));
  assert.deepStrictEqual(await bars(), [3, 3]);
  await p.evaluate(() => (document.body.style.minHeight = '3000px'));
  await p.focus('.bc-facet-legend button:nth-of-type(2)');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  assert.deepStrictEqual(await bars(), [2, 2], 'Enter: Coffee hidden, and not shown again by a click as well');
  await p.keyboard.press('Space');
  await p.waitForTimeout(150);
  assert.deepStrictEqual(await bars(), [3, 3], 'Space: shown, once');
  assert.strictEqual(await p.evaluate(() => scrollY), 0, 'Space does not scroll the page');
  // a button clicks on every repeat of a key held down: the filter does it once
  for (let k = 0; k < 4; k++) await p.keyboard.down('Enter');
  await p.keyboard.up('Enter');
  await p.waitForTimeout(150);
  assert.deepStrictEqual(await bars(), [2, 2], 'Enter held down: hidden once');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  await p.keyboard.press('Shift+Enter');
  await p.waitForTimeout(150);
  assert.deepStrictEqual(await bars(), [1, 1], 'Shift+Enter: Coffee alone, and not toggled by a click as well');
  assert.deepStrictEqual(await p.$$eval('.bc-facet-legend button', (b) => b.map((e) => e.getAttribute('aria-pressed'))), [
    'false',
    'true',
    'false',
  ]);
  assert.deepStrictEqual(p.errors, []);
  await p.close();
});

// ───────────────────────── KPI tiles ─────────────────────────

/** Every card of a page: where it is, whether it is a KPI tile, and how its chart is drawn (px of text on the screen). */
const cardsOf = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('.bc-section')].map((s) => {
      const r = s.getBoundingClientRect();
      const svg = s.querySelector('svg[viewBox]');
      const box = svg.getBoundingClientRect();
      const scale = box.width / svg.viewBox.baseVal.width;
      const px = (cls) => {
        const t = svg.querySelector(`.bc-kpi-${cls}`);
        return t ? Number(t.getAttribute('font-size')) * scale : null;
      };
      return {
        title: (s.querySelector('h2,h3') || {}).textContent || '',
        left: r.left,
        top: r.top,
        width: r.width,
        svgWidth: box.width,
        viewBoxWidth: svg.viewBox.baseVal.width,
        value: px('value'),
        label: px('label'),
        delta: px('delta'),
      };
    }),
  );

for (const width of [390, 320]) {
  test(`KPI tiles at ${width} px: two to a row at their own width, text at its size; the donut beside them takes the row`, async () => {
    const p = await open(recipe('executive-dashboard'), width);
    const cards = await cardsOf(p);
    const tiles = cards.filter((c) => c.value !== null);
    assert.strictEqual(tiles.length, 4);
    for (const [a, b] of [
      [0, 1],
      [2, 3],
    ]) {
      assert(Math.abs(tiles[a].top - tiles[b].top) < 1 && tiles[a].left < tiles[b].left, `tiles ${a} and ${b} share a row`);
    }
    assert(tiles[2].top > tiles[0].top + 50, 'two rows of two');
    const whole = cards.find((c) => c.title === 'Revenue against plan').width;
    for (const t of tiles) {
      assert(t.width < whole / 2, 'half a row');
      // laid out at the width of the card, not at 200 px and scaled down to two thirds
      assert(Math.abs(t.svgWidth - t.viewBoxWidth) < 1, `drawn at ${t.viewBoxWidth}, shown at ${t.svgWidth}`);
      assert(t.label >= 10 && t.delta >= 10, `label ${t.label} px, change ${t.delta} px`);
      assert(t.value >= (width >= 390 ? 26 : 22), `value ${t.value} px`);
    }
    assert(Math.abs(cards.find((c) => c.title === 'Revenue by channel').width - whole) < 1, 'the donut of span 1 takes the whole row');
    assert.deepStrictEqual(p.errors, []);
    await p.close();
  });
}

test('KPI tiles: the last of an odd run takes the whole row on a phone, beside nothing', async () => {
  const page = recipe('executive-dashboard');
  page.charts.splice(3, 1); // three tiles
  const p = await open(page, 390);
  const tiles = (await cardsOf(p)).filter((c) => c.value !== null);
  assert.strictEqual(tiles.length, 3);
  assert(Math.abs(tiles[0].top - tiles[1].top) < 1, 'two side by side');
  assert(tiles[2].width > tiles[0].width * 1.8, 'the third alone, as wide as the row');
  await p.close();
});

test('KPI tile: stretched to the height of a chart beside it on a desk, its figure stands in the middle of the room', async () => {
  const p = await open(recipe('highlight-bar'), 1280);
  const gaps = await p.evaluate(() => {
    const tile = document.querySelector('.bc-tile');
    const card = tile.getBoundingClientRect();
    const style = getComputedStyle(tile);
    const host = tile.querySelector('.bc-chart').getBoundingClientRect();
    const before = [...tile.children].filter((c) => /^(H2|H3|P)$/.test(c.tagName)).pop();
    const above = host.top - before.getBoundingClientRect().bottom - parseFloat(getComputedStyle(before).marginBottom);
    const below = card.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth) - host.bottom;
    const next = tile.nextElementSibling.getBoundingClientRect();
    return { above, below, stretched: Math.abs(card.height - next.height) };
  });
  assert(gaps.stretched < 1, 'as high as the chart beside it');
  assert(gaps.above > 40, `room was left over: ${gaps.above}`);
  assert(Math.abs(gaps.above - gaps.below) < 2, `as much room above the figure as below it: ${gaps.above} / ${gaps.below}`);
  await p.close();
});

for (const width of [1100, 390])
  for (const font of FONTS)
    test(`every recipe at ${width} px${inFont(font)}: no line of text reaches out of its chart`, async () => {
      const out = [];
      for (const file of fs.readdirSync(path.join(__dirname, '../skills/blockcharts/recipes'))) {
        const p = await open(recipe(file.replace(/\.json$/, '')), width, 900, font);
        const bad = await p.evaluate(() => {
          const found = [];
          for (const svg of document.querySelectorAll('.bc-section svg[viewBox]')) {
            const s = svg.getBoundingClientRect();
            for (const t of svg.querySelectorAll('text')) {
              const r = t.getBoundingClientRect();
              // on every side: a label is measured in the font it is drawn in, whatever the machine has
              const over = Math.max(s.top - r.top, r.bottom - s.bottom, s.left - r.left, r.right - s.right);
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
