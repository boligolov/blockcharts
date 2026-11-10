// Tests for the business blocks (guide.kpi, transform.waterfall / funnel / treemap, mark.rule, bar thickness) and for the
// dashboard look (quiet axes, smooth curves, fading areas, the card tooltip). Loaded by test.js.
const assert = require('assert');

module.exports = function ({ test, FakeNode, svgOf, count, flush }) {
  const paths = (svg) => [...svg.matchAll(/<path d="([^"]+)"([^>]*)>/g)].map((m) => ({ d: m[1], attrs: m[2] }));
  const rects = (svg) =>
    [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)].map((m) => ({
      x: +m[1],
      y: +m[2],
      w: +m[3],
      h: +m[4],
    }));
  const texts = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const layer = (svg, name) => {
    const i = svg.indexOf(`data-bc-layer="${name}"`);
    return svg.slice(i, svg.indexOf('</g>', i));
  };
  const draw = (spec) => {
    const host = new FakeNode('div');
    const h = BC.chart(host, spec);
    return { host, h, svg: svgOf(host) };
  };
  const apply = (type, rows, spec) => {
    const cols = {};
    for (const k of Object.keys(rows[0] || {})) cols[k] = rows.map((r) => r[k]);
    return BC.get(`transform.${type}`).apply({ length: rows.length, columns: cols }, { type, ...spec });
  };
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  BC.data('months', [
    { m: '2024-01-01', rev: 100, cost: 60, target: 120 },
    { m: '2024-02-01', rev: 130, cost: 70, target: 120 },
    { m: '2024-03-01', rev: 90, cost: 65, target: 120 },
    { m: '2024-04-01', rev: 160, cost: 80, target: 120 },
  ]);
  const monthly = (extra) => ({
    data: 'months',
    scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } },
    marks: [{ type: 'line', x: 'm', y: 'rev' }],
    ...extra,
  });

  // ───────────────────────── the quiet axis ─────────────────────────

  test('guide.axis: by default no tick marks, a line along a horizontal axis only; ticks and line can be asked for', () => {
    const quiet = draw(
      monthly({
        guides: [
          { type: 'axis', scale: 'x' },
          { type: 'axis', scale: 'y' },
        ],
      }),
    );
    const axisPaths = paths(layer(quiet.svg, 'axes')).filter((p) => /class="bc-axis"/.test(p.attrs));
    assert.strictEqual(axisPaths.length, 1, 'one axis line: the bottom one');
    assert(/^M[\d.]+ [\d.]+H[\d.]+$/.test(axisPaths[0].d), 'a plain horizontal baseline, no tick marks: ' + axisPaths[0].d);
    assert(count(quiet.svg, /class="bc-axis-label"/g) > 4, 'labels are there, with a class to style them');
    assert(/fill="var\(--bc-label, var\(--bc-text, #444\)\)"/.test(quiet.svg), 'labels in the quieter label color');

    const classic = draw(
      monthly({
        guides: [
          { type: 'axis', scale: 'x', ticks: true },
          { type: 'axis', scale: 'y', ticks: true, line: 'on' },
        ],
      }),
    );
    const lines = paths(layer(classic.svg, 'axes')).filter((p) => /class="bc-axis"/.test(p.attrs));
    assert.strictEqual(lines.length, 2, 'both axes drawn');
    assert(
      lines.every((p) => (p.d.match(/M/g) || []).length > 3),
      'with a tick mark per label',
    );

    const none = draw(monthly({ guides: [{ type: 'axis', scale: 'x', line: 'off' }] }));
    assert.strictEqual(count(none.svg, /class="bc-axis"/g), 0, 'line "off" leaves only the labels');
    assert.deepStrictEqual(
      BC.validate(monthly({ guides: [{ type: 'axis', scale: 'x', line: 'maybe' }] })).map((d) => d.path),
      ['guides[0].line'],
    );
  });

  // ───────────────────────── smooth lines, fading areas ─────────────────────────

  test('mark.line curve "smooth": passes through every point and never overshoots between two of them', () => {
    BC.data(
      'zig',
      [0, 10, 9, 30, 2, 2, 2, 25].map((v, i) => ({ x: i, y: v })),
    );
    const { svg } = draw({
      data: 'zig',
      size: [640, 400],
      scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'line', x: 'x', y: 'y', curve: 'smooth' }],
    });
    const d = paths(layer(svg, 'marks'))[0].d;
    const segs = [...d.matchAll(/C([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g)].map((m) => m.slice(1).map(Number));
    assert.strictEqual(segs.length, 7, 'one cubic per gap between points');
    const start = /^M([\d.-]+) ([\d.-]+)/.exec(d).slice(1).map(Number);
    let prev = start;
    for (const [c1x, c1y, c2x, c2y, x, y] of segs) {
      const lo = Math.min(prev[1], y) - 0.01;
      const hi = Math.max(prev[1], y) + 0.01;
      // a cubic stays inside the hull of its control points: controls within the two ends = no overshoot
      assert(c1y >= lo && c1y <= hi && c2y >= lo && c2y <= hi, `controls ${c1y}, ${c2y} stay between ${prev[1]} and ${y}`);
      assert(c1x > prev[0] && c2x < x, 'controls go forward in x');
      prev = [x, y];
    }
    const flat = draw({ data: 'zig', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'x', y: 'y' }] });
    assert(!/C/.test(paths(layer(flat.svg, 'marks'))[0].d), 'straight segments by default');
  });

  test('mark.line curve: gaps still break the line, two points and repeated x stay finite', () => {
    BC.data('holes', [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: null },
      { x: 3, y: 2 },
      { x: 4, y: 5 },
      { x: 5, y: 4 },
    ]);
    const { svg } = draw({
      data: 'holes',
      scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'line', x: 'x', y: 'y', curve: 'smooth' }],
    });
    const d = paths(layer(svg, 'marks'))[0].d;
    assert.strictEqual((d.match(/M/g) || []).length, 2, 'two runs');
    assert(/^M[\d.]+ [\d.]+L/.test(d), 'a run of two points is a straight segment');
    BC.data('samex', [
      { x: 1, y: 1 },
      { x: 1, y: 5 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    const same = draw({
      data: 'samex',
      scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'line', x: 'x', y: 'y', curve: 'smooth' }],
    });
    assert(!/NaN|Infinity/.test(same.svg), 'two rows at the same x do not divide by zero');
  });

  test('mark.area fade: a gradient over the plot, no outline, shared by areas of one color; smooth edges both ways', () => {
    const spec = monthly({
      marks: [
        { type: 'area', x: 'm', y: 'rev', fade: true, curve: 'smooth', fill: '#3a6fe4' },
        { type: 'area', x: 'm', y: 'cost', fade: true, fill: '#3a6fe4' },
      ],
    });
    const { svg } = draw(spec);
    assert.strictEqual(count(svg, /<linearGradient /g), 1, 'one gradient for one color and opacity');
    assert(/<linearGradient id="bc-fade-\d+" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="[\d.]+" y2="[\d.]+">/.test(svg));
    assert(
      /stop-color:#3a6fe4;stop-opacity:0.45/.test(svg) && /stop-color:#3a6fe4;stop-opacity:0/.test(svg),
      'from the color at 0.45 to transparent',
    );
    const areas = paths(layer(svg, 'marks'));
    assert(
      areas.every((p) => /fill="url\(#bc-fade-\d+\)"/.test(p.attrs) && !/stroke=/.test(p.attrs) && !/fill-opacity/.test(p.attrs)),
      'filled by the gradient, no outline',
    );
    assert(/C/.test(areas[0].d) && /Z$/.test(areas[0].d), 'the smooth area is a closed curve');

    const plain = draw(monthly({ marks: [{ type: 'area', x: 'm', y: 'rev' }] }));
    assert(!/linearGradient/.test(plain.svg) && /fill-opacity="0.85"/.test(plain.svg), 'without fade: as before');
  });

  test('fade: a color cannot smuggle CSS into the gradient, and a var() color is kept for theming', () => {
    const smuggled = monthly({ marks: [{ type: 'area', x: 'm', y: 'rev', fade: true, fill: 'red;background:url(x)}<b>' }] });
    assert.deepStrictEqual(
      BC.validate(smuggled)
        .filter((d) => d.level === 'error')
        .map((d) => d.path),
      ['marks[0].fill'],
      'it is not a color, so the spec is refused before anything is drawn',
    );
    const { svg } = draw(smuggled);
    assert(!/url\(x\)/.test(svg), 'nothing reaches the gradient');
    const themed = draw(monthly({ marks: [{ type: 'area', x: 'm', y: 'rev', fade: true }] }));
    assert(/stop-color:var\(--bc-c0, #[0-9a-f]+\);/.test(themed.svg), 'the theme variable reaches the gradient');
  });

  // ───────────────────────── guide.kpi ─────────────────────────

  const kpiTexts = (svg) => {
    const out = {};
    for (const m of svg.matchAll(/<text [^>]*fill="([^"]+)"[^>]*class="bc-kpi-(\w+)"[^>]*>([^<]*)<\/text>/g))
      out[m[2]] = { text: m[3], fill: m[1] };
    return out;
  };

  test('guide.kpi: the last value, its change against the row before, green when it rises', () => {
    const { svg, h } = draw(
      monthly({
        guides: [
          {
            type: 'kpi',
            field: 'rev',
            label: 'Revenue',
            format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
            note: 'vs March',
          },
        ],
      }),
    );
    assert.deepStrictEqual(h.diagnostics, []);
    const k = kpiTexts(svg);
    assert.strictEqual(k.label.text, 'Revenue');
    assert.strictEqual(k.value.text, '$160');
    assert.strictEqual(k.delta.text, '▲ +77.8%', '160 against 90');
    assert(/--bc-good/.test(k.delta.fill), 'rising revenue is good');
    assert.strictEqual(k.note.text, 'vs March');
  });

  test('guide.kpi: better "down", sum, against a field, absolute change, no comparison', () => {
    const cost = kpiTexts(draw(monthly({ guides: [{ type: 'kpi', field: 'cost', better: 'down' }] })).svg);
    assert(/--bc-bad/.test(cost.delta.fill), 'costs going up are bad');
    const sum = kpiTexts(
      draw(monthly({ guides: [{ type: 'kpi', field: 'rev', aggregate: 'sum', against: 'target', delta: 'absolute' }] })).svg,
    );
    assert.strictEqual(sum.value.text, '480');
    assert.strictEqual(sum.delta.text, '■ 0', 'sum 480 against a summed target of 480: no change, written as a difference');
    const againstTarget = kpiTexts(draw(monthly({ guides: [{ type: 'kpi', field: 'rev', against: 'target' }] })).svg);
    assert.strictEqual(againstTarget.delta.text, '▲ +33.3%', 'last revenue 160 against the last target 120');
    const none = kpiTexts(draw(monthly({ guides: [{ type: 'kpi', field: 'rev', aggregate: 'mean' }] })).svg);
    assert.strictEqual(none.value.text, '120');
    assert.strictEqual(none.delta, undefined, 'a mean has nothing to compare with by default');
    const first = kpiTexts(draw(monthly({ guides: [{ type: 'kpi', field: 'rev', compare: 'first' }] })).svg);
    assert.strictEqual(first.delta.text, '▲ +60%', 'change over the period');
  });

  test('guide.kpi: flat, zero, empty and non-numeric data do not break it', () => {
    const flatRows = [
      { t: 1, v: 5 },
      { t: 2, v: 5 },
    ];
    BC.data('flat', flatRows);
    const flat = kpiTexts(draw({ data: 'flat', marks: [], guides: [{ type: 'kpi', field: 'v' }] }).svg);
    assert.strictEqual(flat.delta.text, '■ 0%');
    assert(/--bc-label/.test(flat.delta.fill), 'no change is neither good nor bad');
    BC.data('fromzero', [{ v: 0 }, { v: 7 }]);
    assert.strictEqual(
      kpiTexts(draw({ data: 'fromzero', marks: [], guides: [{ type: 'kpi', field: 'v' }] }).svg).delta.text,
      '▲',
      'from zero there is a direction but no percentage',
    );
    BC.data('junk', [{ v: 'n/a' }, { v: null }, { v: 'x' }]);
    const junk = kpiTexts(draw({ data: 'junk', marks: [], guides: [{ type: 'kpi', field: 'v' }] }).svg);
    assert.strictEqual(junk.value.text, '–', 'no number: a dash, not NaN');
    assert.strictEqual(junk.delta, undefined);
    BC.data('none', []);
    const empty = draw({ data: 'none', marks: [], guides: [{ type: 'kpi', field: 'v', label: 'Orders' }] });
    assert(!/NaN|undefined/.test(empty.svg), 'an empty dataset draws a label and a dash');
    const hostile = draw({ data: 'flat', marks: [], guides: [{ type: 'kpi', field: 'v', label: '<b>x</b>' }] }).host;
    assert(!hostile.children[0].serialize().includes('<b>x</b>'), 'a label is text, not markup');
  });

  test('guide.kpi: min and max of a long series (300,000 rows) do not overflow the stack', () => {
    const v = new Float64Array(300000).map((_, i) => (i === 123456 ? -7 : i));
    BC.data('longkpi', { columns: { v } });
    for (const [aggregate, want] of [
      ['max', '300K'],
      ['min', '-7'],
    ]) {
      const { svg, h } = draw({ data: 'longkpi', marks: [], guides: [{ type: 'kpi', field: 'v', aggregate }] });
      assert.deepStrictEqual(h.diagnostics, [], aggregate);
      assert.strictEqual(kpiTexts(svg).value.text, want, aggregate);
    }
  });

  test('guide.kpi: the figure is of all the rows, also when decimate thins the sparkline under it', () => {
    // 2000 daily values of 1 under a 300 px sparkline: decimate keeps a few rows per pixel column
    BC.data('kpidecimate', { columns: { t: Float64Array.from({ length: 2000 }, (_, i) => i), v: new Float64Array(2000).fill(1) } });
    const { svg, h } = draw({
      data: 'kpidecimate',
      size: [300, 160],
      transforms: [{ type: 'decimate', x: 't', y: 'v' }],
      scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'line', x: 't', y: 'v' }],
      guides: [{ type: 'kpi', field: 'v', aggregate: 'sum', format: 'integer' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    assert(count(layer(svg, 'marks'), /L/g) < 1999, 'the line is decimated');
    assert.strictEqual(kpiTexts(svg).value.text, '2,000', 'the sum of every row');
  });

  test('guide.kpi: takes room at the top (the chart under it is a sparkline), and a tile of the guide alone is valid', () => {
    const top = (svg) =>
      Math.min(...paths(layer(svg, 'marks')).map((p) => Math.min(...[...p.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2]))));
    const bare = draw(monthly({ size: [300, 160] }));
    const tile = draw(monthly({ size: [300, 160], guides: [{ type: 'kpi', field: 'rev', label: 'Revenue' }] }));
    assert(top(tile.svg) > top(bare.svg) + 50, 'the sparkline starts below the figure');
    assert.deepStrictEqual(
      BC.validate({ data: 'months', marks: [], guides: [{ type: 'kpi', field: 'rev' }] }),
      [],
      'no marks, one guide: fine',
    );
    const d = BC.validate({ data: 'months', marks: [] });
    assert(
      d.some((x) => x.path === 'marks' && /at least one mark/.test(x.message)),
      'nothing to draw is still an error',
    );
    assert(
      BC.validate({ data: 'months', guides: [{ type: 'kpi', field: 'rev' }] }).some(
        (x) => x.path === 'marks' && /must be a list/.test(x.message),
      ),
    );
    const bad = BC.validate({ data: 'months', marks: [], guides: [{ type: 'kpi', field: 'revnue', aggregate: 'median' }] });
    assert(
      bad.some((x) => x.path === 'guides[0].field' && /unknown field "revnue"/.test(x.message)),
      'a misspelt field is caught',
    );
    assert(
      bad.some((x) => x.path === 'guides[0].aggregate'),
      'so is an aggregate it does not have',
    );
    assert(BC.validate({ data: 'months', marks: [], guides: [{ type: 'kpi' }] }).some((x) => /requires "field"/.test(x.message)));
  });

  // ───────────────────────── transform.waterfall ─────────────────────────

  test('transform.waterfall: running totals, subtotals from 0, kinds; gaps change nothing', () => {
    const t = apply(
      'waterfall',
      [
        { k: 'Start', v: 100, tot: false },
        { k: 'Sales', v: 40, tot: false },
        { k: 'Refunds', v: -15, tot: false },
        { k: 'Gap', v: null, tot: false },
        { k: 'Subtotal', v: 999, tot: true },
        { k: 'Costs', v: -60, tot: 0 },
        { k: 'End', v: null, tot: 'yes' },
      ],
      { field: 'v', total: 'tot' },
    );
    const c = t.columns;
    assert.deepStrictEqual(Array.from(c.v0).slice(0, 3), [0, 100, 140]);
    assert.deepStrictEqual(Array.from(c.v1).slice(0, 3), [100, 140, 125]);
    assert(isNaN(c.v0[3]) && isNaN(c.v1[3]) && c.step[3] === null, 'a gap draws nothing');
    assert.deepStrictEqual([c.v0[4], c.v1[4]], [0, 125], 'a subtotal ignores its own value and shows the running total');
    assert.deepStrictEqual([c.v0[5], c.v1[5]], [125, 65]);
    assert.deepStrictEqual([c.v0[6], c.v1[6]], [0, 65], '"yes" marks a total too');
    assert.deepStrictEqual(c.step, ['increase', 'increase', 'decrease', null, 'total', 'decrease', 'total']);
    assert.deepStrictEqual(
      Array.from(c.amount).map((v) => (isNaN(v) ? null : v)),
      [100, 40, -15, null, 125, -60, 65],
      'the change, or the total a subtotal shows',
    );
    assert.deepStrictEqual(Array.from(c.top).slice(0, 3), [100, 140, 140], 'the upper end: where a label goes');
    assert.strictEqual(c.k[1], 'Sales', 'other columns pass through');
    const named = apply('waterfall', [{ v: 5 }], { field: 'v', as: ['a', 'b'], kindAs: 'kind', start: 10 });
    assert.deepStrictEqual([named.columns.a[0], named.columns.b[0], named.columns.kind[0]], [10, 15, 'increase']);
  });

  test('transform.waterfall in a chart: bars float between their ends, validation knows the new columns', () => {
    BC.data('bridge', [
      { k: 'Q1', v: 100 },
      { k: 'Up', v: 30 },
      { k: 'Down', v: -50 },
      { k: 'Q2', v: 0, t: true },
    ]);
    const spec = {
      data: 'bridge',
      transforms: [{ type: 'waterfall', field: 'v', total: 't' }],
      scales: {
        x: { type: 'band' },
        y: { type: 'linear', zero: true },
        color: { type: 'color', domain: ['increase', 'decrease', 'total'] },
      },
      marks: [{ type: 'rect', x: 'k', y: 'v1', y2: 'v0', color: 'step' }],
    };
    const { svg, h } = draw(spec);
    assert.deepStrictEqual(h.diagnostics, []);
    const bars = rects(layer(svg, 'marks'));
    assert.strictEqual(bars.length, 4);
    assert(near(bars[1].y + bars[1].h, bars[0].y, 0.02), 'the second bar starts where the first ends');
    assert(near(bars[2].y, bars[1].y, 0.02), 'a loss hangs from the top of the running total');
    const bad = BC.validate({ ...spec, marks: [{ type: 'rect', x: 'k', y: 'v1', y2: 'v0', color: 'stp' }] });
    assert(
      bad.some((d) => /unknown field "stp"/.test(d.message)),
      'a typo in a produced column is caught',
    );
  });

  // ───────────────────────── transform.funnel ─────────────────────────

  test('transform.funnel: centered bars, share of the first stage and of the previous one; bad rows skipped', () => {
    const t = apply(
      'funnel',
      [
        { s: 'Visits', n: 1000 },
        { s: 'Sign-ups', n: 250 },
        { s: 'Broken', n: -3 },
        { s: 'Trials', n: 100 },
        { s: 'Paid', n: 0 },
      ],
      { field: 'n' },
    );
    const c = t.columns;
    assert.deepStrictEqual([c.n0[0], c.n1[0]], [-500, 500]);
    assert.deepStrictEqual([c.rate[1], c.stepRate[1]], [0.25, 0.25]);
    assert(isNaN(c.n0[2]) && isNaN(c.rate[2]), 'a negative count is not a stage');
    assert.deepStrictEqual([c.rate[3], c.stepRate[3]], [0.1, 0.4], 'the broken row is skipped when comparing');
    assert.deepStrictEqual([c.n0[4], c.n1[4], c.rate[4], c.stepRate[4]], [-0, 0, 0, 0]);
    assert(isNaN(c.stepRate[0]), 'the first stage has no previous one');
    const zero = apply('funnel', [{ n: 0 }, { n: 0 }], { field: 'n' });
    assert(isNaN(zero.columns.rate[0]) && isNaN(zero.columns.stepRate[1]), 'nothing is divided by zero');
  });

  const marks = (svg) => layer(svg, 'marks');
  // ───────────────────────── mark.candlestick ────
  const candlesOf = (rows, extra = {}, x = { type: 'time' }) => {
    BC.data('ohlc', rows);
    return draw({
      data: 'ohlc',
      size: [600, 300],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      scales: { x, y: { type: 'linear', domain: [0, 100], nice: false } },
      marks: [{ type: 'candlestick', x: 'd', open: 'o', high: 'h', low: 'l', close: 'c', ...extra }],
    });
  };
  const OHLC = [
    { d: '2024-01-01', o: 20, h: 60, l: 10, c: 50 },
    { d: '2024-02-01', o: 50, h: 55, l: 25, c: 30 },
    { d: '2024-03-01', o: 30, h: 30, l: 30, c: 30 },
  ];

  test('mark.candlestick: body from open to close, wick from low to high, color by direction', () => {
    const svg = marks(candlesOf(OHLC).svg);
    const bodies = rects(svg);
    assert.strictEqual(bodies.length, 3);
    const y = (v) => 300 - v * 3;
    assert(near(bodies[0].y, y(50), 0.01) && near(bodies[0].h, 90, 0.01), 'a rise: ' + JSON.stringify(bodies[0]));
    assert(near(bodies[1].y, y(50), 0.01) && near(bodies[1].h, 60, 0.01), 'a fall hangs from its open');
    assert(bodies[2].h >= 1, 'open equal to close still shows');
    const wicks = paths(svg);
    assert.strictEqual(wicks[0].d.split('L')[0].split(' ')[1], String(y(60)));
    assert.strictEqual(wicks[0].d.split('L')[1].split(' ')[1], String(y(10)));
    assert(/--bc-good/.test(wicks[0].attrs) && /--bc-bad/.test(wicks[1].attrs) && /--bc-good/.test(wicks[2].attrs));
    const other = paths(marks(candlesOf(OHLC, { up: '#111111', down: '#222222' }).svg));
    assert(/#111111/.test(other[0].attrs) && /#222222/.test(other[1].attrs));
  });

  test('mark.candlestick: a row with a price missing has no candle; widths stay real', () => {
    const svg = marks(
      candlesOf([
        ...OHLC,
        { d: '2024-04-01', o: null, h: 60, l: 10, c: 50 },
        { d: '2024-05-01', o: 'x', h: 60, l: 10, c: 50 },
        { d: 'never', o: 1, h: 60, l: 10, c: 50 },
      ]).svg,
    );
    assert.strictEqual(rects(svg).length, 3);
    assert(!/NaN|Infinity/.test(svg));
    const lone = rects(marks(candlesOf([OHLC[0]], {}, { type: 'time', domain: ['2024-01-01', '2024-03-01'] }).svg));
    assert(lone[0].w > 0 && lone[0].w < 100, 'one candle: ' + lone[0].w);
    const band = rects(marks(candlesOf(OHLC, {}, { type: 'band' }).svg));
    assert(band[0].w > 50 && band[1].x > band[0].x + band[0].w, 'a band takes its share');
    assert(rects(marks(candlesOf(OHLC, { width: 5 }).svg))[0].w <= 300, 'a width past 1 is the whole step');
  });

  test('mark.candlestick: pick takes the nearest candle by x, and nothing far from any', () => {
    const { h } = candlesOf(OHLC);
    const ctx = {
      channel: (_s, n) => ({
        scale: {},
        mapped: { x: [100, 300, 500], open: [100, 100, 100], high: [50, 50, 50], low: [200, 200, 200], close: [80, 120, 100] }[n],
        raw: [1, 1, 1],
      }),
      rows: () => ({ from: 0, to: 3 }),
      plot: { x: 0, y: 0, w: 600, h: 300 },
    };
    const pick = (x) => BC.get('mark.candlestick').pick({ type: 'candlestick' }, ctx, 0, x, 10);
    assert.strictEqual(pick(104).row, 0);
    assert.strictEqual(pick(296).row, 1);
    assert.strictEqual(pick(200), null, 'halfway across a wide step is not on a candle');
    assert(pick(100).box.h === 20);
    h.destroy();
  });

  // ───────────────────────── transform.calendar ────
  test('transform.calendar: weeks, weekdays in order, at any start of the week', () => {
    const rows = [
      { d: '2024-01-07', v: 7 }, // a Sunday
      { d: '2024-01-01', v: 1 }, // a Monday
      { d: '2024-01-03', v: 3 },
      { d: '2024-01-08', v: 8 },
    ];
    const t = apply('calendar', rows, { field: 'd' });
    const dated = (list) => list.filter((_, i) => t.columns.week[i] !== null);
    assert.deepStrictEqual(dated(t.columns.day), ['Mon', 'Mon', 'Wed', 'Sun']);
    assert.deepStrictEqual(dated(t.columns.v), [1, 8, 3, 7], 'the rest of the row goes along');
    assert.deepStrictEqual(dated(t.columns.week), ['2024-01-01', '2024-01-08', '2024-01-01', '2024-01-01']);
    assert.deepStrictEqual(dated(t.columns.weekEnd), ['2024-01-08', '2024-01-15', '2024-01-08', '2024-01-08']);
    const sunday = apply('calendar', rows, { field: 'd', weekStart: 'sunday' });
    assert.strictEqual(sunday.columns.day[0], 'Sun');
    assert.deepStrictEqual(sunday.columns.week.slice(0, 2), ['2024-01-07', '2023-12-31']);
  });

  test('transform.calendar: a weekday with no rows keeps its place, and is not drawn', () => {
    const t = apply(
      'calendar',
      [
        { d: '2024-01-01', v: 1 },
        { d: '2024-01-03', v: 3 },
      ],
      { field: 'd' },
    );
    assert.deepStrictEqual(Array.from(new Set(t.columns.day)), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.strictEqual(t.length, 7);
    const tue = t.columns.day.indexOf('Tue');
    assert.strictEqual(t.columns.week[tue], null);
    assert.strictEqual(t.columns.v[tue], null);
    const sunday = apply('calendar', [{ d: '2024-01-03' }], { field: 'd', weekStart: 'sunday' });
    assert.deepStrictEqual(Array.from(new Set(sunday.columns.day)), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    BC.data('cal-gap', [
      { d: '2024-01-01', v: 1 },
      { d: '2024-01-10', v: 3 },
    ]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'cal-gap',
      transforms: [{ type: 'calendar', field: 'd' }],
      scales: { x: { type: 'time' }, y: { type: 'band' }, color: { type: 'sequential' } },
      marks: [{ type: 'rect', x: 'week', x2: 'weekEnd', y: 'day', color: 'v' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    assert.strictEqual((h.getView().y || []).length, 7, 'seven rows on the axis');
    assert.strictEqual((host.children[0].serialize().match(/<rect/g) || []).filter(Boolean).length >= 2, true);
    h.destroy();
  });

  test('transform.calendar: before 1970, across a year, hostile rows and names', () => {
    const t = apply('calendar', [{ d: '1969-12-03' }, { d: '2023-12-31' }, { d: 'soon' }, { d: null }, { d: '' }], { field: 'd' });
    assert.strictEqual(t.columns.week.filter(Boolean).length, 2, 'rows without a date are left out');
    assert.deepStrictEqual(t.columns.week.filter(Boolean), ['1969-12-01', '2023-12-25']);
    assert.deepStrictEqual(Array.from(new Set(t.columns.day)).slice(2, 3), ['Wed']);
    assert.strictEqual(apply('calendar', [{ d: 'x' }], { field: 'd' }).length, 0);
    assert.throws(() => apply('calendar', [{ d: '2024-01-01' }], { field: 'nope' }), /unknown field "nope"/);
    assert.throws(() => apply('calendar', [{ d: '2024-01-01', week: 1 }], { field: 'd' }), /"week" is already a column/);
    assert.doesNotThrow(() => apply('calendar', [{ d: '2024-01-01', week: 1 }], { field: 'd', as: ['w', 'e', 'n'] }));
    assert.throws(() => apply('calendar', [{ d: '2024-01-01' }], { field: 'd', as: ['a', 'a', 'b'] }), /three different/);
    assert.throws(() => apply('calendar', [{ d: '2024-01-01' }], { field: 'd', weekStart: 'friday' }), /"weekStart"/);
  });

  // ───────────────────────── what the dashboards left open ────
  test('scale.time: month labels follow the language of the chart, and stay as they were without one', () => {
    BC.data('time-labels', [
      { d: '2024-01-01', v: 1 },
      { d: '2024-12-01', v: 2 },
    ]);
    const labels = (locale) => {
      const host = new FakeNode('div');
      const h = BC.chart(host, {
        data: 'time-labels',
        ...(locale ? { locale } : {}),
        scales: { x: { type: 'time' }, y: { type: 'linear' } },
        guides: [{ type: 'axis', scale: 'x' }],
        marks: [{ type: 'line', x: 'd', y: 'v' }],
      });
      const out = texts(svgOf(host));
      h.destroy();
      return out;
    };
    assert(
      labels().some((t) => /^Jan 2024$/.test(t)),
      labels().join(),
    );
    assert(
      labels('ja').some((t) => t === '2024年1月'),
      labels('ja').join(),
    );
    assert(
      labels('ko').some((t) => t === '2024년 1월'),
      labels('ko').join(),
    );
    assert(
      labels().some((t) => /^Jan 2024$/.test(t)),
      'one chart in Japanese does not change the next',
    );
  });

  test('mark.text: flip puts the label of a negative value past its end, on either axis', () => {
    BC.data('neg', [
      { k: 'a', v: 5 },
      { k: 'b', v: -5 },
    ]);
    const prims = (s) => {
      const host = new FakeNode('div');
      const h = BC.chart(host, { data: 'neg', scales: s.scales, marks: [s.mark] });
      const out = h.diagnostics.length ? h.diagnostics : host.children[0].serialize();
      h.destroy();
      return out;
    };
    const up = prims({
      scales: { x: { type: 'band' }, y: { type: 'linear' } },
      mark: { type: 'text', x: 'k', y: 'v', text: 'v', baseline: 'auto', dy: -4, negative: 'flip' },
    });
    assert.strictEqual(count(up, /dominant-baseline="hanging"/g), 1, up);
    const side = prims({
      scales: { x: { type: 'linear' }, y: { type: 'band' } },
      mark: { type: 'text', x: 'v', y: 'k', text: 'v', anchor: 'start', dx: 4, negative: 'flip' },
    });
    assert.strictEqual(count(side, /text-anchor="end"/g), 1, side);
    const same = prims({
      scales: { x: { type: 'band' }, y: { type: 'linear' } },
      mark: { type: 'text', x: 'k', y: 'v', text: 'v', baseline: 'auto', dy: -4 },
    });
    assert.strictEqual(count(same, /dominant-baseline="hanging"/g), 0, 'off by default');
  });

  test('mark.text: collide hide tries the other side of the point, then leaves the label out', () => {
    BC.data('close', [
      { x: 1, y: 1, n: 'first' },
      { x: 1, y: 1, n: 'second' },
      { x: 1, y: 1, n: 'third' },
      { x: 9, y: 9, n: 'far' },
    ]);
    const labels = (collide) => {
      const host = new FakeNode('div');
      const h = BC.chart(host, {
        data: 'close',
        scales: { x: { type: 'linear' }, y: { type: 'linear' } },
        marks: [{ type: 'text', x: 'x', y: 'y', text: 'n', baseline: 'auto', dy: -6, ...(collide ? { collide } : {}) }],
      });
      const svg = host.children[0].serialize();
      h.destroy();
      return svg;
    };
    assert.strictEqual(count(labels(), /<text/g) - count(labels('hide'), /<text/g), 1, 'one label had nowhere to go');
    const svg = labels('hide');
    assert(svg.includes('first') && svg.includes('second') && !svg.includes('third') && svg.includes('far'));
  });

  test('mark.text: a mid blue cell gets light text, a pale one dark', () => {
    BC.data('cells', [{ k: 'a', c: 'blue' }]);
    const on = (color) => {
      const host = new FakeNode('div');
      const h = BC.chart(host, {
        data: 'cells',
        scales: { x: { type: 'band' }, y: { type: 'band' }, color: { type: 'color', range: [color] } },
        marks: [{ type: 'text', x: 'k', y: 'k', text: 'k', on: 'c' }],
      });
      const svg = host.children[0].serialize();
      h.destroy();
      return svg;
    };
    assert(on('#4e79a7').includes('#fff'));
    assert(on('#edc948').includes('#111'));
  });

  test('mark.text: on a palette color the text is what the page says reads on it, with a fallback', () => {
    BC.data('palette', [{ k: 'a' }]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'palette',
      scales: { x: { type: 'band' }, y: { type: 'band' }, color: { type: 'color' } },
      marks: [{ type: 'text', x: 'k', y: 'k', text: 'k', on: 'k' }],
    });
    assert(/var\(--bc-on-c0, #(fff|111)\)/.test(svgOf(host)), svgOf(host));
    h.destroy();
  });

  test('transform.bin: log bins are equal ratios, and only positive values count', () => {
    const rows = [1, 3, 10, 30, 100, 1000, 0, -5, null].map((v) => ({ v }));
    const t = apply('bin', rows, { field: 'v', log: true, width: 1 });
    assert.deepStrictEqual(Array.from(t.columns.bin0), [1, 10, 100]);
    assert.deepStrictEqual(Array.from(t.columns.bin1), [10, 100, 1000]);
    assert.deepStrictEqual(Array.from(t.columns.count), [2, 2, 2]);
    const fine = apply('bin', rows, { field: 'v', log: true, bins: 6 });
    const ratios = Array.from(fine.columns.bin0, (b, i) => fine.columns.bin1[i] / b);
    assert(
      ratios.every((r) => Math.abs(r - ratios[0]) < 1e-6),
      'one ratio: ' + ratios,
    );
    assert.strictEqual(
      Array.from(fine.columns.count).reduce((a, b) => a + b, 0),
      6,
    );
    assert.throws(() => apply('bin', [{ v: 0 }, { v: -1 }], { field: 'v', log: true }), /no positive values/);
    assert.throws(() => apply('bin', rows, { field: 'v', log: true, extent: [0, 10] }), /must be positive/);
    assert.strictEqual(apply('bin', [{ v: null }], { field: 'v', log: true }).length, 0);
  });

  test('transform.treemap: a third level keeps each subgroup in one block inside its group', () => {
    const rows = [];
    for (const g of ['A', 'B']) for (const s of ['x', 'y']) for (const n of [1, 2, 3]) rows.push({ g, s, n: g + s + n, v: 10 * n });
    const t = apply('treemap', rows, { field: 'v', group: 'g', subgroup: 's', aspect: 1 });
    const box = (test) => {
      const at = rows.map((r, i) => (test(r) ? i : -1)).filter((i) => i >= 0);
      return {
        l: Math.min(...at.map((i) => t.columns.x0[i])),
        r: Math.max(...at.map((i) => t.columns.x1[i])),
        b: Math.min(...at.map((i) => t.columns.y0[i])),
        t: Math.max(...at.map((i) => t.columns.y1[i])),
      };
    };
    const apart = (a, b) => a.r <= b.l + 1e-9 || b.r <= a.l + 1e-9 || a.t <= b.b + 1e-9 || b.t <= a.b + 1e-9;
    assert(
      apart(
        box((r) => r.g === 'A'),
        box((r) => r.g === 'B'),
      ),
      'the groups do not mix',
    );
    assert(
      apart(
        box((r) => r.g === 'A' && r.s === 'x'),
        box((r) => r.g === 'A' && r.s === 'y'),
      ),
      'nor do the subgroups',
    );
    const area = rows.reduce((sum, _, i) => sum + (t.columns.x1[i] - t.columns.x0[i]) * (t.columns.y1[i] - t.columns.y0[i]), 0);
    assert(area > 0.9 && area <= 1);
    assert.throws(() => apply('treemap', rows, { field: 'v', subgroup: 's' }), /needs "group"/);
    assert.throws(() => apply('treemap', rows, { field: 'v', group: 'g', subgroup: 'nope' }), /unknown field "nope"/);
  });

  test('transform.stack: follows closes the stack up after a legend filter, and a 100% stack adds up again', async () => {
    BC.data('mix', [
      { m: 'a', s: 'x', v: 50 },
      { m: 'a', s: 'y', v: 30 },
      { m: 'a', s: 'z', v: 20 },
    ]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'mix',
      transforms: [{ type: 'stack', field: 'v', by: 'm', group: 's', normalize: true, follows: 'color' }],
      scales: { x: { type: 'band' }, y: { type: 'linear', domain: [0, 1], nice: false }, color: { type: 'color' } },
      marks: [{ type: 'rect', x: 'm', y: 'v1', y2: 'v0', color: 's' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const heights = () => rects(svgOf(host).replace(/<clipPath[\s\S]*?<\/clipPath>/g, '')).map((r) => r.h);
    const full = heights().reduce((a, b) => a + b, 0);
    h.setView('color', ['x', 'z']);
    await flush();
    const left = heights();
    assert.strictEqual(left.length, 2);
    assert(Math.abs(left.reduce((a, b) => a + b, 0) - full) < 1, 'two series fill the whole height: ' + left + ' of ' + full);
    h.destroy();
    assert.throws(() => apply('stack', [{ m: 'a', v: 1 }], { field: 'v', by: 'm', follows: 'color' }), /needs "group"/);
  });

  test('transform.stack: without follows the domains and the table are what they were', () => {
    const t = apply('stack', [{ m: 'a', s: 'x', v: 1 }], { field: 'v', by: 'm', group: 's' });
    assert.deepStrictEqual(Array.from(t.columns.v1), [1]);
    assert.strictEqual(BC.get('transform.stack').viewDependent({}), false);
  });

  test('guide.legend: a title takes a line of its own, on every kind of legend and side', () => {
    BC.data('leg', [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ]);
    for (const position of ['top', 'right', 'bottom', 'left']) {
      const draw = (title) => {
        const host = new FakeNode('div');
        const h = BC.chart(host, {
          data: 'leg',
          scales: { x: { type: 'band' }, y: { type: 'linear' }, color: { type: 'color' } },
          guides: [{ type: 'legend', scale: 'color', position, ...(title ? { title } : {}) }],
          marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
        });
        const svg = host.children[0].serialize();
        h.destroy();
        return { svg, diagnostics: h.diagnostics };
      };
      const { svg, diagnostics } = draw('Region');
      assert.deepStrictEqual(diagnostics, []);
      assert.strictEqual(count(svg, /bc-legend-title/g), 1, position);
      assert(svg.includes('Region'));
      assert.strictEqual(count(draw().svg, /bc-legend-title/g), 0);
    }
  });

  test('guide.legend: auto is a row, a column for long labels, and a row again when a column would not fit', () => {
    const place = (labels, width) => {
      BC.data(
        'auto',
        labels.map((k) => ({ k, v: 1 })),
      );
      const host = new FakeNode('div');
      const h = BC.chart(host, {
        data: 'auto',
        size: [width, 400],
        scales: { x: { type: 'band' }, y: { type: 'linear' }, color: { type: 'color' } },
        guides: [{ type: 'legend', scale: 'color', position: 'auto' }],
        marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
      });
      assert.deepStrictEqual(
        h.diagnostics.filter((d) => d.level === 'error'),
        [],
      );
      const m = /class="bc-legend-item"[\s\S]*?<rect[^>]* x="([\d.]+)"[^>]* y="([\d.]+)"/.exec(host.children[0].serialize());
      const out = { x: +m[1], y: +m[2] };
      h.destroy();
      return out;
    };
    assert(place(['a', 'b'], 640).y < 40, 'short labels: a row on top');
    const long = Array.from({ length: 20 }, (_, i) => `A rather long category name ${i}`);
    assert(place(long, 1400).x > 900, 'long labels on a wide chart: a column on the right');
    assert(place(long, 400).y < 60, 'a phone has no room for that column');
    const many = Array.from({ length: 30 }, (_, i) => `A rather long category name ${i}`);
    assert(place(many, 1400).y < 60, 'thirty of them would run past the bottom: a row');
  });

  test('guide.legend: a column never leaves the plot a sliver or runs off the chart; a label too long for a row is cut', () => {
    const draw = (labels, size, position, title) => {
      BC.data(
        'squeeze',
        labels.map((k, i) => ({ k, v: i + 1 })),
      );
      const host = new FakeNode('div');
      const h = BC.chart(host, {
        data: 'squeeze',
        size,
        scales: { x: { type: 'band' }, y: { type: 'linear' }, color: { type: 'color' } },
        guides: [
          { type: 'axis', scale: 'y' },
          { type: 'legend', scale: 'color', position, ...(title ? { title } : {}) },
        ],
        marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
      });
      assert.deepStrictEqual(h.diagnostics, []);
      const svg = svgOf(host);
      const bars = rects(layer(svg, 'marks'));
      const items = [...svg.matchAll(/<g [^>]*class="bc-legend-item"[^>]*>([\s\S]*?)<\/g>/g)].map((m) => ({
        y: +/<rect [^>]*y="([\d.]+)"/.exec(m[1])[1],
        label: /<text[^>]*>([^<]*)<\/text>/.exec(m[1])[1],
        title: (/<title>([^<]*)<\/title>/.exec(m[1]) || [])[1],
      }));
      h.destroy();
      return { right: Math.max(...bars.map((b) => b.x + b.w)), left: Math.min(...bars.map((b) => b.x)), items, svg };
    };
    // a phone: three short names as a column would take a quarter of 324 px
    const phone = draw(['Hardware', 'Software', 'Services'], [324, 320], 'right');
    assert(
      phone.items.every((it) => it.y < 40),
      'a row on top: ' + JSON.stringify(phone.items),
    );
    assert(phone.right - phone.left > 324 * 0.7, 'the plot keeps the width: ' + (phone.right - phone.left));
    const desk = draw(['Hardware', 'Software', 'Services'], [640, 320], 'right');
    assert(
      desk.items.every((it, i) => i === 0 || it.y > desk.items[i - 1].y),
      'on a desk it is still a column',
    );
    assert(
      draw(['Hardware', 'Software', 'Services'], [324, 320], 'left').items.every((it) => it.y < 40),
      'left too',
    );
    const titled = draw(['a', 'b'], [324, 320], 'right', 'Deliveries inside the region');
    assert(
      titled.items.every((it) => it.y < 60),
      'a long title makes the column too wide as well',
    );
    // thirty categories in a column 300 px tall: thirteen would be below the chart
    const many = draw(
      Array.from({ length: 30 }, (_, i) => `C${i}`),
      [900, 300],
      'right',
    );
    assert(
      many.items.every((it) => it.y + 10 <= 300),
      'every item is on the chart',
    );
    // one name longer than the whole row: cut with an ellipsis, the whole name in its title
    const name = 'Department of Infrastructure, Transport, Regional Development and Communications';
    const cut = draw([name, 'Other'], [324, 320], 'top');
    const first = cut.items[0];
    assert(first.label.endsWith('…') && first.label.length < name.length, first.label);
    assert.strictEqual(first.title, name);
    assert.strictEqual(cut.items[1].title, undefined, 'a label that fits has no title');
    assert(first.label.length * 11 * 0.62 + 16 <= 324, 'the cut label fits the row');
    const heading = /<text [^>]*class="bc-legend-title"[^>]*>([^<]*)<\/text>/.exec(draw(['a', 'b'], [324, 320], 'top', name).svg)[1];
    assert(heading.endsWith('…') && heading.length * 11 * 0.62 <= 324, 'so is a title: ' + heading);
    const surrogate = draw(['\u{1F600}'.repeat(80), 'b'], [324, 320], 'top');
    assert(!/[\uD800-\uDBFF]…/.test(surrogate.items[0].label), 'never half a character');
  });

  const drawn = (rows, spec) => {
    BC.data('gaps', rows);
    const host = new FakeNode('div');
    const h = BC.chart(host, { data: 'gaps', marks: [], ...spec });
    const svg = host.children[0].serialize();
    const out = { svg, diagnostics: h.diagnostics };
    h.destroy();
    return out;
  };
  const months = ['2025-09', '2025-10', '2025-11', '2025-12'].map((m, i) => ({ m, v: [5, 9, 2, 7][i] }));

  test('guide.kpi: a note without a change is drawn, and a plain total takes no room for the line under it', () => {
    const tile = (extra) =>
      drawn(months, { size: [280, 120], guides: [{ type: 'kpi', field: 'v', aggregate: 'sum', compare: 'none', ...extra }] });
    assert(/bc-kpi-note[\s\S]*37% of total/.test(tile({ note: '37% of total' }).svg));
    const small = drawn(months, {
      size: [280, 60],
      padding: { top: 0, bottom: 0 },
      guides: [{ type: 'kpi', field: 'v', aggregate: 'sum', compare: 'none' }],
    });
    assert.deepStrictEqual(small.diagnostics, []);
  });

  test('guide.kpi: rowField names the row of the figure; hostile cases', () => {
    const named = (aggregate, rows = months) =>
      drawn(rows, { size: [280, 120], guides: [{ type: 'kpi', field: 'v', aggregate, label: 'Best', rowField: 'm', compare: 'none' }] });
    assert(named('max').svg.includes('Best: 2025-10'));
    assert(named('min').svg.includes('Best: 2025-11'));
    assert(named('last').svg.includes('Best: 2025-12'));
    assert(named('first').svg.includes('Best: 2025-09'));
    assert(/rowField names one row/.test(JSON.stringify(named('sum').diagnostics)), 'a sum has no row');
    const empty = named('max', [{ m: 'a', v: null }]);
    assert(!empty.svg.includes('Best:'), 'no number, no row to name');
    const nameless = named('max', [{ m: null, v: 3 }]);
    assert(nameless.svg.includes('>Best<') && !nameless.svg.includes('null'), 'a row with no name adds nothing');
  });

  test('a chart lower than its guides says that its bottom is cut off', () => {
    const low = drawn(months, { size: [280, 68], guides: [{ type: 'kpi', field: 'v', label: 'Revenue' }] });
    assert(low.diagnostics.some((d) => d.level === 'warn' && d.path === 'size'));
    const fine = drawn(months, { size: [280, 150], guides: [{ type: 'kpi', field: 'v', label: 'Revenue' }] });
    assert.deepStrictEqual(fine.diagnostics, []);
  });

  test('guide.axis: count asks for labels, anchor end keeps the last one, on a band and a time scale', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ m: `2025-${String(i + 1).padStart(2, '0')}-01`, v: i }));
    const axis = (scale, extra, width = 640) =>
      drawn(rows, {
        size: [width, 200],
        scales: { x: { type: scale }, y: { type: 'linear' } },
        guides: [{ type: 'axis', scale: 'x', format: { month: 'short', timeZone: 'UTC' }, ...extra }],
        marks: [{ type: 'line', x: 'm', y: 'v' }],
      }).svg;
    assert(!axis('band', { count: 3 }).includes('>Dec<'), 'counting from the start misses December');
    assert(axis('band', { count: 3, anchor: 'end' }).includes('>Dec<'));
    assert(axis('band', { anchor: 'end' }, 200).includes('>Dec<'), 'a narrow band axis keeps it too');
    assert(axis('time', { count: 12, anchor: 'end' }, 240).includes('>Dec<'), 'and so does a narrow time axis');
    assert(axis('time', { count: 12 }, 900).includes('>Jun<'), 'count gives a time axis every month');
    for (const count of [0, -3, NaN, 1e9]) axis('band', { count });
  });

  test('transform.highlight: pick, value, ties and missing numbers', () => {
    const run = (cols, spec) => {
      const length = Object.values(cols)[0].length;
      return BC.get('transform.highlight').apply({ length, columns: cols }, { field: 'v', ...spec }).columns;
    };
    assert.deepStrictEqual(run({ v: [1, 3, NaN, 3] }, { pick: 'max' }).highlight, ['no', 'yes', 'no', 'yes']);
    assert.deepStrictEqual(run({ v: [2, null, 1] }, { pick: 'min', as: 'h', yes: 'low', no: 'rest' }).h, ['rest', 'rest', 'low']);
    assert.deepStrictEqual(run({ v: [null, 1, 2, NaN] }, { pick: 'first' }).highlight, ['no', 'yes', 'no', 'no']);
    assert.deepStrictEqual(run({ v: [null, 1, 2, NaN] }, { pick: 'last' }).highlight, ['no', 'no', 'yes', 'no']);
    assert.deepStrictEqual(run({ v: ['a', 'b'] }, { value: 'b' }).highlight, ['no', 'yes']);
    assert.deepStrictEqual(run({ v: ['a', 'b'] }, { pick: 'max' }).highlight, ['no', 'no'], 'no number, nothing to mark');
  });

  test('transform.highlight: hostile input — bad params are clear errors', () => {
    const run = (spec) => () => BC.get('transform.highlight').apply({ length: 1, columns: { v: [1] } }, spec);
    assert.throws(run({ field: 'nope', pick: 'max' }), /unknown field/);
    assert.throws(run({ pick: 'max' }), /"field"/);
    assert.throws(run({ field: 'v' }), /either "pick" or "value"/);
    assert.throws(run({ field: 'v', pick: 'max', value: 1 }), /either "pick" or "value"/);
    assert.throws(run({ field: 'v', pick: 'top' }), /"pick" must be/);
    assert.throws(run({ field: 'v', pick: 'max', as: 'v' }), /already a column/);
  });

  test('mark.arc: labelFormat writes shares and values', () => {
    const rows = [
      { k: 'a', v: 451 },
      { k: 'b', v: 549 },
    ];
    const pie = (label, labelFormat) => drawn(rows, { size: [300, 300], marks: [{ type: 'arc', value: 'v', label, labelFormat }] }).svg;
    assert(pie('percent', { style: 'percent', maximumFractionDigits: 1 }).includes('45.1%'));
    assert(pie('percent').includes('45%'));
    assert(pie('value', { suffix: ' kg' }).includes('451 kg'));
  });

  // ───────────────────────── gauges: mark.arc endAngle, total, center ─────────────────────────

  const gauge = (rows, extra, size = [400, 300]) =>
    drawn(rows, {
      size,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      marks: [{ type: 'arc', value: 'v', innerRadius: 0.7, ...extra }],
    });
  /** Every point of a path's commands (M, L, A ends), to see where an arc reaches. */
  const reach = (d) => {
    const nums = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)|A[\d.]+ [\d.]+ 0 [01] [01] ([\d.-]+) ([\d.-]+)/g)].map((m) =>
      m[1] !== undefined ? [+m[1], +m[2]] : [+m[3], +m[4]],
    );
    return {
      x0: Math.min(...nums.map((p) => p[0])),
      x1: Math.max(...nums.map((p) => p[0])),
      y0: Math.min(...nums.map((p) => p[1])),
      y1: Math.max(...nums.map((p) => p[1])),
    };
  };

  test('mark.arc gauge: a half circle fills the width, the rest of the total is a track, the figure sits in the middle', () => {
    const { svg, diagnostics } = gauge([{ v: 72 }], { startAngle: -90, endAngle: 90, total: 100, center: 'percent' });
    assert.deepStrictEqual(diagnostics, []);
    const ps = paths(layer(svg, 'marks'));
    assert.strictEqual(ps.length, 2, 'the track and the value');
    assert(/class="bc-arc-track"/.test(ps[0].attrs), 'the track is drawn first, under the value');
    const track = reach(ps[0].d);
    // 400 x 300 with 4 px of room: the half circle is 392 wide and 196 tall, so the width decides
    assert(near(track.x1 - track.x0, 392, 0.05), `the half circle spans the width: ${track.x1 - track.x0}`);
    assert(track.y1 - track.y0 < 200, 'and is half as tall');
    const value = reach(ps[1].d);
    assert(near(value.x0, track.x0, 0.05) && value.x1 < track.x1, 'the value starts at the left end and stops short of the right');
    assert(texts(svg).includes('72%'), 'the share of the total in the middle');
    assert(/class="bc-arc-center"/.test(svg));

    const centerOf = (s) => /<text [^>]*class="bc-arc-center"[^>]*>/.exec(s)[0];
    assert(/dominant-baseline="auto"/.test(centerOf(svg)), 'a gauge stands its figure on the center line, inside the half circle');
    const ringed = gauge([{ v: 72 }], { total: 100, center: 'percent' }).svg;
    assert(/dominant-baseline="middle"/.test(centerOf(ringed)), 'a ring has its figure in the middle of the hole');

    const full = gauge([{ v: 72 }], { total: 100 }).svg;
    const ring = reach(paths(layer(full, 'marks'))[0].d);
    // a whole ring is drawn as two halves, top to bottom, so its reach is its height
    assert(near(ring.y1 - ring.y0, 292, 0.05), `a full ring still fits the smaller side (300 - 8): ${ring.y1 - ring.y0}`);
  });

  test('mark.arc gauge: zero still shows its track, past the total is cut, slices share the total, errors are clear', () => {
    const zero = gauge([{ v: 0 }], { startAngle: -90, endAngle: 90, total: 100, center: 'percent' });
    assert.strictEqual(paths(layer(zero.svg, 'marks')).length, 1, 'only the track');
    assert(texts(zero.svg).includes('0%'));
    assert.strictEqual(paths(layer(gauge([{ v: 0 }], {}).svg, 'marks')).length, 0, 'a pie of nothing is nothing');

    const over = gauge([{ v: 130 }], { startAngle: -90, endAngle: 90, total: 100, center: 'percent' });
    const [t, v] = paths(layer(over.svg, 'marks')).map((p) => reach(p.d));
    assert(near(v.x1, t.x1, 0.05), 'a value past the total fills the arc and stops at its end');
    assert(texts(over.svg).includes('130%'), 'the figure still says how far past');

    const parts = gauge(
      [
        { k: 'a', v: 25 },
        { k: 'b', v: 25 },
      ],
      { total: 100, label: 'percent', center: 'value', labelFormat: 'integer' },
    );
    assert(texts(parts.svg).includes('50'), 'center "value" is the sum');
    assert.strictEqual(paths(layer(parts.svg, 'marks')).length, 3, 'the track and two slices of a quarter each');

    for (const [extra, re] of [
      [{ startAngle: 90, endAngle: -90 }, /endAngle -90 has to be after startAngle 90/],
      [{ startAngle: 0, endAngle: 400 }, /at most 360 degrees/],
      [{ total: 0 }, /total has to be a positive number/],
      [{ total: -5 }, /total has to be a positive number/],
    ]) {
      const d = gauge([{ v: 1 }], extra).diagnostics;
      assert(
        d.some((x) => x.level === 'error' && re.test(x.message)),
        `${JSON.stringify(extra)}: ${JSON.stringify(d)}`,
      );
    }
    assert(BC.validate({ data: 'gaps', marks: [{ type: 'arc', value: 'v', center: 'middle' }] }).some((d) => d.path === 'marks[0].center'));
  });

  // ───────────────────────── step lines ─────────────────────────

  test('mark.line curve "step": each value holds until the next point, gaps still break it, area steps on both edges', () => {
    BC.data('tariff', [
      { x: 0, y: 10 },
      { x: 1, y: 30 },
      { x: 2, y: 20 },
      { x: 3, y: null },
      { x: 4, y: 40 },
      { x: 5, y: 10 },
    ]);
    const spec = (mark) => ({
      data: 'tariff',
      size: [600, 300],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      scales: { x: { type: 'linear', domain: [0, 5], nice: false }, y: { type: 'linear', domain: [0, 50], nice: false } },
      marks: [{ x: 'x', y: 'y', curve: 'step', ...mark }],
    });
    const line = draw(spec({ type: 'line' }));
    const d = paths(layer(line.svg, 'marks'))[0].d;
    assert.strictEqual(d, 'M0 240H120V120H240V180M480 60H600V240', d);
    assert.deepStrictEqual(line.h.diagnostics, []);

    const area = draw(spec({ type: 'area' }));
    const a = paths(layer(area.svg, 'marks'))[0].d;
    // forward along the top in steps, down, back along the baseline (flat, so its steps are all at 300)
    assert.strictEqual(a.split('M')[1], '0 240H120V120H240V180L240 300V300H120V300H0Z', a);
    assert(!/C|NaN/.test(a));

    BC.data('one', [{ x: 1, y: 5 }]);
    const lone = draw({ ...spec({ type: 'line' }), data: 'one' });
    assert(!/NaN/.test(lone.svg), 'a single point is a move and nothing else');
    assert(BC.validate(spec({ type: 'line', curve: 'stairs' })).some((x) => x.path === 'marks[0].curve'));
  });

  // ───────────────────────── a total of the group on every row ─────────────────────────

  test('transform.window total and share: the sum of each group on every row, and each row as a part of it', () => {
    const rows = [
      { q: 'Q1', p: 'a', v: 30 },
      { q: 'Q1', p: 'b', v: 10 },
      { q: 'Q2', p: 'a', v: 25 },
      { q: 'Q2', p: 'b', v: null },
      { q: 'Q2', p: 'c', v: 75 },
    ];
    const total = apply('window', rows, { field: 'v', op: 'total', group: 'q', as: 'qt' });
    assert.deepStrictEqual([...total.columns.qt], [40, 40, 100, 100, 100], 'a row with no value still has the total of its group');
    assert.strictEqual(total.length, 5, 'no row is collapsed');
    const share = apply('window', rows, { field: 'v', op: 'share', group: 'q' });
    assert.deepStrictEqual(
      [...share.columns.share_v].map((x) => (isNaN(x) ? null : x)),
      [0.75, 0.25, 0.25, null, 0.75],
    );
    const all = apply('window', rows, { field: 'v', op: 'total' });
    assert.deepStrictEqual([...all.columns.total_v], [140, 140, 140, 140, 140], 'without a group, the whole table');
  });

  test('transform.window total and share: hostile input — nothing to add, a sum of zero, negatives, size and odd groups', () => {
    const t = (rows, spec) => apply('window', rows, { field: 'v', ...spec });
    const none = t(
      [
        { g: 1, v: null },
        { g: 1, v: 'x' },
      ],
      { op: 'total', group: 'g' },
    );
    assert(isNaN(none.columns.total_v[0]) && isNaN(none.columns.total_v[1]), 'a group with no number has no total');
    const zero = t([{ v: 5 }, { v: -5 }], { op: 'share' });
    assert(
      zero.columns.share_v.every((x) => isNaN(x)),
      'a share of a sum of zero is no share, not Infinity',
    );
    const neg = t([{ v: 30 }, { v: -10 }], { op: 'share' });
    assert.deepStrictEqual([...neg.columns.share_v], [1.5, -0.5], 'negatives count against the sum, as in a bridge');
    assert.throws(() => t([{ v: 1 }], { op: 'total', size: 3 }), /"size" applies to sum, mean, min and max, not to "total"/);
    const odd = t(
      [
        { g: null, v: 1 },
        { g: NaN, v: 2 },
        { g: 0, v: 4 },
        { g: '0', v: 8 },
      ],
      { op: 'total', group: 'g' },
    );
    assert.deepStrictEqual([...odd.columns.total_v], [3, 3, 4, 8], 'null and NaN are one missing group; 0 and "0" are two');
    const big = Array.from({ length: 200000 }, (_, i) => ({ g: i % 7, v: i }));
    const t0 = Date.now();
    t(big, { op: 'share', group: 'g' });
    assert(Date.now() - t0 < 1500, 'a long table stays fast');
  });

  test('transform.window rank: place 1 for the largest in each group, ties share a place, asc for the smallest', () => {
    const rows = [
      { y: 2024, b: 'a', v: 10 },
      { y: 2024, b: 'b', v: 30 },
      { y: 2024, b: 'c', v: 20 },
      { y: 2025, b: 'a', v: 40 },
      { y: 2025, b: 'b', v: 25 },
      { y: 2025, b: 'c', v: 25 },
      { y: 2025, b: 'd', v: 5 },
    ];
    const r = apply('window', rows, { field: 'v', op: 'rank', group: 'y', as: 'place' });
    assert.deepStrictEqual([...r.columns.place], [3, 1, 2, 1, 2, 2, 4], 'a tie shares the better place and the next is skipped');
    const asc = apply('window', rows, { field: 'v', op: 'rank', group: 'y', order: 'asc' });
    assert.deepStrictEqual([...asc.columns.rank_v], [1, 3, 2, 4, 2, 2, 1]);
    const all = apply('window', rows, { field: 'v', op: 'rank' });
    assert.deepStrictEqual([...all.columns.rank_v], [6, 2, 5, 1, 3, 3, 7], 'without a group, the whole table');
  });

  test('transform.window rank: hostile input — missing values get no place, order is checked, a long table stays fast', () => {
    const t = (rows, spec) => apply('window', rows, { field: 'v', op: 'rank', ...spec });
    const holes = t([{ v: 3 }, { v: null }, { v: 'x' }, { v: NaN }, { v: 9 }, { v: -Infinity }], {});
    assert.deepStrictEqual(
      [...holes.columns.rank_v].map((x) => (isNaN(x) ? null : x)),
      [2, null, null, null, 1, null],
      'only numbers are ranked, and they are ranked among themselves',
    );
    const neg = t([{ v: -1 }, { v: 0 }, { v: -5 }], {});
    assert.deepStrictEqual([...neg.columns.rank_v], [2, 1, 3]);
    assert.throws(() => t([{ v: 1 }], { order: 'up' }), /"order" must be "desc"/);
    assert.throws(() => apply('window', [{ v: 1 }], { field: 'v', op: 'total', order: 'asc' }), /"order" applies to rank, not to "total"/);
    assert.throws(() => t([{ v: 1 }], { size: 2 }), /"size" applies to sum, mean, min and max, not to "rank"/);
    const big = Array.from({ length: 200000 }, (_, i) => ({ g: i % 50, v: (i * 7919) % 1000 }));
    const t0 = Date.now();
    t(big, { group: 'g' });
    assert(Date.now() - t0 < 1500, 'a long table stays fast');
  });

  test('transform.stack center: every stack has its middle on 0, with negatives and with normalize; missing values stay out', () => {
    const rows = [
      { x: 1, s: 'a', v: 10 },
      { x: 1, s: 'b', v: 30 },
      { x: 2, s: 'a', v: 4 },
      { x: 2, s: 'b', v: null },
      { x: 3, s: 'a', v: 6 },
      { x: 3, s: 'b', v: -2 },
    ];
    const c = apply('stack', rows, { field: 'v', by: 'x', group: 's', center: true });
    const pairs = (t) => [...t.columns.v0].map((s, i) => [s, t.columns.v1[i]].map((x) => (isNaN(x) ? null : x)));
    assert.deepStrictEqual(pairs(c), [
      [-20, -10],
      [-10, 20],
      [-2, 2],
      [null, null],
      [-2, 4],
      [-2, -4],
    ]);
    const n = apply('stack', rows, { field: 'v', by: 'x', group: 's', center: true, normalize: true });
    assert.deepStrictEqual(pairs(n).slice(0, 2), [
      [-0.5, -0.25],
      [-0.25, 0.5],
    ]);
    const plain = apply('stack', rows, { field: 'v', by: 'x', group: 's' });
    assert.deepStrictEqual(pairs(plain)[1], [10, 40], 'without center nothing moves');
    const none = apply('stack', [{ x: 1, v: null }], { field: 'v', by: 'x', center: true });
    assert(isNaN(none.columns.v0[0]), 'a stack of nothing stays nothing');
  });

  // ───────────────────────── distributions: transform.density, mark.violin ─────────────────────────

  /** A deterministic normal sample (Box–Muller on a small LCG), so the tests do not depend on Math.random. */
  const normal = (n, mu, sd, seed = 1) => {
    let s = seed;
    const u = () => (s = (s * 48271) % 2147483647) / 2147483647;
    return Array.from({ length: n }, () => mu + sd * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
  };
  /** The area under one curve of a density table, by trapezoids. */
  const areaOf = (t, from = 0, to = t.length) => {
    let a = 0;
    for (let i = from + 1; i < to; i++)
      a += ((t.columns.density[i] + t.columns.density[i - 1]) / 2) * (t.columns.value[i] - t.columns.value[i - 1]);
    return a;
  };

  test('transform.density: a curve per group of steps rows, its area 1 (or its count), its peak where the samples are', () => {
    const rows = [...normal(400, 10, 2).map((v) => ({ g: 'a', v })), ...normal(100, 30, 4, 7).map((v) => ({ g: 'b', v }))];
    const t = apply('density', rows, { field: 'v', group: 'g' });
    assert.strictEqual(t.length, 160, '80 rows per group');
    assert.deepStrictEqual([t.columns.g[0], t.columns.g[80]], ['a', 'b'], 'groups in first-appearance order');
    assert(near(areaOf(t, 0, 80), 1, 0.02) && near(areaOf(t, 80, 160), 1, 0.02), `areas ${areaOf(t, 0, 80)}, ${areaOf(t, 80, 160)}`);
    let peak = 0;
    for (let i = 1; i < 80; i++) if (t.columns.density[i] > t.columns.density[peak]) peak = i;
    assert(Math.abs(t.columns.value[peak] - 10) < 1, `the peak of a is near 10: ${t.columns.value[peak]}`);
    assert.strictEqual(t.columns.count[0], 400);
    assert.strictEqual(t.columns.count[80], 100);

    const counted = apply('density', rows, { field: 'v', group: 'g', counts: true });
    assert(near(areaOf(counted, 0, 80), 400, 8), 'with counts the area is the number of samples');
    const sharp = apply('density', rows, { field: 'v', group: 'g', bandwidth: 0.2, steps: 200 });
    const blunt = apply('density', rows, { field: 'v', group: 'g', bandwidth: 3, steps: 200 });
    const top = (x) => Math.max(...x.columns.density.slice(0, 200));
    assert(top(sharp) > top(blunt), 'a smaller bandwidth makes a taller, noisier curve');
    const cut = apply('density', [{ v: 0.2 }, { v: 0.5 }, { v: 3 }], { field: 'v', extent: [0, null] });
    assert(Math.min(...cut.columns.value) === 0, 'the extent cuts the curve at 0');
    const named = apply('density', [{ v: 1 }, { v: 2 }], { field: 'v', as: ['ms', 'share'], steps: 5 });
    assert.deepStrictEqual(Object.keys(named.columns).sort(), ['count', 'ms', 'share']);
  });

  test('transform.density: hostile input — no numbers, one sample, all alike, bad params, odd groups, a long table', () => {
    const t = (rows, spec) => apply('density', rows, { field: 'v', ...spec });
    assert.strictEqual(t([{ v: null }, { v: 'x' }], {}).length, 0, 'nothing to estimate is an empty table, not an error');
    const one = t([{ v: 5 }], {});
    assert(one.columns.density.every((d) => isFinite(d) && d >= 0) && Math.max(...one.columns.density) > 0, 'one sample is a bump');
    const same = t([{ v: 0 }, { v: 0 }, { v: 0 }], {});
    assert(same.columns.density.every(isFinite) && same.columns.value.every(isFinite), 'samples all alike do not divide by zero');
    const beyond = t([{ v: -5 }, { v: -4 }], { extent: [0, null] });
    assert.strictEqual(beyond.length, 0, 'a group lying wholly outside the extent has no curve');
    for (const [spec, re] of [
      [{ steps: 1 }, /"steps" must be a whole number from 2 to 1000/],
      [{ steps: 2.5 }, /"steps"/],
      [{ bandwidth: 0 }, /"bandwidth" must be a positive number/],
      [{ bandwidth: 'wide' }, /"bandwidth"/],
      [{ extent: [5, 1] }, /"extent" must run from low to high/],
      [{ extent: [0] }, /"extent" must be \[low, high\]/],
      [{ as: ['a', 'a'] }, /"as" must be two different column names/],
      [{ field: 'nope' }, /unknown field "nope"/],
      [{ group: 'nope' }, /unknown field "nope"/],
    ])
      assert.throws(() => t([{ v: 1 }], spec), re, JSON.stringify(spec));
    const odd = t(
      [
        { g: null, v: 1 },
        { g: NaN, v: 2 },
        { g: 0, v: 3 },
      ],
      { group: 'g', steps: 3 },
    );
    assert.strictEqual(odd.length, 6, 'null and NaN are one missing group, 0 another');
    const big = normal(200000, 0, 1).map((v, i) => ({ g: i % 4, v }));
    const t0 = Date.now();
    t(big, { group: 'g' });
    assert(Date.now() - t0 < 2000, `a long table stays fast: ${Date.now() - t0} ms`);
  });

  const violinOf = (mark, scales, rows) => {
    BC.data('vio', rows || [...normal(300, 10, 2).map((v) => ({ g: 'a', v })), ...normal(300, 20, 4, 5).map((v) => ({ g: 'b', v }))]);
    return draw({
      data: 'vio',
      size: [400, 300],
      padding: 0, // one number is every side, as in CSS
      transforms: [{ type: 'density', field: 'v', group: 'g' }],
      scales: scales || { x: { type: 'band', paddingInner: 0, paddingOuter: 0 }, y: { type: 'linear' } },
      marks: [{ type: 'violin', x: 'g', y: 'value', density: 'density', ...mark }],
    });
  };

  test('mark.violin: a shape per category, mirrored on its band, the widest point 0.9 of the band, one width scale for all', () => {
    const { svg, h } = violinOf({});
    assert.deepStrictEqual(h.diagnostics, []);
    const ps = paths(layer(svg, 'marks'));
    assert.strictEqual(ps.length, 2);
    const [a, b] = ps.map((p) => reach(p.d));
    // bands of 200 px: a is centered on 100, b on 300
    assert(near((a.x0 + a.x1) / 2, 100, 0.05) && near((b.x0 + b.x1) / 2, 300, 0.05), 'centered on their bands');
    assert(near(a.x1 - a.x0, 180, 0.1), `the denser shape is 0.9 of its band: ${a.x1 - a.x0}`);
    assert(b.x1 - b.x0 < 120, 'the spread-out one is narrower: one scale for both');
    assert(a.y1 - a.y0 < b.y1 - b.y0, 'and shorter along the values');
    const each = violinOf({ normalize: 'each' });
    const [ea, eb] = paths(layer(each.svg, 'marks')).map((p) => reach(p.d));
    assert(near(ea.x1 - ea.x0, 180, 0.1) && near(eb.x1 - eb.x0, 180, 0.1), 'normalize "each" fits both to the band');
    assert(!/stroke=/.test(ps[0].attrs), 'a violin has no outline by default');
  });

  test('mark.violin side "one": ridges stand on the bottom of their bands, rise above them, and the lower ones are drawn last', () => {
    const { svg, h } = violinOf(
      { x: 'value', y: 'g', side: 'one' },
      { y: { type: 'band', paddingInner: 0, paddingOuter: 0 }, x: { type: 'linear' } },
    );
    assert.deepStrictEqual(h.diagnostics, []);
    const ps = paths(layer(svg, 'marks'));
    const [a, b] = ps.map((p) => reach(p.d));
    // bands of 150 px: a from 0 to 150, b from 150 to 300; ridges rise from 150 and 300
    assert(near(a.y1, 150, 0.05) && near(b.y1, 300, 0.05), `bases on the bottoms of the bands: ${a.y1}, ${b.y1}`);
    assert(near(a.y1 - a.y0, 240, 0.1), `the tallest ridge is 1.6 bands: ${a.y1 - a.y0}`);
    assert(/stroke="var\(--bc-tooltip-bg, #fff\)"/.test(ps[1].attrs), 'a ridge is outlined in the card color');
    assert(svg.indexOf(ps[1].d) > svg.indexOf(ps[0].d), 'the ridge in front comes after the one behind');
  });

  test('mark.violin: hostile input — no band scale, a category with one row, a hidden category, nothing to draw', async () => {
    const plain = violinOf({}, { x: { type: 'linear' }, y: { type: 'linear' } });
    assert(plain.h.diagnostics.some((d) => d.level === 'error' && /put the categories on a band scale/.test(d.message)));
    BC.data('vio1', [{ g: 'a', value: 1, density: 0.5 }]);
    const lone = draw({
      data: 'vio1',
      scales: { x: { type: 'band' }, y: { type: 'linear' } },
      marks: [{ type: 'violin', x: 'g', y: 'value', density: 'density' }],
    });
    assert.deepStrictEqual(lone.h.diagnostics, []);
    assert.strictEqual(paths(layer(lone.svg, 'marks')).length, 0, 'one point is no shape');
    BC.data('vio2', [
      { g: 'a', value: 1, density: 0 },
      { g: 'a', value: 2, density: 0 },
      { g: 'b', value: 1, density: -1 },
      { g: 'b', value: 2, density: null },
    ]);
    const flat = draw({
      data: 'vio2',
      scales: { x: { type: 'band' }, y: { type: 'linear' } },
      marks: [{ type: 'violin', x: 'g', y: 'value', density: 'density' }],
    });
    assert(!/NaN|Infinity/.test(flat.svg), 'a density of zero everywhere draws a flat line, not NaN');
    const hidden = violinOf({ color: 'g' }, { x: { type: 'band' }, y: { type: 'linear' }, color: { type: 'color' } });
    assert.strictEqual(paths(layer(hidden.svg, 'marks')).length, 2);
    hidden.h.setView('color', ['a']); // what a legend filter does
    await flush();
    assert.strictEqual(paths(layer(svgOf(hidden.host), 'marks')).length, 1, 'a category the legend hides is not drawn');
  });

  // ───────────────────────── time ticks on a narrow chart, grid count ─────────────────────────

  test('scale.time: a step that leaves fewer than two ticks inside the domain gives way to a finer one', () => {
    const scale = BC.get('scale.time').create({ type: 'time' }, { name: 'x', sources: [['2026-01-05', '2026-06-26']], range: [0, 200] });
    const t3 = scale.ticks(3);
    assert(t3.length >= 2, `half a year from the 5th of January at 3 ticks: ${t3.map((t) => t.label).join(', ')}`);
    assert.deepStrictEqual(
      t3.map((t) => new Date(t.value).getUTCMonth()),
      [1, 2, 3, 4, 5],
      'the months inside, not the one quarter',
    );
    const year = BC.get('scale.time').create({ type: 'time' }, { name: 'x', sources: [['2026-01-01', '2026-12-01']], range: [0, 200] });
    assert(year.ticks(3).length >= 2, 'a year keeps at least two');
    const day = BC.get('scale.time').create(
      { type: 'time' },
      { name: 'x', sources: [['2026-01-05T10:00', '2026-01-05T10:00:01']], range: [0, 200] },
    );
    assert(day.ticks(2).length >= 1 && day.ticks(2).every((t) => isFinite(t.pos)), 'a second still has its tick');
    const one = BC.get('scale.time').create({ type: 'time' }, { name: 'x', sources: [['2026-01-05', '2026-01-05']], range: [0, 200] });
    assert(one.ticks(3).length <= 1000, 'a domain of one instant does not run away');
  });

  test('guide.grid count: as many lines as its axis has labels when both are given the same count', () => {
    BC.data('grid-count', [
      { d: '2025-01-01', v: 1 },
      { d: '2026-12-31', v: 2 },
    ]);
    const spec = (count) => ({
      data: 'grid-count',
      size: [640, 300],
      scales: { x: { type: 'time' }, y: { type: 'linear' } },
      guides: [
        { type: 'grid', scale: 'x', ...(count === undefined ? {} : { count }) },
        { type: 'axis', scale: 'x', ...(count === undefined ? {} : { count }) },
      ],
      marks: [{ type: 'point', x: 'd', y: 'v' }],
    });
    const linesOf = (svg) => (paths(layer(svg, 'grid'))[0].d.match(/M/g) || []).length;
    const labelsOf = (svg) => count(svg, /class="bc-axis-label"/g);
    // two years: by default a line every half year; asked for 12, a line every quarter or more often
    const plain = draw(spec(undefined)).svg;
    const many = draw(spec(12)).svg;
    assert(linesOf(many) > linesOf(plain), `count 12: ${linesOf(many)} lines, by default ${linesOf(plain)}`);
    assert(linesOf(many) === labelsOf(many), `${linesOf(many)} grid lines, ${labelsOf(many)} labels`);
    assert(BC.validate(spec('many')).some((d) => d.path === 'guides[0].count'));
  });

  // ───────────────────────── beeswarm: mark.point swarm ─────────────────────────

  const circlesOf = (svg) =>
    [...layer(svg, 'marks').matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3] }));
  const swarmOf = (rows, mark, scales) => {
    BC.data('bees', rows);
    return draw({
      data: 'bees',
      size: [400, 300],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      scales: scales || { y: { type: 'band', paddingInner: 0, paddingOuter: 0 }, x: { type: 'linear', domain: [0, 100], nice: false } },
      marks: [{ type: 'point', x: 'v', y: 'g', r: 4, swarm: true, ...mark }],
    });
  };

  test('mark.point swarm: no two points touch, each stays at its value and inside its band', () => {
    const rows = [];
    for (let i = 0; i < 60; i++) rows.push({ g: 'a', v: 40 + (i % 13) * 0.8 }, { g: 'b', v: 10 + ((i * 7) % 80) });
    const { svg, h } = swarmOf(rows);
    assert.deepStrictEqual(h.diagnostics, []);
    const cs = circlesOf(svg);
    assert.strictEqual(cs.length, 120);
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
        assert(d >= 8.9, `points ${i} and ${j} are ${d} px apart`);
      }
    // x is the value, kept: 400 px for 0..100
    const xs = new Set(cs.map((c) => c.x));
    for (const r of rows)
      assert(
        [...xs].some((x) => Math.abs(x - r.v * 4) < 0.01),
        `a point at ${r.v}: ${[...xs].sort((p, q) => p - q).join(' ')}`,
      );
    // bands of 150 px: a around 75, b around 225; nobody leaves its band
    assert(
      cs.every((c) => (c.y >= 4 && c.y <= 146) || (c.y >= 154 && c.y <= 296)),
      'inside the bands',
    );
    const plain = swarmOf(rows, { swarm: false });
    assert(
      circlesOf(plain.svg).every((c) => c.y === 75 || c.y === 225),
      'without swarm every point is on the middle of its band',
    );
  });

  test('mark.point swarm: upright on a band x, with a gap between the points', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ g: 'a', v: 50 + (i % 3) }));
    const up = swarmOf(
      rows,
      { x: 'g', y: 'v', swarmGap: 4 },
      { x: { type: 'band', paddingInner: 0, paddingOuter: 0 }, y: { type: 'linear', domain: [0, 100], nice: false } },
    );
    const cs = circlesOf(up.svg);
    assert(new Set(cs.map((c) => c.x)).size > 5, 'spread along x');
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) assert(Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y) >= 11.9, 'the gap is kept');
  });

  test('mark.point swarm: hostile input — no band, thousands of equal values, a band too narrow, missing values', () => {
    const noBand = swarmOf([{ g: 1, v: 1 }], {}, { y: { type: 'linear' }, x: { type: 'linear' } });
    assert(noBand.h.diagnostics.some((d) => d.level === 'error' && /one of x and y needs a band scale/.test(d.message)));
    const same = Array.from({ length: 3000 }, () => ({ g: 'a', v: 50 }));
    const t0 = Date.now();
    const pile = swarmOf(same);
    assert(Date.now() - t0 < 3000, `3000 equal values stay fast: ${Date.now() - t0} ms`);
    const cs = circlesOf(pile.svg);
    assert.strictEqual(cs.length, 3000, 'all are drawn');
    assert(
      cs.every((c) => c.y >= 0 && c.y <= 300 && isFinite(c.x)),
      'the ones that do not fit stay inside the band, laid over the others',
    );
    const narrow = swarmOf(
      [
        { g: 'a', v: 1 },
        { g: 'a', v: 1 },
      ],
      { r: 400 },
    );
    assert(!/NaN|Infinity/.test(narrow.svg), 'a point wider than its band is drawn on the middle');
    const holes = swarmOf([
      { g: 'a', v: null },
      { g: null, v: 3 },
      { g: 'a', v: 'x' },
      { g: 'a', v: 5 },
    ]);
    assert(!/NaN/.test(holes.svg));
  });

  test('mark.point swarm: a category that does not fit its band shrinks every point of the mark, as little as makes it fit', () => {
    // a: 200 values packed into 10 units; b: 20 spread out, which fit at any width
    const rows = [];
    for (let i = 0; i < 200; i++) rows.push({ g: 'a', v: 40 + (i % 41) * 0.25 });
    for (let i = 0; i < 20; i++) rows.push({ g: 'b', v: 5 + i * 4.5 });
    const apart = (cs, d) => {
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          const dist = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
          if (dist < d) return `points ${i} and ${j} are ${dist.toFixed(2)} px apart, ${d.toFixed(2)} needed`;
        }
      return '';
    };
    const { svg, h } = swarmOf(rows);
    assert.deepStrictEqual(h.diagnostics, []);
    const cs = circlesOf(svg);
    assert.strictEqual(cs.length, 220);
    const r = cs[0].r;
    assert(
      cs.every((c) => c.r === r),
      'one radius for the whole mark, b shrinks with a',
    );
    assert(r < 4 && r > 2, `shrunk, but not to the floor: r ${r}`);
    // the gap shrinks with the points: 1 px at r 4, so the closest neighbours are 2r + r/4 apart, not 2r + 1
    assert.strictEqual(apart(cs, 2 * r + r / 4 - 0.01), '', 'no two touch');
    assert.notStrictEqual(apart(cs, 2 * r + r / 4 + 0.01), '', 'neighbours sit at the shrunk gap');
    assert(
      cs.every((c) => (c.y >= r - 0.01 && c.y <= 150 - r + 0.01) || (c.y >= 150 + r - 0.01 && c.y <= 300 - r + 0.01)),
      'inside the bands',
    );
    // as little as makes it fit: a little bigger, and some point is laid over another
    const bigger = circlesOf(swarmOf(rows, { r: r * 1.03, swarmShrink: 0 }).svg);
    assert.notStrictEqual(apart(bigger, 2 * r * 1.03 + 1 - 0.01), '', `at r ${(r * 1.03).toFixed(2)} they would not fit`);

    // a chart wide enough keeps the radius it was given; the same rows on a narrow one shrink
    const wide = circlesOf(swarmOf(rows.slice(0, 60)).svg);
    assert(
      wide.every((c) => c.r === 4),
      'a swarm that fits keeps r',
    );
    BC.data('bees', rows.slice(0, 60));
    const narrow = circlesOf(
      draw({
        data: 'bees',
        size: [120, 300],
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        scales: { y: { type: 'band', paddingInner: 0, paddingOuter: 0 }, x: { type: 'linear', domain: [0, 100], nice: false } },
        marks: [{ type: 'point', x: 'v', y: 'g', r: 4, swarm: true }],
      }).svg,
    );
    assert(narrow[0].r < 4, `on a narrow chart: r ${narrow[0].r}`);
    assert.strictEqual(apart(narrow, 2 * narrow[0].r + narrow[0].r / 4 - 0.01), '');
  });

  test('mark.point swarm: a zoom lays the swarm out again, so the points grow back when the values spread apart', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ g: 'a', v: 40 + (i % 41) * 0.25 }));
    const { host, h, svg } = swarmOf(rows);
    const r0 = circlesOf(svg)[0].r;
    assert(r0 < 4, `shrunk at first: r ${r0}`);
    h.setView('x', [38, 52]); // what a zoom does: the 10 units now take most of the 400 px
    await flush();
    const zoomed = circlesOf(svgOf(host));
    assert(
      zoomed.every((c) => c.r === 4),
      `zoomed in: r ${zoomed[0].r}`,
    );
    h.setView('x', null);
    await flush();
    assert.strictEqual(circlesOf(svgOf(host))[0].r, r0, 'back out: the same layout as before');
  });

  test('mark.point swarmShrink: 0 keeps r and lays over what does not fit; the floor holds; bad values fall back', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ g: 'a', v: 40 + (i % 41) * 0.25 }));
    const kept = circlesOf(swarmOf(rows, { swarmShrink: 0 }).svg);
    assert(
      kept.every((c) => c.r === 4),
      'swarmShrink 0: the radius as given',
    );
    let over = 0;
    for (let i = 0; i < kept.length; i++)
      for (let j = i + 1; j < kept.length; j++) if (Math.hypot(kept[i].x - kept[j].x, kept[i].y - kept[j].y) < 8) over++;
    assert(over > 0, 'and what does not fit is laid over');
    // thousands of equal values never fit: the points go down to the floor and no further, and stay fast
    const same = Array.from({ length: 3000 }, () => ({ g: 'a', v: 50 }));
    const t0 = Date.now();
    const pile = circlesOf(swarmOf(same).svg);
    assert(Date.now() - t0 < 3000, `3000 equal values stay fast: ${Date.now() - t0} ms`);
    assert(
      pile.every((c) => c.r === 2),
      `half of r 4 by default: ${pile[0].r}`,
    );
    assert(
      circlesOf(swarmOf(same.slice(0, 500), { swarmShrink: 0.25 }).svg).every((c) => c.r === 3),
      'swarmShrink 0.25: three quarters',
    );
    assert(
      circlesOf(swarmOf(same.slice(0, 500), { swarmShrink: 5 }).svg).every((c) => Math.abs(c.r - 0.4) < 1e-9),
      'at most 0.9',
    );
    assert(
      circlesOf(swarmOf(same.slice(0, 500), { swarmShrink: -1 }).svg).every((c) => c.r === 2),
      'a negative one is the default',
    );
    const odd = swarmOf(same.slice(0, 50), { swarmShrink: 'lots' });
    assert(
      odd.h.diagnostics.some((d) => d.path === 'marks[0].swarmShrink'),
      'a string is reported',
    );
    assert(!/NaN|Infinity/.test(odd.svg));
    // bubbles shrink in proportion, so the biggest stays the biggest
    BC.data(
      'bubbles',
      rows.map((r, i) => ({ ...r, s: 1 + (i % 4) })),
    );
    const bub = circlesOf(
      draw({
        data: 'bubbles',
        size: [400, 300],
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        scales: {
          y: { type: 'band', paddingInner: 0, paddingOuter: 0 },
          x: { type: 'linear', domain: [0, 100], nice: false },
          size: { type: 'size', range: [2, 8] },
        },
        marks: [{ type: 'point', x: 'v', y: 'g', size: 's', swarm: true }],
      }).svg,
    );
    const radii = [...new Set(bub.map((c) => +c.r.toFixed(6)))].sort((a, b) => a - b);
    assert(radii.length === 4 && radii[3] < 8, `four sizes, shrunk: ${radii.join(' ')}`);
  });

  test('transform.window total: a line of totals over stacked bars, one point per bar however many rows it has', () => {
    const { svg, diagnostics } = drawn(
      [
        { q: 'Q1', p: 'a', v: 30 },
        { q: 'Q1', p: 'b', v: 10 },
        { q: 'Q2', p: 'a', v: 25 },
        { q: 'Q2', p: 'b', v: 35 },
      ],
      {
        size: [400, 300],
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        transforms: [
          { type: 'window', field: 'v', op: 'total', group: 'q', as: 'qt' },
          { type: 'stack', field: 'v', by: 'q', group: 'p' },
        ],
        scales: { x: { type: 'band' }, y: { type: 'linear', domain: [0, 60], nice: false }, color: { type: 'color' } },
        marks: [
          { type: 'rect', x: 'q', y: 'v1', y2: 'v0', color: 'p' },
          { type: 'line', x: 'q', y: 'qt' },
        ],
      },
    );
    assert.deepStrictEqual(diagnostics, []);
    const line = paths(layer(svg, 'marks')).find((p) => /fill="none"/.test(p.attrs));
    const ys = [...line.d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => +m[1]);
    assert(
      ys.every((y) => y === 100 || y === 0),
      `the line stays at each total (40 → y 100, 60 → y 0): ${line.d}`,
    );
  });

  test('tooltip: a table that says so has no lines for the fields a row does not have', async () => {
    BC.data('box', [
      { s: 'a', ms: 10 },
      { s: 'a', ms: 11 },
      { s: 'a', ms: 12 },
      { s: 'a', ms: 13 },
      { s: 'a', ms: 500 },
    ]);
    const t = apply('quartiles', [{ s: 'a', v: 1 }], { field: 'v', group: 's' });
    assert.strictEqual(t.sparse, true);
  });

  // ───────────────────────── transform.marimekko ────
  test('transform.marimekko: widths and heights are shares, and the columns fill the whole', () => {
    const rows = [
      { c: 'A', s: 'x', v: 30 },
      { c: 'A', s: 'y', v: 10 },
      { c: 'B', s: 'x', v: 15 },
      { c: 'B', s: 'y', v: 45 },
    ];
    const t = apply('marimekko', rows, { field: 'v', category: 'c', gap: 0 });
    const c = t.columns;
    assert(near(c.x0[0], 0) && near(c.x1[0], 0.4), 'A is 40 of 100 wide');
    assert(near(c.x0[2], 0.4) && near(c.x1[2], 1), 'B takes the rest');
    assert(near(c.y1[0], 1) && near(c.y0[0], 0.25) && near(c.y1[1], 0.25) && near(c.y0[1], 0), 'A stacks from the top to the bottom');
    assert(near(c.share[3], 0.75));
    let area = 0;
    for (let i = 0; i < 4; i++) {
      area += (c.x1[i] - c.x0[i]) * (c.y1[i] - c.y0[i]);
      assert(near((c.x1[i] - c.x0[i]) * (c.y1[i] - c.y0[i]), rows[i].v / 100), 'the area of a cell is its share of the whole');
    }
    assert(near(area, 1));
    assert.deepStrictEqual(c.label, ['A', null, null, 'B'], 'on the tallest cell of each column');
    const gapped = apply('marimekko', rows, { field: 'v', category: 'c', gap: 0.02 }).columns;
    assert(gapped.x0[2] > gapped.x1[0], 'a gap between the columns');
  });

  test('transform.marimekko: hostile rows and names', () => {
    const t = apply(
      'marimekko',
      [
        { c: 'A', v: 10 },
        { c: 'A', v: -1 },
        { c: 'A', v: 0 },
        { c: 'A', v: 'many' },
        { c: null, v: 5 },
        { c: '', v: 5 },
        { c: 'B', v: Infinity },
      ],
      { field: 'v', category: 'c', gap: 0 },
    );
    assert.strictEqual(t.length, 7, 'rows stay, for the other marks');
    assert(near(t.columns.x1[0], 1), 'only the real one counts');
    for (let i = 1; i < 7; i++) assert(isNaN(t.columns.x0[i]), 'row ' + i + ' has no cell');
    assert.strictEqual(apply('marimekko', [{ c: 'A', v: 0 }], { field: 'v', category: 'c' }).columns.label[0], null);
    const thin = apply(
      'marimekko',
      [
        { c: 'A', v: 1 },
        { c: 'B', v: 1e9 },
      ],
      { field: 'v', category: 'c', gap: 0.05 },
    ).columns;
    assert(thin.x1[0] >= thin.x0[0], 'a thin column does not turn inside out');
    assert.throws(() => apply('marimekko', [{ c: 'A', v: 1 }], { field: 'nope', category: 'c' }), /unknown field "nope" in "field"/);
    assert.throws(() => apply('marimekko', [{ c: 'A', v: 1 }], { field: 'v', category: 'nope' }), /unknown field "nope" in "category"/);
    assert.throws(() => apply('marimekko', [{ c: 'A', v: 1, share: 2 }], { field: 'v', category: 'c' }), /"share" is already a column/);
    assert.throws(() => apply('marimekko', [{ c: 'A', v: 1 }], { field: 'v', category: 'c', shareAs: 'x0' }), /different names/);
  });

  // ───────────────────────── transform.hexbin, mark.rect shape hexagon ─────────────────────────

  /** Points of two clusters, from a fixed seed. */
  const cloud = (n) => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const rows = [];
    for (let i = 0; i < n; i++) {
      const far = i % 3 === 0;
      rows.push({ w: (far ? 80 : 60) + gauss() * 8, h: (far ? 180 : 165) + gauss() * 6 });
    }
    return rows;
  };

  test('transform.hexbin: every point is counted in the hexagon whose center is nearest, found by brute force', () => {
    const rows = cloud(3000);
    const bins = 17;
    const aspect = 1.5;
    const t = apply('hexbin', rows, { x: 'w', y: 'h', bins, aspect });
    const c = t.columns;
    const total = c.count.reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 3000, 'no point lost or counted twice');
    // the lattice in the units where the data is `a` wide and 1 tall (a: what the transform settled on for its boxes to be
    // `aspect` times as wide as tall, read back from the height of a hexagon), and each point's nearest center over all of it
    const xs = rows.map((r) => r.w);
    const ys = rows.map((r) => r.h);
    const [xmin, xmax, ymin, ymax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const a = (((c.y1[0] - c.y0[0]) / 2) * bins * Math.sqrt(3)) / (ymax - ymin);
    assert(Math.abs(a / aspect - 1) < 0.2, 'near the aspect: ' + a);
    const dx = a / bins;
    const dy = (dx / Math.sqrt(3)) * 1.5;
    // a point exactly between two centers (the outermost points are on the edges of the grid) may go to either
    const key = (cu, cv) => `${Math.round(cu * 1e6)},${Math.round(cv * 1e6)}`;
    const sure = new Map();
    const either = new Map();
    for (const r of rows) {
      const u = ((r.w - xmin) / (xmax - xmin)) * a;
      const v = (r.h - ymin) / (ymax - ymin);
      const all = [];
      for (let j = -2; j <= Math.ceil(1 / dy) + 2; j++)
        for (let i = -2; i <= bins + 2; i++) {
          const cu = (i + (j & 1) / 2) * dx;
          all.push([(u - cu) ** 2 + (v - j * dy) ** 2, key(cu, j * dy)]);
        }
      const least = Math.min(...all.map((d) => d[0]));
      const nearest = all.filter((d) => d[0] <= least + 1e-12).map((d) => d[1]);
      if (nearest.length === 1) sure.set(nearest[0], (sure.get(nearest[0]) || 0) + 1);
      else for (const k of nearest) either.set(k, (either.get(k) || 0) + 1);
    }
    for (let k = 0; k < t.length; k++) {
      const at = key(((c.w[k] - xmin) / (xmax - xmin)) * a, (c.h[k] - ymin) / (ymax - ymin));
      const n = c.count[k];
      assert(n >= (sure.get(at) || 0) && n <= (sure.get(at) || 0) + (either.get(at) || 0), `hexagon ${at}: ${n}`);
    }
    assert.strictEqual(
      [...sure.keys()].filter(
        (k) => !t.columns.count.some((_, i) => key(((c.w[i] - xmin) / (xmax - xmin)) * a, (c.h[i] - ymin) / (ymax - ymin)) === k),
      ).length,
      0,
      'every hexagon with points is there',
    );
    // the boxes: all one size, regular in those units (as tall as 2 / sqrt(3) of their width), around their center; all
    // of them together `aspect` times as wide as tall, as the scales will span them
    const spanned =
      (((Math.max(...c.x1) - Math.min(...c.x0)) / (xmax - xmin)) * a) / ((Math.max(...c.y1) - Math.min(...c.y0)) / (ymax - ymin)) / aspect;
    assert(near(spanned, 1, 0.02), 'the boxes span about `aspect`: ' + spanned);
    for (let k = 0; k < t.length; k++) {
      const wu = ((c.x1[k] - c.x0[k]) / (xmax - xmin)) * a;
      const hv = (c.y1[k] - c.y0[k]) / (ymax - ymin);
      assert(near(wu, dx, 1e-9) && near(hv / wu, 2 / Math.sqrt(3), 1e-9), `hexagon ${k}`);
      assert(near((c.x0[k] + c.x1[k]) / 2, c.w[k], 1e-9) && near((c.y0[k] + c.y1[k]) / 2, c.h[k], 1e-9));
    }
    // bottom row first, each row from the left: the same data in another order gives the same table
    const shuffled = apply('hexbin', rows.slice().reverse(), { x: 'w', y: 'h', bins, aspect });
    assert.deepStrictEqual(shuffled, t);
  });

  test('transform.hexbin: hostile rows and parameters', () => {
    const t = apply(
      'hexbin',
      [
        { x: 1, y: 2 },
        { x: NaN, y: 1 },
        { x: 'a', y: 1 },
        { x: null, y: 1 },
        { x: 3, y: Infinity },
        { x: 2, y: 3 },
      ],
      {
        x: 'x',
        y: 'y',
      },
    );
    assert.strictEqual(
      t.columns.count.reduce((a, b) => a + b, 0),
      2,
      'only rows with two numbers count',
    );
    const empty = { length: 0, columns: { x: [], y: [] } };
    assert.deepStrictEqual(BC.get('transform.hexbin').apply(empty, { type: 'hexbin', x: 'x', y: 'y' }), {
      length: 0,
      columns: { x0: [], x1: [], y0: [], y1: [], count: [], x: [], y: [] },
    });
    // every point on one spot: one hexagon around it, not a division by zero
    const one = apply(
      'hexbin',
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      { x: 'x', y: 'y' },
    );
    assert.strictEqual(one.length, 1);
    assert.strictEqual(one.columns.count[0], 2);
    assert(Object.values(one.columns).every((col) => col.every(Number.isFinite)));
    // bins and aspect that make no sense fall back, a huge bins is capped
    const rows = cloud(500);
    const plain = apply('hexbin', rows, { x: 'w', y: 'h' });
    for (const bad of [{ bins: 0 }, { bins: -3 }, { bins: NaN }, { bins: 'many' }, { aspect: 0 }, { aspect: -1 }, { aspect: Infinity }])
      assert.deepStrictEqual(apply('hexbin', rows, { x: 'w', y: 'h', ...bad }), plain, JSON.stringify(bad));
    const fine = apply('hexbin', rows, { x: 'w', y: 'h', bins: 1e9 });
    assert(fine.length <= 500 && fine.columns.count.reduce((a, b) => a + b, 0) === 500);
    const started = Date.now();
    assert.strictEqual(
      apply('hexbin', cloud(200000), { x: 'w', y: 'h', bins: 40 }).columns.count.reduce((a, b) => a + b, 0),
      200000,
    );
    assert(Date.now() - started < 2000, 'quick on 200,000 points');
    assert.throws(() => apply('hexbin', [{ x: 1, y: 1 }], { x: 'nope', y: 'y' }), /transform.hexbin: unknown field "nope" in "x"/);
    assert.throws(
      () => apply('hexbin', [{ x: 1, y: 1 }], { x: 'x', y: 'y', countAs: 'x' }),
      /"countAs" and "x" both name the new column "x"/,
    );
    // the data may have a column called count: the result is a table of its own
    assert.strictEqual(apply('hexbin', [{ x: 1, y: 1, count: 9 }], { x: 'x', y: 'y' }).columns.count[0], 1);
  });

  test('transform.hexbin without aspect follows the plot: regular on it whatever its shape and zoom, and says when it cannot', () => {
    const def = BC.get('transform.hexbin');
    assert.strictEqual(def.viewDependent({ type: 'hexbin', x: 'w', y: 'h' }), true, 'follows the plot');
    assert.strictEqual(def.viewDependent({ type: 'hexbin', x: 'w', y: 'h', aspect: 1.5 }), false, 'a fixed aspect is binned once');
    assert.strictEqual(def.viewDependent({ type: 'hexbin', x: 'w', y: 'h', aspect: -1 }), true, 'an aspect that makes no sense follows');
    const rows = cloud(2000);
    const cols = { w: rows.map((r) => r.w), h: rows.map((r) => r.h) };
    const linear = (domain, range) => {
      const s = (v) => range[0] + ((v - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);
      s.domain = () => domain;
      s.range = () => range;
      return s;
    };
    const warned = [];
    const viewOf = (scales) => ({ plot: { x: 0, y: 0, w: 1, h: 1 }, scales, warn: (m) => warned.push(m) });
    // wide, narrow, zoomed into a corner, y named otherwise: every hexagon as wide as sqrt(3)/2 of its height in px
    for (const [x, y, extra] of [
      [linear([30, 110], [0, 600]), linear([140, 200], [300, 0]), {}],
      [linear([30, 110], [0, 160]), linear([140, 200], [300, 0]), {}],
      [linear([60, 70], [0, 600]), linear([160, 170], [300, 0]), {}],
      [linear([30, 110], [0, 400]), linear([140, 200], [300, 0]), { yScale: 'up' }],
    ]) {
      const t = def.apply(
        { length: 2000, columns: cols },
        { type: 'hexbin', x: 'w', y: 'h', bins: 14, ...extra },
        viewOf(extra.yScale ? { x, up: y } : { x, y }),
      );
      assert.strictEqual(
        t.columns.count.reduce((a, b) => a + b, 0),
        2000,
      );
      for (let k = 0; k < t.length; k++) {
        const w = Math.abs(x(t.columns.x1[k]) - x(t.columns.x0[k]));
        const h = Math.abs(y(t.columns.y1[k]) - y(t.columns.y0[k]));
        assert(near(w / h, Math.sqrt(3) / 2, 1e-9), `hexagon ${k}: ${w} × ${h}`);
      }
      // as much of the data in each as in a hexagon binned for a plot 1.6 times as wide as tall, whatever the plot: 1/14
      // of the data across, and 2 * 1.6 / (14 * sqrt(3)) of it up
      const [spanX, spanY] = [Math.max(...cols.w) - Math.min(...cols.w), Math.max(...cols.h) - Math.min(...cols.h)];
      const area = (spanX / 14) * ((2 * 1.6 * spanY) / (14 * Math.sqrt(3)));
      for (let k = 0; k < t.length; k++)
        assert(near(((t.columns.x1[k] - t.columns.x0[k]) * (t.columns.y1[k] - t.columns.y0[k])) / area, 1, 1e-9), `area of hexagon ${k}`);
      // so the counts are about those the scales take their domains from, and the color legend holds
      const most = Math.max(...t.columns.count);
      assert(
        near(most / Math.max(...apply('hexbin', rows, { x: 'w', y: 'h', bins: 14 }).columns.count), 1, 0.35),
        'the largest count: ' + most,
      );
    }
    assert.deepStrictEqual(warned, []);
    // a scale it cannot follow: said once per binning, and binned as with no plot at all
    const plain = apply('hexbin', rows, { x: 'w', y: 'h', bins: 14 });
    for (const scales of [{}, { x: linear([5, 5], [0, 600]), y: linear([140, 200], [300, 0]) }]) {
      warned.length = 0;
      assert.deepStrictEqual(
        def.apply({ length: 2000, columns: cols }, { type: 'hexbin', x: 'w', y: 'h', bins: 14 }, viewOf(scales)),
        plain,
      );
      assert(warned.length === 1 && /transform\.hexbin: the scales "x" and "y" cannot be followed/.test(warned[0]), warned.join());
    }
  });

  test('a hexbin without aspect stays regular at any size of the chart, and its scales take their domains from it', () => {
    BC.data('cloud', cloud(2000));
    for (const size of [
      [640, 400],
      [300, 400],
      [640, 200],
    ]) {
      const { host, h } = draw({
        data: 'cloud',
        size,
        transforms: [{ type: 'hexbin', x: 'w', y: 'h', bins: 16 }],
        scales: { x: { type: 'linear', nice: false }, y: { type: 'linear', nice: false }, color: { type: 'sequential' } },
        guides: [
          { type: 'axis', scale: 'x' },
          { type: 'axis', scale: 'y' },
        ],
        marks: [{ type: 'rect', shape: 'hexagon', x: 'x0', x2: 'x1', y: 'y0', y2: 'y1', color: 'count' }],
      });
      assert.deepStrictEqual(h.diagnostics, [], String(size));
      const hexes = paths(layer(svgOf(host), 'marks')).map((p) => p.d.match(/-?[\d.]+/g).map(Number));
      assert(hexes.length > 20, String(size));
      for (const [mx, top, rx, q1, , q3] of hexes) {
        // the sides as long as the slanted edges, to the 0.01 px the path is written in
        const side = q3 - q1;
        assert(near(side / Math.hypot(rx - mx, q1 - top), 1, 0.01), `${size}: side ${side}`);
      }
    }
  });

  test('mark.rect shape hexagon: the cells of a hexbin tile, and the pointer finds the hexagon it is in', async () => {
    BC.data('cloud', cloud(2000));
    const picked = [];
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'cloud',
      size: [640, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'hexbin', x: 'w', y: 'h', bins: 16, aspect: 1.6 }],
      scales: { x: { type: 'linear', nice: false }, y: { type: 'linear', nice: false }, color: { type: 'sequential' } },
      marks: [{ type: 'rect', shape: 'hexagon', x: 'x0', x2: 'x1', y: 'y0', y2: 'y1', color: 'count' }],
      interaction: [{ type: 'tooltip', content: (d) => picked.push(d.row) && undefined }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const hexes = paths(layer(svgOf(host), 'marks')).map((p) => p.d.match(/-?[\d.]+/g).map(Number));
    assert(hexes.length > 20 && hexes.every((v) => v.length === 12), 'six corners each');
    // regular on a plot as wide as the aspect says: the sides are as long as the slanted edges
    const [mx, top, rx, q1, , q3, , bottom, lx] = hexes[0];
    const side = q3 - q1;
    const edge = Math.hypot(rx - mx, q1 - top);
    assert(near(side / edge, 1, 0.02), `side ${side}, edge ${edge}`);
    assert(near((bottom - top) / (2 * side), 1, 0.02) && near((rx - lx) / (Math.sqrt(3) * side), 1, 0.02));
    // the pointer finds the hexagon it is in, also in the corners where the boxes of two rows overlap
    const box = host.children[0].getBoundingClientRect();
    const at = async (x, y) => {
      picked.length = 0;
      await hover(host, box.left + (x * box.width) / 640, box.top + (y * box.height) / 400);
      return tipOf(host).style.display === 'block' ? picked[picked.length - 1] : null;
    };
    const inside = (v, x, y) => {
      const u = Math.abs(x - v[0]) / ((v[2] - v[8]) / 2);
      const w = Math.abs(y - (v[1] + v[7]) / 2) / ((v[7] - v[1]) / 2);
      return u <= 1 && w <= 1 - u / 2;
    };
    let corners = 0;
    for (let k = 0; k < hexes.length; k++) {
      const v = hexes[k];
      assert.strictEqual(await at(v[0], (v[1] + v[7]) / 2), k, `the middle of hexagon ${k}`);
      // just inside the top right corner of its box, which is outside the hexagon
      const [x, y] = [v[2] - 1, v[1] + 1];
      const owner = hexes.findIndex((o) => inside(o, x, y));
      assert.strictEqual(await at(x, y), owner < 0 ? null : owner, `the corner of the box of hexagon ${k}`);
      if (owner >= 0 && owner !== k) corners++;
    }
    assert(corners > 5, 'corners that belong to a neighbor were tried: ' + corners);
  });

  // ───────────────────────── transform.contour, mark.polygon ─────────────────────────

  /** Points on a ring of radius 10 around 0, 0, from a fixed seed: its densest region has a hole in the middle. */
  const ringCloud = (n) => {
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    return Array.from({ length: n }, () => {
      const a = rnd() * 2 * Math.PI;
      const r = 10 + gauss();
      return { w: Math.cos(a) * r, h: Math.sin(a) * r };
    });
  };
  /** The outlines of a contour table: per ring its level, share, density and points. */
  const ringsOf = (t, xf = 'w', yf = 'h') => {
    const out = new Map();
    for (let k = 0; k < t.length; k++) {
      const id = t.columns.ring[k];
      if (!out.has(id)) out.set(id, { level: t.columns.level[k], share: t.columns.share[k], density: t.columns.density[k], pts: [] });
      out.get(id).pts.push([t.columns[xf][k], t.columns[yf][k]]);
    }
    return [...out.values()];
  };
  const signedArea = (pts) =>
    pts.reduce((a, p, i) => a + (pts[(i || pts.length) - 1][0] * p[1] - p[0] * pts[(i || pts.length) - 1][1]), 0) / 2;
  /** Inside the outlines of one level by the nonzero rule, as mark.polygon fills them. */
  const insideOf = (rings, x, y) => {
    let w = 0;
    for (const { pts } of rings)
      for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) {
        const [x0, y0] = pts[m];
        const [x1, y1] = pts[k];
        const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y0 <= y) {
          if (y1 > y && side > 0) w++;
        } else if (y1 <= y && side < 0) w--;
      }
    return w !== 0;
  };

  test('transform.contour: each region holds its share of the points, its outline is where the density is its level', () => {
    const rows = cloud(3000);
    const shares = [0.25, 0.5, 0.75, 0.95];
    const t = apply('contour', rows, { x: 'w', y: 'h', shares });
    const rings = ringsOf(t);
    const levels = [...new Set(rings.map((r) => r.level))];
    assert.deepStrictEqual(levels, [1, 2, 3, 4], 'the outermost first');
    for (const level of levels) {
      const mine = rings.filter((r) => r.level === level);
      const share = mine[0].share;
      assert(near(share, shares[4 - level], 1 / 3000), `level ${level} holds ${share}`);
      // the points inside the outlines drawn: as many as `share` says, but for those on the very edge
      const inside = rows.filter((p) => insideOf(mine, p.w, p.h)).length / rows.length;
      assert(near(inside, share, 0.02), `level ${level}: ${inside} of the points inside, ${share} said`);
    }
    // on an outline the density, worked out from every point with no grid, is the level of that outline
    const xs = rows.map((p) => p.w);
    const ys = rows.map((p) => p.h);
    const scott = (v) => {
      const s = v.slice().sort((a, b) => a - b);
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1));
      const q = (p) =>
        s[Math.floor(p * (s.length - 1))] +
        (s[Math.ceil(p * (s.length - 1))] - s[Math.floor(p * (s.length - 1))]) * (p * (s.length - 1) - Math.floor(p * (s.length - 1)));
      return Math.min(sd, (q(0.75) - q(0.25)) / 1.34) * Math.pow(s.length, -1 / 6);
    };
    const [bx, by] = [scott(xs), scott(ys)];
    const density = (x, y) =>
      rows.reduce((a, p) => a + Math.exp(-((p.w - x) ** 2) / (2 * bx * bx) - (p.h - y) ** 2 / (2 * by * by)), 0) /
      (rows.length * 2 * Math.PI * bx * by);
    for (const r of rings)
      for (let k = 0; k < r.pts.length; k += 7) {
        const d = density(...r.pts[k]);
        assert(near(d / r.density, 1, 0.05), `level ${r.level}: ${d} on an outline of ${r.density}`);
      }
    // outlines run counterclockwise around a region; nested, each inside the one before
    assert(rings.every((r) => signedArea(r.pts) > 0));
    // the same data in another order gives the same table
    assert.deepStrictEqual(apply('contour', rows.slice().reverse(), { x: 'w', y: 'h', shares }), t);
    // levels: even steps of the density, up to its peak
    const even = ringsOf(apply('contour', rows, { x: 'w', y: 'h', levels: 3 }));
    const steps = [...new Set(even.map((r) => r.density))];
    assert.strictEqual(steps.length, 3);
    assert(near(steps[1] - steps[0], steps[0], 1e-12) && near(steps[2] - steps[1], steps[0], 1e-12), 'even steps');
    assert(
      even.every((r, i) => i === 0 || r.share <= even[i - 1].share),
      'a higher level holds fewer points',
    );
  });

  test('transform.contour: a region with a hole has an outline the other way round, and the hole is left empty', () => {
    const rows = ringCloud(20000);
    const rings = ringsOf(apply('contour', rows, { x: 'w', y: 'h', shares: [0.9] }));
    assert.strictEqual(rings.length, 2, 'an outline and a hole');
    const [outer, hole] = rings.slice().sort((a, b) => Math.abs(signedArea(b.pts)) - Math.abs(signedArea(a.pts)));
    assert(signedArea(outer.pts) > 0 && signedArea(hole.pts) < 0, 'the hole runs clockwise');
    assert(!insideOf(rings, 0, 0), 'the middle is a hole');
    assert(insideOf(rings, 10, 0) && insideOf(rings, 0, -10), 'the ring is inside');
    assert(!insideOf(rings, 16, 0), 'beyond it is outside');
  });

  test('transform.contour extent: no region runs past a cut, an outline that meets one runs along it, points beyond are in none', () => {
    // distances: none below 0, most near it
    const rows = cloud(2000).map((p) => ({ w: Math.abs(p.w - 60), h: p.h }));
    const free = apply('contour', rows, { x: 'w', y: 'h', shares: [0.5, 0.95] });
    assert(Math.min(...free.columns.w) < 0, 'without a cut the density runs below 0');
    const t = apply('contour', rows, { x: 'w', y: 'h', shares: [0.5, 0.95], extent: [[0, null], null] });
    assert(Math.min(...t.columns.w) === 0, 'along the cut, and not past it');
    for (const r of ringsOf(t)) {
      const inside =
        rows.filter((p) =>
          insideOf(
            ringsOf(t).filter((q) => q.level === r.level),
            p.w,
            p.h,
          ),
        ).length / rows.length;
      assert(near(inside, r.share, 0.02), `level ${r.level}: ${inside} inside, ${r.share} said`);
    }
    // a cut through the points: those beyond it are in no region, so a region holds fewer of them
    const half = apply('contour', rows, {
      x: 'w',
      y: 'h',
      levels: 2,
      extent: [
        [null, 10],
        [null, null],
      ],
    });
    const left = rows.filter((p) => p.w <= 10).length / rows.length;
    assert(Math.max(...half.columns.w) <= 10 + 1e-9 && half.columns.share.every((s) => s <= left + 1e-12), 'beyond the cut is in none');
  });

  test('transform.contour: two dense spots on the corners of a cell are one region where its middle is above the level, two where not', () => {
    // a bandwidth far below a cell: the density is the points themselves, on the nodes of an 8 × 8 grid over 0..7
    const rows = [
      ...Array.from({ length: 10 }, () => ({ x: 2, y: 2 })),
      ...Array.from({ length: 10 }, () => ({ x: 3, y: 3 })),
      { x: 0, y: 0 },
      { x: 7, y: 7 },
    ];
    const rings = ringsOf(apply('contour', rows, { x: 'x', y: 'y', grid: 8, levels: 3, bandwidth: [0.001, 0.001] }), 'x', 'y');
    // the middle of the cell between them is half the peak: above the lowest level (a quarter), below the top (three quarters)
    const low = rings.filter((r) => r.level === 1);
    const top = rings.filter((r) => r.level === 3);
    assert.strictEqual(low.length, 1, 'one region around both');
    assert(insideOf(low, 2, 2) && insideOf(low, 3, 3) && insideOf(low, 2.5, 2.5));
    assert.strictEqual(top.length, 2, 'a region around each');
    assert(insideOf(top, 2, 2) && insideOf(top, 3, 3) && !insideOf(top, 2.5, 2.5));
  });

  test('transform.contour: hostile rows and parameters', () => {
    const t = apply(
      'contour',
      [
        { x: 1, y: 2 },
        { x: NaN, y: 1 },
        { x: 'a', y: 1 },
        { x: null, y: 1 },
        { x: 3, y: Infinity },
        { x: 2, y: 3 },
        { x: 2, y: 2 },
      ],
      { x: 'x', y: 'y', levels: 2 },
    );
    assert(t.length > 0 && Object.values(t.columns).every((c) => c.every(Number.isFinite)), 'three points still have regions');
    assert.deepStrictEqual(
      BC.get('transform.contour').apply({ length: 0, columns: { x: [], y: [] } }, { type: 'contour', x: 'x', y: 'y' }),
      {
        length: 0,
        columns: { level: [], share: [], density: [], ring: [], x: [], y: [] },
      },
    );
    // every point on one spot: a small region around it, not a division by zero
    const one = apply(
      'contour',
      Array.from({ length: 5 }, () => ({ x: 5, y: 5 })),
      { x: 'x', y: 'y', levels: 1 },
    );
    assert(one.length > 2 && Object.values(one.columns).every((c) => c.every(Number.isFinite)));
    assert(insideOf(ringsOf(one, 'x', 'y'), 5, 5));
    const rows = cloud(500);
    for (const [bad, message] of [
      [{ grid: 3 }, /"grid" must be a whole number from 8 to 400/],
      [{ grid: 1e6 }, /"grid"/],
      [{ grid: 20.5 }, /"grid"/],
      [{ levels: 0 }, /"levels" must be a whole number from 1 to 50/],
      [{ levels: 'many' }, /"levels"/],
      [{ shares: [] }, /"shares" must be a list/],
      [{ shares: [0.5, 1] }, /"shares"/],
      [{ shares: [0, 0.5] }, /"shares"/],
      [{ shares: 0.5 }, /"shares"/],
      [{ shares: ['half'] }, /"shares"/],
      [{ bandwidth: [1] }, /"bandwidth" must be \[along x, along y\]/],
      [{ bandwidth: [-1, 2] }, /"bandwidth"/],
      [{ bandwidth: 2 }, /"bandwidth"/],
      [{ bandwidth: [Infinity, 2] }, /"bandwidth"/],
    ])
      assert.throws(() => apply('contour', rows, { x: 'w', y: 'h', ...bad }), message, JSON.stringify(bad));
    for (const extent of [[[0]], [0, null], [[1, 0], null], [['a', null], null], [[null, null]], [[0, NaN], null], 'none'])
      assert.throws(
        () => apply('contour', rows, { x: 'w', y: 'h', extent }),
        /"extent" must be \[\[x low, x high\], \[y low, y high\]\]/,
        JSON.stringify(extent),
      );
    assert.throws(() => apply('contour', rows, { x: 'w', y: 'h', extent: [[1000, null], null] }), /"extent" leaves no room for the points/);
    assert.throws(() => apply('contour', rows, { x: 'nope', y: 'h' }), /transform.contour: unknown field "nope" in "x"/);
    assert.throws(() => apply('contour', [{ level: 1, y: 1 }], { x: 'level', y: 'y' }), /transform.contour: .*"level"/);
    // the data may have columns called level or share: the result is a table of its own
    assert(
      apply(
        'contour',
        rows.map((r) => ({ ...r, share: 9 })),
        { x: 'w', y: 'h', levels: 1 },
      ).columns.share.every((s) => s < 1),
    );
    // null keeps the rule on that axis; a wider bandwidth along y makes the outermost region taller
    const tall = (by) => {
      const r = ringsOf(apply('contour', rows, { x: 'w', y: 'h', levels: 3, bandwidth: [null, by] })).filter((q) => q.level === 1);
      const ys = r.flatMap((q) => q.pts.map((p) => p[1]));
      return [Math.min(...ys), Math.max(...ys)];
    };
    const [lo1, hi1] = tall(1);
    const [lo6, hi6] = tall(6);
    assert(lo6 < lo1 && hi6 > hi1, `taller with a wider bandwidth: ${[lo1, hi1]} and ${[lo6, hi6]}`);
    const rule = ringsOf(apply('contour', rows, { x: 'w', y: 'h', levels: 3 }));
    const ruleX = ringsOf(apply('contour', rows, { x: 'w', y: 'h', levels: 3, bandwidth: [null, null] }));
    assert.deepStrictEqual(ruleX, rule, '[null, null] is the rule');
    const started = Date.now();
    const many = apply('contour', cloud(200000), { x: 'w', y: 'h', shares: [0.5, 0.9] });
    assert(many.length > 0 && Date.now() - started < 3000, 'quick on 200,000 points: ' + (Date.now() - started) + ' ms');
  });

  test('mark.polygon: a shape per group, outlines per ring, holes left empty, and the pointer finds the top shape', async () => {
    BC.data('ringcloud', ringCloud(20000));
    const picked = [];
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'ringcloud',
      size: [400, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'contour', x: 'w', y: 'h', shares: [0.5, 0.9] }],
      scales: { x: { type: 'linear', domain: [-20, 20] }, y: { type: 'linear', domain: [-20, 20] }, color: { type: 'sequential' } },
      marks: [{ type: 'polygon', x: 'w', y: 'h', group: 'level', ring: 'ring', color: 'share' }],
      interaction: [{ type: 'tooltip', content: (d) => picked.push(d.row) && undefined }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const shapes = paths(layer(svgOf(host), 'marks'));
    assert.strictEqual(shapes.length, 2, 'a path per level');
    assert(
      shapes.every((p) => (p.d.match(/M/g) || []).length === 2 && /Z$/.test(p.d)),
      'an outline and a hole in each',
    );
    const box = host.children[0].getBoundingClientRect();
    const at = async (x, y) => {
      picked.length = 0;
      // data -20..20 on 400 px, y up
      await hover(host, box.left + ((x + 20) / 40) * box.width, box.top + ((20 - y) / 40) * box.height);
      return tipOf(host).style.display === 'block' ? picked[picked.length - 1] : null;
    };
    const t = apply('contour', ringCloud(20000), { x: 'w', y: 'h', shares: [0.5, 0.9] });
    const levelAt = async (x, y) => {
      const row = await at(x, y);
      return row === null ? null : t.columns.level[row];
    };
    // along a line out of the middle: the top region the point is in (the densest), nothing in the hole and beyond
    const regions = ringsOf(t);
    const seen = new Set();
    for (let r = 0; r <= 16; r += 0.25) {
      const y = r + 0.01;
      let expected = null;
      for (const level of [2, 1])
        if (
          expected === null &&
          insideOf(
            regions.filter((q) => q.level === level),
            0,
            y,
          )
        )
          expected = level;
      assert.strictEqual(await levelAt(0, y), expected, 'at 0, ' + y);
      seen.add(expected);
    }
    assert.deepStrictEqual([...seen].sort(), [1, 2, null].sort(), 'the hole, both regions and the outside were tried');

    // any outline given point by point; filled: false draws only the outline in the shape's color
    BC.data('shapes', [
      { x: 0, y: 0, k: 'a' },
      { x: 4, y: 0, k: 'a' },
      { x: 0, y: 4, k: 'a' },
      { x: 5, y: 5, k: 'b' },
      { x: NaN, y: 6, k: 'b' },
      { x: 6, y: 5, k: 'b' },
      { x: 9, y: 9, k: 'c' },
      { x: 9, y: 8, k: 'c' },
    ]);
    const { svg, h: h2 } = draw({
      data: 'shapes',
      size: [200, 200],
      scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'polygon', x: 'x', y: 'y', group: 'k', filled: false, fill: '#123456', strokeWidth: 2 }],
    });
    assert.deepStrictEqual(h2.diagnostics, []);
    const drawn = paths(layer(svg, 'marks'));
    assert.strictEqual(drawn.length, 1, 'b lost a point and c has two: neither is a shape');
    assert(
      /fill="none"/.test(drawn[0].attrs) && /stroke="#123456"/.test(drawn[0].attrs) && /stroke-width="2"/.test(drawn[0].attrs),
      drawn[0].attrs,
    );
  });

  // ───────────────────────── mark.sankey ────
  const flows = (rows, extra = {}) => {
    BC.data('flows', rows);
    return draw({
      data: 'flows',
      size: [600, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'sankey', source: 's', target: 't', value: 'v' }],
      marks: [{ type: 'sankey', source: 's', target: 't', value: 'v', ...extra }],
    });
  };
  const nodeRects = (svg) => rects(marks(svg));

  test('mark.sankey: columns from the flows, heights in proportion, a node as tall as what passes through it', () => {
    const { svg } = flows([
      { s: 'A', t: 'B', v: 30 },
      { s: 'A', t: 'C', v: 10 },
      { s: 'B', t: 'D', v: 30 },
      { s: 'C', t: 'D', v: 10 },
    ]);
    const nodes = nodeRects(svg);
    assert.strictEqual(nodes.length, 4);
    assert.strictEqual(paths(marks(svg)).length, 4, 'a ribbon per flow');
    assert.deepStrictEqual([...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b).length, 3, 'three columns');
    const height = (i) => nodes[i].h;
    assert(near(height(1) / height(2), 3, 0.02), 'B is three times C: ' + height(1) + ' / ' + height(2));
    assert(near(height(0), height(3), 0.02), 'A and D carry the same');
    for (const n of nodes) assert(n.y >= 0 && n.y + n.h <= 400.01 && n.x >= 0 && n.x + n.w <= 600.01, 'inside the plot');
    assert.deepStrictEqual(texts(marks(svg)).sort(), ['A', 'B', 'C', 'D']);
  });

  test('mark.sankey: a node skips a column when a flow reaches past it, and sinks end in the last column', () => {
    const { svg } = flows([
      { s: 'A', t: 'B', v: 5 },
      { s: 'B', t: 'C', v: 5 },
      { s: 'A', t: 'C', v: 5 },
      { s: 'A', t: 'E', v: 5 },
    ]);
    const nodes = nodeRects(svg);
    const xs = [...new Set(nodes.map((n) => n.x))];
    assert.strictEqual(xs.length, 3);
    assert.strictEqual(nodes.filter((n) => n.x === Math.max(...xs)).length, 2, 'C and E share the last column');
  });

  test('mark.sankey: crossings are sorted out where they can be', () => {
    // two chains that the row order interleaves: in the order the names first come, A1 above A2 flows to B2 below B1
    const { svg } = flows([
      { s: 'B1', t: 'C2', v: 10 },
      { s: 'B2', t: 'C1', v: 10 },
      { s: 'A1', t: 'B2', v: 10 },
      { s: 'A2', t: 'B1', v: 10 },
    ]);
    const d = paths(marks(svg)).map((p) => p.d.match(/^M[\d.]+ ([\d.]+)C.* ([\d.]+) ([\d.]+)L/));
    const firstLevel = d.map((m) => [+m[1], +m[3]]);
    for (const [from, to] of firstLevel) assert(near(from, to, 0.5), 'level ribbons: ' + firstLevel);
  });

  test('mark.sankey: hostile rows', () => {
    const { svg } = flows([
      { s: 'A', t: 'B', v: 10 },
      { s: 'A', t: 'A', v: 99 },
      { s: 'A', t: 'B', v: -5 },
      { s: 'A', t: 'B', v: 0 },
      { s: 'A', t: 'B', v: 'many' },
      { s: null, t: 'B', v: 5 },
      { s: 'A', t: '', v: 5 },
      { s: '<b>', t: '__proto__', v: 5 },
    ]);
    assert.strictEqual(paths(marks(svg)).length, 2, 'only the two real flows');
    assert(!svg.includes('<b>') && svg.includes('__proto__'), 'names are text');
    assert(!/NaN|Infinity/.test(svg), 'no broken numbers');
    assert.strictEqual(paths(marks(flows([{ s: 'A', t: 'B', v: 0 }]).svg)).length, 0, 'nothing to draw is not an error');
    const long = Array.from({ length: 60 }, (_, i) => ({ s: 'A', t: 'n' + i, v: 1 }));
    const crowded = flows(long).svg;
    assert(!/NaN/.test(crowded));
    assert(
      nodeRects(crowded).every((n) => n.y >= -0.01 && n.y + n.h <= 400.01),
      'a crowded column stays in the plot',
    );
    assert(texts(marks(crowded)).length < 60, 'nodes too short for a label go without');
  });

  test('mark.sankey: a label never runs past the space between the columns', () => {
    const rows = [
      { s: 'A', t: 'A rather long name of a stage in the middle', v: 10 },
      { s: 'A rather long name of a stage in the middle', t: 'C', v: 10 },
    ];
    BC.data('flows', rows);
    const narrow = (width) =>
      draw({
        data: 'flows',
        size: [width, 300],
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        transforms: [{ type: 'sankey', source: 's', target: 't', value: 'v' }],
        marks: [{ type: 'sankey', source: 's', target: 't', value: 'v', format: 'integer' }],
      }).svg;
    const short = texts(marks(narrow(300)));
    assert(
      short.some((t) => t.endsWith('…')),
      'cut: ' + short,
    );
    assert(
      short.every((t) => t.length * 7.2 <= 150),
      'within a column: ' + short,
    );
    assert(texts(marks(narrow(1400))).includes('A rather long name of a stage in the middle 10'), 'whole where there is room');
  });

  /** A chart's context for mark.sankey alone, on the rows transform.sankey has laid out. */
  const sankeyCtx = (rows, color = () => '#000') => {
    const t = apply('sankey', rows, { source: 's', target: 't', value: 'v' });
    return {
      table: t,
      channel: (_s, n) => ({ raw: t.columns[{ source: 's', target: 't', value: 'v' }[n]] }),
      rows: () => ({ from: 0, to: rows.length }),
      plot: { x: 0, y: 0, w: 600, h: 400 },
      color,
      measure: () => ({ w: 0, h: 0 }),
      format: (f, kind) => BC.formatter(f, kind),
    };
  };

  test('transform.sankey: a loop is an error that names it, not a hang', () => {
    const loop = [
      { s: 'A', t: 'B', v: 1 },
      { s: 'B', t: 'A', v: 1 },
      { s: 'C', t: 'A', v: 1 },
    ];
    assert.throws(
      () => apply('sankey', loop, { source: 's', target: 't', value: 'v' }),
      /transform.sankey: the flows go round in a loop through "A", "B"; a Sankey needs them to run one way/,
    );
  });

  test('transform.sankey: where each flow runs, in shares of the plot, one height per unit of value', () => {
    const rows = [
      { s: 'A', t: 'B', v: 30 },
      { s: 'A', t: 'C', v: 10 },
      { s: 'B', t: 'D', v: 30 },
      { s: 'C', t: 'D', v: 10 },
      { s: 'A', t: 'A', v: 5 },
      { s: 'A', t: 'B', v: -1 },
      { s: null, t: 'B', v: 3 },
    ];
    const t = apply('sankey', rows, { source: 's', target: 't', value: 'v' });
    const c = t.columns;
    assert.strictEqual(t.length, rows.length, 'every row is kept');
    assert.deepStrictEqual(
      c.s,
      rows.map((r) => r.s),
    );
    assert.deepStrictEqual(c.x0.slice(0, 4), [0, 0, 0.5, 0.5], 'three columns: 0, a half and 1');
    assert.deepStrictEqual(c.x1.slice(0, 4), [0.5, 0.5, 1, 1]);
    for (const k of [4, 5, 6])
      for (const n of ['x0', 'x1', 'y0', 'y1', 'thickness']) assert(Number.isNaN(c[n][k]), 'a row with no flow has no place: ' + k);
    const unit = c.thickness[0] / 30;
    for (let k = 0; k < 4; k++) assert(near(c.thickness[k], rows[k].v * unit, 1e-12), 'the same height for a value everywhere');
    // B and C share the middle column with the default gap between them, so the middle is the fullest
    assert(near(40 * unit + 0.03, 1, 1e-12), 'the fullest column fills the height: ' + 40 * unit);
    assert(near(Math.abs(c.y1[0] - c.y1[1]) - (c.y1[0] < c.y1[1] ? c.thickness[0] : c.thickness[1]), 0.03, 1e-12), 'the gap');
    // A's two ribbons leave it one under the other, and D's arrive so
    assert(near(Math.abs(c.y0[0] - c.y0[1]), c.y0[0] < c.y0[1] ? c.thickness[0] : c.thickness[1], 1e-12));
    assert(near(Math.abs(c.y1[2] - c.y1[3]), c.y1[2] < c.y1[3] ? c.thickness[2] : c.thickness[3], 1e-12));
    for (let k = 0; k < 4; k++)
      for (const n of ['y0', 'y1']) assert(c[n][k] >= -1e-12 && c[n][k] + c.thickness[k] <= 1 + 1e-12, 'inside the plot');
    const one = apply('sankey', [{ s: 'A', t: 'B', v: 2 }], { source: 's', target: 't', value: 'v' }).columns;
    assert.deepStrictEqual([one.x0[0], one.x1[0], one.y0[0], one.y1[0], one.thickness[0]], [0, 1, 0, 0, 1], 'one flow fills it');
    const none = apply('sankey', [{ s: 'A', t: 'B', v: 0 }], { source: 's', target: 't', value: 'v' });
    assert(Number.isNaN(none.columns.x0[0]), 'nothing to lay out is not an error');
    const touching = apply(
      'sankey',
      [
        { s: 'A', t: 'B', v: 1 },
        { s: 'A', t: 'C', v: 1 },
      ],
      { source: 's', target: 't', value: 'v', nodeGap: 0 },
    ).columns;
    assert(near(Math.abs(touching.y1[1] - touching.y1[0]), 0.5, 1e-12), 'with no gap the nodes of a column touch');
  });

  test('transform.sankey: renamed columns, and the mark told where they are', () => {
    const rows = [
      { s: 'A', t: 'B', v: 3 },
      { s: 'B', t: 'C', v: 2 },
    ];
    const as = ['a0', 'a1', 'b0', 'b1', 'th'];
    const plain = apply('sankey', rows, { source: 's', target: 't', value: 'v' }).columns;
    const named = apply('sankey', rows, { source: 's', target: 't', value: 'v', as }).columns;
    assert.deepStrictEqual(named.th, plain.thickness);
    assert(!('x0' in named));
    BC.data('flows', rows);
    const chart = (layout) =>
      draw({
        data: 'flows',
        size: [600, 400],
        transforms: [{ type: 'sankey', source: 's', target: 't', value: 'v', as }],
        marks: [{ type: 'sankey', source: 's', target: 't', value: 'v', ...(layout && { layout }) }],
      });
    const told = chart(as);
    assert.deepStrictEqual(told.h.diagnostics, []);
    assert.strictEqual(nodeRects(told.svg).length, 3);
    const untold = chart(undefined);
    assert(
      untold.h.diagnostics.some((d) =>
        /mark.sankey: there is no column "x0" with the layout of the flows: put a sankey transform before it/.test(d.message),
      ),
      JSON.stringify(untold.h.diagnostics),
    );
    assert(
      chart(['a0', 'a1']).h.diagnostics.some((d) => /mark.sankey: "layout" must be five column names/.test(d.message)),
      'a short layout is an error',
    );
    const bare = draw({ data: 'flows', marks: [{ type: 'sankey', source: 's', target: 't', value: 'v' }] });
    assert(
      bare.h.diagnostics.some((d) => /put a sankey transform before it/.test(d.message)),
      'a mark with no transform says what to add: ' + JSON.stringify(bare.h.diagnostics),
    );
  });

  test('transform.sankey: hostile parameters', () => {
    const rows = [{ s: 'A', t: 'B', v: 1 }];
    for (const [bad, message] of [
      [{ nodeGap: -0.1 }, /transform.sankey: "nodeGap" must be a share of the height/],
      [{ nodeGap: 1 }, /"nodeGap"/],
      [{ nodeGap: 'wide' }, /"nodeGap"/],
      [{ nodeGap: NaN }, /"nodeGap"/],
      [{ as: ['a', 'b'] }, /transform.sankey: "as" must be five column names/],
      [{ as: ['a', 'b', 'c', 'd', ''] }, /"as"/],
      [{ as: 'x0' }, /"as"/],
    ])
      assert.throws(() => apply('sankey', rows, { source: 's', target: 't', value: 'v', ...bad }), message, JSON.stringify(bad));
    assert.throws(() => apply('sankey', rows, { source: 'nope', target: 't', value: 'v' }), /transform.sankey/);
    assert.throws(() => apply('sankey', [{ s: 'A', t: 'B', v: 1, y0: 3 }], { source: 's', target: 't', value: 'v' }), /"y0"/);
  });

  test('mark.sankey: a node answers with what flows through it, in its own words', () => {
    const rows = [
      { s: 'A', t: 'M', v: 1200 },
      { s: 'B', t: 'M', v: 300 },
      { s: 'M', t: 'Z', v: 1000 },
    ];
    const ctx = sankeyCtx(rows, () => '#123');
    const mark = BC.get('mark.sankey');
    const spec = { type: 'sankey', source: 's', target: 't', value: 'v', format: 'integer' };
    const nodes = mark.render(spec, ctx, 0).filter((p) => p.type === 'rect');
    const at = (n, s = spec) => mark.pick(s, ctx, 0, n.x + n.w / 2, n.y + n.h / 2);
    const cards = nodes.map((n) => at(n).card);
    const middle = cards.find((c) => c.title === 'M');
    assert.deepStrictEqual(middle.lines, [
      ['In', '1,500'],
      ['Out', '1,000'],
    ]);
    assert.strictEqual(middle.color, '#123');
    assert.deepStrictEqual(cards.find((c) => c.title === 'A').lines, [['Out', '1,200']], 'a first node has no inflow to report');
    assert.deepStrictEqual(cards.find((c) => c.title === 'Z').lines, [['In', '1,000']]);
    const named = at(nodes[0], { ...spec, nodeLabels: ['유입', '유출'] });
    assert.strictEqual(named.card.lines[0][0], '유출');
    const plain = at(nodes[0], { ...spec, format: undefined });
    assert.strictEqual(plain.card.lines[0][1], '1200');
    assert(at(nodes[0]).box.w > 0, 'the node is what lights up');
  });

  test('mark.sankey: pick finds the ribbon under the pointer, on a curve and off it', () => {
    const rows = [
      { s: 'A', t: 'X', v: 10 },
      { s: 'A', t: 'Y', v: 30 },
      { s: 'B', t: 'X', v: 10 },
    ];
    const ctx = sankeyCtx(rows);
    const spec = { type: 'sankey', source: 's', target: 't', value: 'v' };
    const prims = BC.get('mark.sankey')
      .render(spec, ctx, 0)
      .filter((p) => p.type === 'path');
    for (const p of prims) {
      const m = p.d.match(/^M([\d.]+) ([\d.]+)C.* ([\d.]+) ([\d.]+)L[\d.]+ ([\d.]+)/);
      const x = (+m[1] + +m[3]) / 2;
      const y = (+m[2] + +m[4]) / 2 + (+m[5] - +m[4]) / 2; // in the middle of the curve, the middle of the ribbon
      const hit = BC.get('mark.sankey').pick(spec, ctx, 0, x, y);
      assert(hit && hit.row === p.ref.row, 'the ribbon of row ' + p.ref.row + ': ' + JSON.stringify(hit));
    }
    let empty = 0;
    for (let x = 20; x < 580; x += 40) for (let y = 0; y < 400; y += 8) if (!BC.get('mark.sankey').pick(spec, ctx, 0, x, y)) empty++;
    assert(empty > 0, 'between the ribbons, nothing');
  });

  // ───────────────────────── transform.treemap ─────────────────────────

  const cellsOf = (t) => {
    const c = t.columns;
    const out = [];
    for (let i = 0; i < t.length; i++) if (!isNaN(c.x0[i])) out.push({ i, x0: c.x0[i], x1: c.x1[i], y0: c.y0[i], y1: c.y1[i] });
    return out;
  };
  const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-9;

  test('transform.treemap: areas in proportion, inside the unit square, no overlaps, largest at the top left', () => {
    const rows = [30, 5, 20, 10, 15, 8, 7, 3, 2].map((v, i) => ({ name: 'n' + i, v }));
    const t = apply('treemap', rows, { field: 'v', name: 'name', padding: 0, aspect: 1.6 });
    const cells = cellsOf(t);
    assert.strictEqual(cells.length, rows.length);
    const total = rows.reduce((a, r) => a + r.v, 0);
    for (const c of cells) {
      assert(c.x0 >= -1e-9 && c.x1 <= 1 + 1e-9 && c.y0 >= -1e-9 && c.y1 <= 1 + 1e-9, 'inside [0, 1]');
      assert(near((c.x1 - c.x0) * (c.y1 - c.y0), rows[c.i].v / total, 1e-9), `area of ${rows[c.i].v} is its share`);
    }
    for (let a = 0; a < cells.length; a++)
      for (let b = a + 1; b < cells.length; b++) assert(!overlap(cells[a], cells[b]), `cells ${a} and ${b} do not overlap`);
    const biggest = cells.find((c) => c.i === 0);
    assert(near(biggest.x0, 0) && near(biggest.y1, 1), 'the largest cell is at the top left');
    // squarified: in the chart's proportions, no cell is a sliver
    for (const c of cells) {
      const ratio = ((c.x1 - c.x0) * 1.6) / (c.y1 - c.y0);
      assert(ratio < 6 && ratio > 1 / 6, `cell ${c.i} is not a sliver (${ratio.toFixed(2)})`);
    }
    assert.deepStrictEqual(
      Array.from(t.columns.x0),
      Array.from(apply('treemap', rows, { field: 'v', name: 'name', padding: 0 }).columns.x0),
      'deterministic',
    );
  });

  test('transform.treemap: groups make blocks, labels only for big cells, bad rows and padding', () => {
    const rows = [
      { g: 'EU', p: 'a', v: 40 },
      { g: 'US', p: 'b', v: 30 },
      { g: 'EU', p: 'c', v: 10 },
      { g: 'US', p: 'd', v: 15 },
      { g: 'EU', p: 'tiny', v: 0.5 },
      { g: 'US', p: 'neg', v: -5 },
      { g: 'US', p: 'nan', v: 'x' },
    ];
    const t = apply('treemap', rows, { field: 'v', group: 'g', name: 'p', padding: 0, labelMin: 0.05 });
    const cells = cellsOf(t);
    assert.deepStrictEqual(cells.map((c) => c.i).sort(), [0, 1, 2, 3, 4], 'zero, negative and non-numeric sizes are left out');
    const box = (g) => {
      const mine = cells.filter((c) => rows[c.i].g === g);
      return {
        x0: Math.min(...mine.map((c) => c.x0)),
        x1: Math.max(...mine.map((c) => c.x1)),
        y0: Math.min(...mine.map((c) => c.y0)),
        y1: Math.max(...mine.map((c) => c.y1)),
      };
    };
    assert(!overlap(box('EU'), box('US')), 'each group is one block');
    assert.deepStrictEqual(Array.from(t.columns.label), ['a', 'b', 'c', 'd', null, null, null], 'the tiny cell gets no label');
    const padded = cellsOf(apply('treemap', rows, { field: 'v', group: 'g', padding: 0.02 }));
    for (let a = 0; a < padded.length; a++) for (let b = a + 1; b < padded.length; b++) assert(!overlap(padded[a], padded[b]));
    assert(
      padded.every((c) => c.x1 > c.x0 && c.y1 > c.y0),
      'padding never turns a cell inside out',
    );
    assert.strictEqual(cellsOf(apply('treemap', [{ v: 0 }], { field: 'v' })).length, 0, 'nothing to lay out');
  });

  test('transform.treemap in a chart: rects on unit scales, labels at the corners', () => {
    BC.data('tree', [
      { n: 'Alpha', v: 50 },
      { n: 'Beta', v: 30 },
      { n: 'Gamma', v: 20 },
    ]);
    const { svg, h } = draw({
      data: 'tree',
      size: [640, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'treemap', field: 'v', name: 'n', aspect: 1.6 }],
      scales: { x: { type: 'linear', domain: [0, 1] }, y: { type: 'linear', domain: [0, 1] } },
      marks: [
        { type: 'rect', x: 'x0', x2: 'x1', y: 'y1', y2: 'y0' },
        { type: 'text', x: 'x0', y: 'y1', text: 'label', anchor: 'start', baseline: 'hanging', dx: 6, dy: 6 },
      ],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const cells = rects(layer(svg, 'marks'));
    const area = cells.reduce((a, r) => a + r.w * r.h, 0);
    assert(area > 640 * 400 * 0.97, 'the cells fill the plot: ' + area);
    assert.deepStrictEqual(texts(layer(svg, 'marks')), ['Alpha', 'Beta', 'Gamma']);
  });

  // ───────────────────────── mark.rule, bar thickness ─────────────────────────

  test('mark.rule: a constant is a value on the scale, drawn once across the plot, with its label', () => {
    const { svg, h } = draw(
      monthly({
        scales: { x: { type: 'time' }, y: { type: 'linear', domain: [0, 200] } },
        marks: [
          { type: 'line', x: 'm', y: 'rev' },
          { type: 'rule', y: { value: 150 }, dash: [4, 4], label: 'Target' },
        ],
      }),
    );
    assert.deepStrictEqual(h.diagnostics, []);
    const rules = paths(layer(svg, 'marks')).filter((p) => /stroke-dasharray="4 4"/.test(p.attrs));
    assert.strictEqual(rules.length, 1, 'four rows, one line');
    const m = /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(rules[0].d).slice(1).map(Number);
    assert(near(m[1], m[3]) && m[2] - m[0] > 500, 'horizontal, across the plot');
    assert(texts(svg).includes('Target'));
    // 150 on a 0..200 axis sits a quarter of the way down the plot
    const plotTop = 16;
    const plotBottom = 400 - 16;
    assert(near(m[1], plotBottom - (plotBottom - plotTop) * 0.75, 0.05), 'at 150 of 0..200: ' + m[1]);
  });

  test('mark.rule on a band: a tick across each bar (bullet chart); nothing to draw is nothing drawn', () => {
    BC.data('bullet', [
      { k: 'A', v: 70, t: 80 },
      { k: 'B', v: 90, t: 85 },
    ]);
    const spec = {
      data: 'bullet',
      scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } },
      marks: [
        { type: 'rect', x: 'v', y: 'k', thickness: 0.4 },
        { type: 'rule', x: 't', y: 'k', thickness: 0.8, stroke: '#111' },
      ],
    };
    const { svg } = draw(spec);
    const bars = rects(layer(svg, 'marks'));
    const ticks = paths(layer(svg, 'marks'))
      .filter((p) => /stroke="#111"/.test(p.attrs))
      .map((p) => /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(p.d).slice(1).map(Number));
    assert.strictEqual(ticks.length, 2);
    for (let i = 0; i < 2; i++) {
      const b = bars[i];
      const t = ticks[i];
      assert(near(t[0], t[2]), 'vertical');
      const tickLen = Math.abs(t[3] - t[1]);
      assert(near(tickLen, b.h * 2, 0.05), 'the tick spans 0.8 of the band, the bar 0.4');
      assert(near((t[1] + t[3]) / 2, b.y + b.h / 2, 0.05), 'both centered in the band');
    }
    assert.strictEqual(
      paths(layer(draw({ ...spec, marks: [{ type: 'rule', stroke: '#111' }] }).svg, 'marks')).length,
      0,
      'no x and no y: nothing',
    );
    assert.strictEqual(
      paths(
        layer(
          draw({
            data: 'months',
            scales: { x: { type: 'linear' }, y: { type: 'linear' } },
            marks: [{ type: 'rule', x: 'rev', y: 'cost', stroke: '#111' }],
          }).svg,
          'marks',
        ),
      ).length,
      0,
      'a point is not a line',
    );
  });

  test('mark.rect thickness: a slim bar, centered in its band', () => {
    const full = rects(
      layer(
        draw({
          data: 'bullet',
          scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
          marks: [{ type: 'rect', x: 'k', y: 'v' }],
        }).svg,
        'marks',
      ),
    );
    const slim = rects(
      layer(
        draw({
          data: 'bullet',
          scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
          marks: [{ type: 'rect', x: 'k', y: 'v', thickness: 0.5 }],
        }).svg,
        'marks',
      ),
    );
    assert(near(slim[0].w, full[0].w / 2, 0.02));
    assert(near(slim[0].x + slim[0].w / 2, full[0].x + full[0].w / 2, 0.02));
    const clamp = rects(
      layer(
        draw({
          data: 'bullet',
          scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
          marks: [{ type: 'rect', x: 'k', y: 'v', thickness: 7 }],
        }).svg,
        'marks',
      ),
    );
    assert(near(clamp[0].w, full[0].w, 0.02), 'more than the band is the band');
  });

  // ───────────────────────── wrapping legends and labels, areas to the bottom ─────────────────────────

  test('guide.legend: a row wider than the plot wraps onto more lines, and takes the room it needs', () => {
    BC.data(
      'many',
      ['Organic search', 'Paid search', 'Referral partners', 'Email campaigns', 'Social media', 'Direct'].map((c, i) => ({ c, v: i + 1 })),
    );
    const spec = (w) => ({
      data: 'many',
      size: [w, 300],
      scales: { color: { type: 'color' } },
      guides: [{ type: 'legend', scale: 'color', position: 'bottom' }],
      marks: [{ type: 'arc', value: 'v', color: 'c' }],
    });
    const itemsOf = (svg) =>
      [...svg.matchAll(/<g class="bc-legend-item"[^>]*><rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    const narrow = itemsOf(draw(spec(280)).svg);
    const wide = itemsOf(draw(spec(900)).svg);
    assert.strictEqual(narrow.length, 6);
    assert.strictEqual(new Set(wide.map((i) => i.y)).size, 1, 'on a wide chart: one row');
    assert(new Set(narrow.map((i) => i.y)).size >= 2, 'on a narrow one: several');
    assert(
      narrow.every((i) => i.x < 280),
      'nothing runs off the chart',
    );
    const radius = (svg) => {
      const d = paths(layer(svg, 'marks'))[0].d;
      return Math.max(...[...d.matchAll(/A([\d.]+)/g)].map((m) => +m[1]));
    };
    assert(radius(draw(spec(280)).svg) < radius(draw({ ...spec(280), guides: [] }).svg), 'the wrapped legend takes its room from the plot');
  });

  test('guide.legend: a row legend measured before other guides take their room still fits in what it measured', () => {
    // the bottom legend measures itself first; the titled axis and the column legend on the right then narrow the plot.
    // Packed by the plot, render wrapped into more lines than measure had counted, and the last fell off the chart.
    const spec = (w) => ({
      data: 'many',
      size: [w, 300],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
      guides: [
        { type: 'legend', scale: 'color', position: 'bottom' },
        { type: 'axis', scale: 'y', title: 'Visits, thousands' },
        { type: 'legend', scale: 'color', position: 'right' },
      ],
      marks: [{ type: 'rect', x: 'c', y: 'v', color: 'c' }],
    });
    for (const w of [300, 360, 420, 520]) {
      const { svg, h } = draw(spec(w));
      assert.deepStrictEqual(h.diagnostics, []);
      const all = [...svg.matchAll(/<g class="bc-legend-item"[^>]*><rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
      const row = all.slice(0, 6); // the bottom legend is drawn first
      assert(
        row.every((i) => i.y + 10 <= 300),
        `${w}: every line of the row is inside the chart: ${JSON.stringify(row)}`,
      );
      assert(
        row.every((i) => i.x >= 0 && i.x < w),
        `${w}: and nothing runs off the side`,
      );
    }
  });

  test('mark.area toBottom: fills to the bottom of the plot when the axis does not start at 0', () => {
    const { svg } = draw(
      monthly({
        size: [300, 150],
        scales: { x: { type: 'time' }, y: { type: 'linear' } },
        marks: [{ type: 'area', x: 'm', y: 'rev', toBottom: true }],
      }),
    );
    const ys = [...paths(layer(svg, 'marks'))[0].d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2]);
    assert.strictEqual(Math.max(...ys), 150 - 16, 'down to the plot bottom, not to 0 far below it');
    assert(!/NaN/.test(svg));
    const zeroBased = draw(
      monthly({ size: [300, 150], scales: { x: { type: 'time' }, y: { type: 'linear' } }, marks: [{ type: 'area', x: 'm', y: 'rev' }] }),
    );
    const ys0 = [...paths(layer(zeroBased.svg, 'marks'))[0].d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2]);
    assert(Math.max(...ys0) > 150, 'without it the area goes down to 0, below the plot (why toBottom exists)');
  });

  test('band axis: every category label that fits is shown, a long one wraps onto two lines, many are still thinned', () => {
    BC.data(
      'items',
      ['Revenue', 'Cost of sales', 'Gross profit', 'Marketing', 'Salaries', 'Other income', 'Operating profit'].map((k, i) => ({
        k,
        v: i + 1,
      })),
    );
    const axisTexts = (svg) => [...layer(svg, 'axes').matchAll(/<text [^>]*class="bc-axis-label">([^<]*)<\/text>/g)].map((m) => m[1]);
    const bars = (data, w) => ({
      data,
      size: [w, 300],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      guides: [{ type: 'axis', scale: 'x' }],
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
    });
    // 440 px: the old one-label-per-80-px rule would thin these; measured, all seven fit
    const labels = axisTexts(draw(bars('items', 440)).svg);
    for (const word of ['Revenue', 'Marketing', 'Salaries']) assert(labels.includes(word), word + ' is shown: ' + labels.join('|'));
    assert(
      labels.includes('Gross') && labels.includes('profit') && labels.includes('Operating'),
      'long labels are split at a space: ' + labels.join('|'),
    );
    assert(
      labels.every((l) =>
        [
          'Revenue',
          'Cost of',
          'sales',
          'Cost',
          'of sales',
          'Gross',
          'profit',
          'Marketing',
          'Salaries',
          'Other',
          'income',
          'Operating',
        ].includes(l),
      ),
      'only whole words: ' + labels.join('|'),
    );
    BC.data('longword', [
      { k: 'Supercalifragilistic', v: 1 },
      { k: 'B', v: 2 },
    ]);
    assert(axisTexts(draw(bars('longword', 200)).svg).includes('Supercalifragilistic'), 'one word is not broken');
    BC.data(
      'sixty',
      Array.from({ length: 60 }, (_, i) => ({ k: 'Item ' + i, v: i })),
    );
    const sixty = axisTexts(draw(bars('sixty', 640)).svg);
    assert(sixty.length < 60 && sixty.length > 5, 'sixty categories on 640 px are thinned: ' + sixty.length);
  });

  test('band axis: on a narrow chart text categories all go at an angle, dates and numbers are thinned', () => {
    const cats = ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Opera', 'Everything else entirely'];
    BC.data(
      'slant',
      cats.map((k, i) => ({ k, v: i + 1 })),
    );
    const spec = (data, w) => ({
      data,
      size: [w, 300],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      guides: [
        { type: 'axis', scale: 'y' },
        { type: 'axis', scale: 'x' },
      ],
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
    });
    const labels = (svg) => [...layer(svg, 'axes').matchAll(/<text ([^>]*)class="bc-axis-label"[^>]*>([^<]*)<\/text>/g)];
    const narrow = labels(draw(spec('slant', 220)).svg).filter((m) => /rotate/.test(m[1]));
    assert.strictEqual(narrow.length, 7, 'all seven are there, at an angle: ' + narrow.map((m) => m[2]).join('|'));
    assert(
      narrow.every((m) => m[2].length <= 20),
      'a long one is cut, it would eat the plot',
    );
    const wide = labels(draw(spec('slant', 900)).svg);
    assert(
      wide.every((m) => !/rotate/.test(m[1])),
      'with room nothing is turned',
    );
    assert.deepStrictEqual(draw(spec('slant', 220)).h.diagnostics, []);

    BC.data(
      'ordered',
      Array.from({ length: 6 }, (_, i) => ({ k: '2024-' + String(i + 1).padStart(2, '0') + '-01', v: i })),
    );
    const months = labels(draw(spec('ordered', 220)).svg).filter((m) => m[2].startsWith('2024'));
    assert(months.length > 1 && months.length < 6, 'months that do not fit are thinned: ' + months.length);
    assert(
      months.every((m) => !/rotate/.test(m[1])),
      'a sequence is not turned',
    );
  });

  test('a constant on a position is in the units of its scale, on every mark', () => {
    BC.data('cst', [
      { k: 'a', v: 1 },
      { k: 'b', v: 3 },
    ]);
    const base = (mark, y = { type: 'linear', domain: [0, 4] }) => ({
      data: 'cst',
      size: [400, 200],
      padding: 0,
      scales: { x: { type: 'linear', domain: [0, 10] }, y },
      guides: [],
      marks: [mark],
    });
    const { svg, h } = draw(base({ type: 'text', x: { value: 5 }, y: { value: 2 }, text: 'k' }));
    assert.deepStrictEqual(h.diagnostics, []);
    const m = /<text [^>]*x="([\d.]+)" y="([\d.]+)"/.exec(layer(svg, 'marks'));
    assert(near(+m[1], 200, 1) && near(+m[2], 100, 1), 'in the middle of the plot, not at 5 px: ' + m.slice(1));

    // the scale makes room for it, on a domain of its own
    const inferred = draw(base({ type: 'rule', y: { value: 100 } }, { type: 'linear' }));
    assert.deepStrictEqual(inferred.h.diagnostics, []);
    assert.strictEqual(paths(layer(inferred.svg, 'marks')).length, 1, 'drawn, at the top of a domain that reaches it');
    // a color and a size stay what they are
    const dot = draw(base({ type: 'point', x: 'v', y: 'v', color: { value: '#f00000' } }));
    assert.deepStrictEqual(dot.h.diagnostics, []);
    assert(/#f00000/.test(layer(dot.svg, 'marks')), 'a color stays a color, with no scale');

    const outside = draw(base({ type: 'text', x: { value: 50 }, y: 'v', text: 'k' }));
    assert(
      outside.h.diagnostics.some((d) => d.level === 'warn' && /outside scale "x"/.test(d.message)),
      'a value past a domain given by hand is reported',
    );
    const nocat = draw({
      ...base({ type: 'rule', x: { value: 'nope' } }),
      scales: { x: { type: 'band', domain: ['a', 'b'] }, y: { type: 'linear', domain: [0, 4] } },
    });
    assert(
      nocat.h.diagnostics.some((d) => /outside scale "x"/.test(d.message)),
      'so is a category that is not there',
    );
    const noscale = BC.validate({
      data: 'cst',
      scales: { y: { type: 'linear' } },
      marks: [{ type: 'text', x: { value: 5 }, y: 'v', text: 'k' }],
    });
    assert(
      noscale.some((d) => d.level === 'error' && /scale "x" is not declared/.test(d.message)),
      'no scale to be a value of: an error',
    );
  });

  test('guide.kpi: deltaFormat writes the change in its own unit, with one sign', () => {
    const kpi = (extra) =>
      kpiTexts(
        draw(
          monthly({
            guides: [{ type: 'kpi', field: 'rev', compare: 'first', format: { suffix: '%' }, ...extra }],
          }),
        ).svg,
      );
    assert.strictEqual(kpi({ delta: 'absolute' }).delta.text, '▲ +60%', 'the old way reads as a percentage');
    assert.strictEqual(kpi({ delta: 'absolute', deltaFormat: { suffix: ' pp' } }).delta.text, '▲ +60 pp');
    assert.strictEqual(
      kpi({ delta: 'absolute', deltaFormat: { signDisplay: 'exceptZero', suffix: ' pp' } }).delta.text,
      '▲ +60 pp',
      'a format that signs is not signed twice',
    );
    assert.strictEqual(
      kpi({ deltaFormat: { style: 'percent', maximumFractionDigits: 0 } }).delta.text,
      '▲ +60%',
      'with delta "percent" too',
    );
    BC.data('falling', [{ v: 5 }, { v: 3 }]);
    const down = kpiTexts(
      draw({ data: 'falling', marks: [], guides: [{ type: 'kpi', field: 'v', delta: 'absolute', deltaFormat: { suffix: ' pp' } }] }).svg,
    );
    assert.strictEqual(down.delta.text, '▼ -2 pp', 'a fall keeps its own minus');
  });

  // ───────────────────────── text in Chinese, Japanese and Korean ─────────────────────────

  test('Chinese, Japanese and Korean are measured a full em wide, so space is reserved for them', () => {
    const left = (k) => {
      BC.data('cjk', [{ k, v: 1 }]);
      const { svg } = draw({
        data: 'cjk',
        size: [560, 200],
        scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } },
        guides: [{ type: 'axis', scale: 'y' }],
        marks: [{ type: 'rect', x: 'v', y: 'k' }],
      });
      return +/<rect [^>]*x="([\d.]+)"/.exec(layer(svg, 'marks'))[1];
    };
    assert(left('액화석유가스액화석유가스') >= 12 * 11, 'twelve characters at 11 px: ' + left('액화석유가스액화석유가스'));
    assert(left('LLLLLLLLLLLL') < 12 * 11, 'Latin stays narrower');
    for (const k of ['石油', '石油製品', 'ガソリン', '휘발유', 'ＡＢ']) assert(left(k) >= k.length * 11, k);
  });

  test('a band label without spaces breaks between characters; if that is not enough it goes at an angle', () => {
    const cats = ['直営サービスステーション', '煤油与航空煤油', '運輸物流事業者向け', '公共発電事業者向け'];
    BC.data(
      'nospace',
      cats.map((k, i) => ({ k, v: i + 1 })),
    );
    const spec = (w) => ({
      data: 'nospace',
      size: [w, 300],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      guides: [{ type: 'axis', scale: 'x' }],
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
    });
    const axis = (w) => [...layer(draw(spec(w)).svg, 'axes').matchAll(/<text ([^>]*)class="bc-axis-label"[^>]*>([^<]*)<\/text>/g)];
    const two = axis(460);
    assert(
      two.every((m) => !/rotate/.test(m[1])),
      'upright',
    );
    assert.strictEqual(two.map((m) => m[2]).join(''), cats.join(''), 'all of it, on two lines: ' + two.map((m) => m[2]));
    assert(two.length > cats.length, 'broken');
    const narrow = axis(200);
    assert.strictEqual(narrow.length, cats.length, 'one label each');
    assert(
      narrow.every((m) => /rotate/.test(m[1])),
      'at an angle',
    );
  });

  test('band axis: labels too close for 45° stand upright, and stay apart', () => {
    BC.data(
      'fifteen',
      Array.from({ length: 15 }, (_, i) => ({ k: '사우디아라비아' + i, v: i + 1 })),
    );
    const { svg } = draw({
      data: 'fifteen',
      size: [300, 300],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      guides: [{ type: 'axis', scale: 'x' }],
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
    });
    const labels = [...layer(svg, 'axes').matchAll(/<text ([^>]*)class="bc-axis-label"/g)];
    assert.strictEqual(labels.length, 15);
    assert(
      labels.every((m) => /rotate\(-90/.test(m[1])),
      labels[0][1],
    );
  });

  test('band axis: room taken by a legend counts, so categories are not dropped on a phone', () => {
    const cats = ['Chrome', 'Safari', 'Firefox', 'Samsung', 'Opera', 'Everything'];
    BC.data(
      'heatlike',
      cats.map((k, i) => ({ k, r: 'a', v: i })),
    );
    const { svg } = draw({
      data: 'heatlike',
      // the labels would fit the plot as it is before the legend takes its room, and do not fit what is left
      size: [440, 200],
      scales: { x: { type: 'band' }, y: { type: 'band' }, color: { type: 'sequential' } },
      guides: [
        { type: 'axis', scale: 'x' },
        { type: 'axis', scale: 'y' },
        { type: 'legend', scale: 'color' },
      ],
      marks: [{ type: 'rect', x: 'k', y: 'r', color: 'v' }],
    });
    const labels = [...layer(svg, 'axes').matchAll(/class="bc-axis-label"[^>]*>([^<]*)</g)].map((m) => m[1]);
    for (const c of cats) assert(labels.includes(c), c + ' is on the axis: ' + labels);
  });

  test('date ticks: a label is never repeated, and labels wider than the space between them are thinned', () => {
    BC.data(
      'years',
      Array.from({ length: 120 }, (_, i) => ({ d: new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10), v: i })),
    );
    const axis = (w, format, view) => {
      const { svg } = draw({
        data: 'years',
        size: [w, 200],
        view,
        scales: { x: { type: 'time' }, y: { type: 'linear' } },
        guides: [{ type: 'axis', scale: 'x', format }],
        marks: [{ type: 'line', x: 'd', y: 'v' }],
      });
      return [...layer(svg, 'axes').matchAll(/<text [^>]*x="([\d.]+)"[^>]*class="bc-axis-label"[^>]*>([^<]*)</g)].map((m) => ({
        x: +m[1],
        t: m[2],
      }));
    };
    const zoomed = axis(800, { year: 'numeric', locale: 'ja-JP' }, { x: ['2020-01-01', '2021-06-01'] });
    assert.strictEqual(new Set(zoomed.map((l) => l.t)).size, zoomed.length, 'no year twice: ' + zoomed.map((l) => l.t));
    const crowded = axis(300, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', locale: 'ko-KR' });
    assert(crowded.length >= 1, 'at least one stays');
    for (let i = 1; i < crowded.length; i++) {
      const room = crowded[i].x - crowded[i - 1].x;
      assert(room >= crowded[i].t.length * 9, 'labels stay apart: ' + JSON.stringify(crowded));
    }
  });

  test('a vertical axis title in these scripts stands upright, one character under the other; mixed text turns as before', () => {
    const axisTitle = (title) => {
      const { svg } = draw(monthly({ guides: [{ type: 'axis', scale: 'y', title }] }));
      return [...layer(svg, 'axes').matchAll(/<text ([^>]*)class="bc-axis-title"[^>]*>([^<]*)</g)];
    };
    const upright = axisTitle('販売数量');
    assert.deepStrictEqual(
      upright.map((m) => m[2]),
      ['販', '売', '数', '量'],
    );
    assert(upright.every((m) => !/rotate/.test(m[1])));
    const ys = upright.map((m) => +/ y="([\d.]+)"/.exec(m[1])[1]);
    assert(
      ys.every((y, i) => !i || y > ys[i - 1]),
      'downwards',
    );
    const mixed = axisTitle('Volume, 千kL');
    assert.strictEqual(mixed.length, 1);
    assert(/rotate/.test(mixed[0][1]));
  });

  test('mark.rule: x to x2 on a band runs along the middle of the band, straight', () => {
    BC.data('range', [{ k: 'a', lo: 1, hi: 3 }]);
    const { svg } = draw({
      data: 'range',
      size: [400, 200],
      scales: { y: { type: 'band' }, x: { type: 'linear', domain: [0, 4] } },
      guides: [],
      marks: [{ type: 'rule', x: 'lo', x2: 'hi', y: 'k' }],
    });
    const m = /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/
      .exec(paths(layer(svg, 'marks'))[0].d)
      .slice(1)
      .map(Number);
    assert.strictEqual(m[1], m[3], 'level: ' + m);
    assert(near(m[1], 100, 25), 'in the middle of the band: ' + m);
  });

  test('mark.rect: with no band, bars stand at their positions, a step wide, and do not reach back to 1970', () => {
    const { svg, h } = draw({
      ...monthly({}),
      size: [640, 300],
      scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } },
      guides: [],
      marks: [{ type: 'rect', x: 'm', y: 'rev' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const rects = [...layer(svg, 'marks').matchAll(/<rect [^>]*>/g)].map((m) => ({
      x: +/ x="([\d.-]+)"/.exec(m[0])[1],
      w: +/ width="([\d.-]+)"/.exec(m[0])[1],
    }));
    assert(rects.length >= 3);
    assert(
      rects.every((r) => r.w > 20 && r.w < 300),
      'as wide as a step: ' + JSON.stringify(rects),
    );
    for (let i = 1; i < rects.length; i++)
      assert(rects[i].x >= rects[i - 1].x + rects[i - 1].w - 1e-6, 'side by side, not over each other');

    BC.data('lone', [{ m: '2024-01-01', v: 1 }]);
    const lone = draw({
      data: 'lone',
      size: [640, 300],
      scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } },
      guides: [],
      marks: [{ type: 'rect', x: 'm', y: 'v' }],
    });
    assert.strictEqual(/ width="([\d.]+)"/.exec(layer(lone.svg, 'marks'))[1] > 0, true, 'one bar still shows');
  });

  test('mark.text: a label with x2 or y2 and no side to start from sits in the middle of the box', () => {
    BC.data('box', [{ a: 0, b: 10, y: 5, k: 'cell' }]);
    const drawn = (extra) => {
      const { svg } = draw({
        data: 'box',
        size: [400, 200],
        padding: 0,
        scales: { x: { type: 'linear', domain: [0, 10], nice: false }, y: { type: 'linear', domain: [0, 10], nice: false } },
        guides: [],
        marks: [{ type: 'text', text: 'k', ...extra }],
      });
      return /<text [^>]*x="([\d.]+)" y="([\d.]+)"/.exec(layer(svg, 'marks'));
    };
    const m = drawn({ x: 'y', y: 'a', y2: 'b' });
    assert(m, 'it is drawn');
    assert(near(+m[2], 100, 1), 'halfway up: ' + m[2]);
    assert(drawn({ x: 'a', x2: 'b', y: 'y' }), 'the same across');
  });

  test('a line under a crosshair gives its value at any height; without one the pointer has to be near', async () => {
    const hoverFar = async (interaction) => {
      const host = new FakeNode('div');
      BC.chart(host, monthly({ interaction }));
      const d = paths(layer(svgOf(host), 'marks'))[0].d;
      const [x, y] = /L([\d.]+) ([\d.]+)/.exec(d).slice(1).map(Number);
      await hover(host, x, y > 200 ? y - 120 : y + 120);
      return tipOf(host).style.display;
    };
    assert.strictEqual(await hoverFar([{ type: 'tooltip' }, { type: 'crosshair' }]), 'block');
    assert.notStrictEqual(await hoverFar([{ type: 'tooltip' }]), 'block');
  });

  test('a chart speaks its locale: presets, quarters, tooltip date headings, and a format that names its own wins', () => {
    const write = (locale, format, v) => {
      let out;
      const name = 'probe_' + Math.random().toString(36).slice(2);
      BC.define({ role: 'guide', type: name, version: 1, doc: 'test', params: {}, render: () => ((out = BC.formatter(format)(v)), {}) });
      draw(monthly({ locale, guides: [{ type: name }] }));
      return out;
    };
    assert.strictEqual(write(undefined, 'quarter', '2024-04-01'), 'Q2 2024');
    assert.strictEqual(write('ko', 'quarter', '2024-04-01'), '2024년 2분기');
    assert.strictEqual(write('zh-CN', 'quarter', '2024-04-01'), '2024年第2季度');
    assert.strictEqual(write('ja', 'quarter', '2024-04-01'), '2024年第2四半期');
    assert(/年/.test(write('ja', 'month', '2024-04-01')), 'a preset follows the chart');
    assert.strictEqual(write('de', 'integer', 1234567), '1.234.567');
    assert.strictEqual(write('de', { maximumFractionDigits: 0, locale: 'en-US' }, 1234567), '1,234,567');
    assert.strictEqual(write(undefined, 'integer', 1234567), '1,234,567', 'the next chart is not left in the last language');
    assert.throws(() => BC.formatter({ preset: 'quarter', locale: 'ko-KR' }), /"preset" is not known/);
    assert.throws(() => BC.formatter({ maxFractionDigits: 1 }), /"maxFractionDigits" is not known/);
  });

  test('guide.kpi: deltaScale turns a share kept as 0..1 into points', () => {
    BC.data('share', [{ s: 0.2 }, { s: 0.293 }]);
    const k = kpiTexts(
      draw({
        data: 'share',
        marks: [],
        guides: [
          {
            type: 'kpi',
            field: 's',
            format: 'percent',
            delta: 'absolute',
            deltaScale: 100,
            deltaFormat: { maximumFractionDigits: 1, suffix: ' pp' },
          },
        ],
      }).svg,
    );
    assert.strictEqual(k.delta.text, '▲ +9.3 pp');
  });

  test('scale.linear: zero is a floor that padding does not cross, and a twelve-color palette before it repeats', () => {
    const s = BC.get('scale.linear').create(
      { type: 'linear', zero: true, padding: 0.1, nice: false },
      { name: 'y', sources: [[10, 100]], range: [0, 100] },
    );
    assert.deepStrictEqual(s.domain()[0], 0);
    assert(s.domain()[1] > 100);
    BC.data(
      'many',
      Array.from({ length: 13 }, (_, i) => ({ k: 'c' + i, v: 1 })),
    );
    const { svg } = draw({
      data: 'many',
      size: [640, 300],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
      guides: [],
      marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
    });
    const colors = [...layer(svg, 'marks').matchAll(/var\(--bc-c(\d+)/g)].map((m) => m[1]);
    assert.strictEqual(new Set(colors).size, 12);
  });

  test('zoom-controls: titles say what the page wants', () => {
    const host = new FakeNode('div');
    BC.chart(host, monthly({ interaction: [{ type: 'zoom-controls', titles: { reset: '元に戻す', in: '拡大', out: '縮小' } }] }));
    const bar = host.children.find((c) => c.attrs.class === 'bc-zoom-controls');
    assert.deepStrictEqual(
      bar.children.map((b) => b.title),
      ['元に戻す', '縮小', '拡大'],
    );
  });

  // ───────────────────────── the card tooltip ─────────────────────────

  const tipOf = (host) => host.children.find((c) => c.attrs.class === 'bc-tooltip');
  const partOf = (host, cls) => host.children.find((c) => c.attrs.class === cls);
  const hover = async (host, x, y) => {
    host.children[0].fire('pointermove', { clientX: x, clientY: y, buttons: 0 });
    await flush();
  };

  test('interaction.tooltip: a shape that is many rows shows its own card, and a custom content is not asked about it', async () => {
    BC.data('flows', [
      { s: 'A', t: 'B', v: 10 },
      { s: 'B', t: 'C', v: 10 },
    ]);
    const asked = [];
    const host = new FakeNode('div');
    BC.chart(host, {
      data: 'flows',
      size: [600, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'sankey', source: 's', target: 't', value: 'v' }],
      marks: [{ type: 'sankey', source: 's', target: 't', value: 'v', nodeLabels: ['<in>', 'Out'] }],
      interaction: [{ type: 'tooltip', content: (d) => asked.push(d) && undefined }],
    });
    const middle = rects(layer(svgOf(host), 'marks')).find((n) => n.x > 100 && n.x < 400);
    const box = host.children[0].getBoundingClientRect();
    await hover(host, box.left + ((middle.x + 6) * box.width) / 600, box.top + ((middle.y + 20) * box.height) / 400);
    const tip = tipOf(host);
    assert.strictEqual(tip.style.display, 'block');
    const heading = tip.children.find((c) => c.attrs.class === 'bc-tooltip-heading');
    assert.strictEqual(heading.children[heading.children.length - 1].text, 'B');
    assert.strictEqual(heading.attrs['data-bc-field'], undefined);
    assert.deepStrictEqual(
      partOf(tip, 'bc-tooltip-lines').children.map((c) => c.text),
      ['<in>', '10', 'Out', '10'],
    );
    assert.strictEqual(asked.length, 0);
    assert.strictEqual(partOf(host, 'bc-tooltip-highlight').style.display, 'block', 'the node lights up');
  });

  test('a chart speaks its own language on hover, after another chart drew, and the page keeps its own', async () => {
    BC.data('flows', [
      { s: 'A', t: 'B', v: 1000500 },
      { s: 'B', t: 'C', v: 1000500 },
    ]);
    const spec = (locale) => ({
      data: 'flows',
      locale,
      size: [600, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'sankey', source: 's', target: 't', value: 'v' }],
      marks: [{ type: 'sankey', source: 's', target: 't', value: 'v', format: 'integer', nodeLabels: ['In', 'Out'] }],
      interaction: [{ type: 'tooltip' }],
    });
    const german = new FakeNode('div');
    BC.chart(german, spec('de-DE'));
    BC.chart(new FakeNode('div'), spec('en-US'));
    const middle = rects(layer(svgOf(german), 'marks')).find((n) => n.x > 100 && n.x < 400);
    const box = german.children[0].getBoundingClientRect();
    await hover(german, box.left + ((middle.x + 6) * box.width) / 600, box.top + ((middle.y + 20) * box.height) / 400);
    assert.deepStrictEqual(
      partOf(tipOf(german), 'bc-tooltip-lines').children.map((c) => c.text),
      ['In', '1.000.500', 'Out', '1.000.500'],
    );
    assert.strictEqual(BC.formatter('integer')(1000500), '1,000,500', 'a formatter made outside a chart writes the default');
  });

  test("the tooltip writes in its chart's language, its formats and its dates", async () => {
    const host = new FakeNode('div');
    const handle = BC.chart(
      host,
      monthly({
        locale: 'de-DE',
        interaction: [{ type: 'tooltip', fields: ['m', 'rev'], formats: { rev: { minimumFractionDigits: 1 } } }],
      }),
    );
    const d = paths(layer(svgOf(host), 'marks'))[0].d;
    const [x, y] = /L([\d.]+) ([\d.]+)/.exec(d).slice(1).map(Number);
    await hover(host, x, y);
    const tip = tipOf(host);
    const heading = tip.children.find((c) => c.attrs.class === 'bc-tooltip-heading');
    assert.strictEqual(heading.children[heading.children.length - 1].text, '01.02.2024');
    assert.deepStrictEqual(
      partOf(tip, 'bc-tooltip-lines').children.map((c) => c.text),
      ['rev', '130,0'],
    );
    handle.setView('x', ['2024-01-15', '2024-03-15']);
    await flush();
    assert.strictEqual(BC.formatter('integer')(1000500), '1,000,500', 'a chart drawn again leaves the page its own language');
  });

  test('a value repeated on every row of its group is drawn once, and its tooltip says only what the rows share', async () => {
    BC.data('quarters', [
      { q: 'Q1', p: 'Hardware', a: 30, m: 0.21 },
      { q: 'Q1', p: 'Software', a: 20, m: 0.21 },
      { q: 'Q1', p: 'Services', a: 10, m: 0.21 },
      { q: 'Q2', p: 'Hardware', a: 35, m: 0.24 },
      { q: 'Q2', p: 'Software', a: 25, m: 0.24 },
      { q: 'Q2', p: 'Services', a: 15, m: 0.24 },
    ]);
    const stacked = (marks, interaction) => ({
      data: 'quarters',
      size: [600, 400],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [
        { type: 'window', field: 'a', op: 'total', group: 'q', as: 'total' },
        { type: 'stack', field: 'a', by: 'q', group: 'p' },
      ],
      scales: {
        x: { type: 'band' },
        y: { type: 'linear', zero: true },
        y2: { type: 'linear', range: 'height', domain: [0, 0.25] },
        color: { type: 'color' },
      },
      marks: [{ type: 'rect', x: 'q', y: 'a1', y2: 'a0', color: 'p' }, ...marks],
      interaction,
    });
    // the total over each stack: one label and one dot per quarter, not three on one spot
    const once = draw(
      stacked([
        { type: 'text', x: 'q', y: 'total', text: 'total', dy: -6, baseline: 'auto' },
        { type: 'point', x: 'q', y: 'total' },
      ]),
    );
    assert.deepStrictEqual(texts(layer(once.svg, 'marks')), ['60', '75']);
    assert.strictEqual(circlesOf(once.svg).length, 2);
    // dots that let others show through are all drawn: where they pile up is worth seeing
    assert.strictEqual(circlesOf(draw(stacked([{ type: 'point', x: 'q', y: 'total', opacity: 0.5 }])).svg).length, 6);

    // a line of the margin over the stacks: its point at Q1 is the margin of Q1, not one product's row of it
    const card = async (type) => {
      const host = new FakeNode('div');
      const fields = ['p', 'a', 'm'];
      BC.chart(host, stacked([{ type, x: 'q', y: { field: 'm', scale: 'y2' } }], [{ type: 'tooltip', fields }]));
      const svg = svgOf(host);
      const [x, y] =
        type === 'line'
          ? /M([\d.]+) ([\d.]+)/
              .exec(paths(layer(svg, 'marks')).pop().d)
              .slice(1)
              .map(Number)
          : [circlesOf(svg)[0].x, circlesOf(svg)[0].y];
      const box = host.children[0].getBoundingClientRect();
      await hover(host, box.left + (x * box.width) / 600, box.top + (y * box.height) / 400);
      const tip = tipOf(host);
      const heading = tip.children.find((c) => c.attrs.class === 'bc-tooltip-heading');
      return [heading.children[heading.children.length - 1].text, ...partOf(tip, 'bc-tooltip-lines').children.map((c) => c.text)];
    };
    assert.deepStrictEqual(await card('line'), ['Q1', 'm', '0.21']);
    assert.deepStrictEqual(await card('point'), ['Q1', 'm', '0.21']);

    // a beeswarm's equal values are separate dots, each its own row
    BC.data('bees2', [
      { g: 'a', v: 50, who: 'Ann' },
      { g: 'a', v: 50, who: 'Bob' },
    ]);
    const host = new FakeNode('div');
    BC.chart(host, {
      data: 'bees2',
      size: [400, 300],
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      scales: { y: { type: 'band' }, x: { type: 'linear', domain: [0, 100] } },
      marks: [{ type: 'point', x: 'v', y: 'g', r: 6, swarm: true }],
      interaction: [{ type: 'tooltip', fields: ['who'] }],
    });
    const bees = circlesOf(svgOf(host));
    assert.strictEqual(bees.length, 2);
    const box = host.children[0].getBoundingClientRect();
    await hover(host, box.left + (bees[1].x * box.width) / 400, box.top + (bees[1].y * box.height) / 300);
    assert(partOf(tipOf(host), 'bc-tooltip-lines').children.some((c) => c.text === 'Ann' || c.text === 'Bob'));
  });

  test('interaction.tooltip: heading names what heads the card, and a field that is not there is an error', async () => {
    BC.data('headed', [
      { m: '2024-01-01', rev: 1 },
      { m: '2024-02-01', rev: 2 },
      { m: '2024-03-01', rev: 3 },
    ]);
    const heading = async (extra) => {
      const host = new FakeNode('div');
      BC.chart(host, monthly({ data: 'headed', interaction: [{ type: 'tooltip', ...extra }] }));
      const d = paths(layer(svgOf(host), 'marks'))[0].d;
      const [x, y] = /L([\d.]+) ([\d.]+)/.exec(d).slice(1).map(Number);
      await hover(host, x, y);
      return tipOf(host).children.find((c) => c.attrs.class === 'bc-tooltip-heading').attrs['data-bc-field'];
    };
    assert.strictEqual(await heading({}), 'm');
    assert.strictEqual(await heading({ heading: 'rev' }), 'rev');
    const wrong = BC.chart(new FakeNode('div'), monthly({ data: 'headed', interaction: [{ type: 'tooltip', heading: 'nope' }] }));
    assert(
      wrong.diagnostics.some((d) => d.level === 'error' && /nope/.test(d.message)),
      JSON.stringify(wrong.diagnostics),
    );
  });

  test('interaction.tooltip: labels name the fields, without touching data or formats', async () => {
    const warned = [];
    const was = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      const host = new FakeNode('div');
      BC.chart(
        host,
        monthly({
          interaction: [
            {
              type: 'tooltip',
              fields: ['rev', 'cost'],
              formats: { rev: { suffix: ' USD' } },
              labels: { rev: 'Revenue', typo: 'Nothing', cost: 7 },
            },
          ],
        }),
      );
      const d = paths(layer(svgOf(host), 'marks'))[0].d;
      const [x, y] = /L([\d.]+) ([\d.]+)/.exec(d).slice(1).map(Number);
      await hover(host, x, y);
      const lines = partOf(tipOf(host), 'bc-tooltip-lines').children.map((c) => c.text);
      assert.strictEqual(lines[0], 'Revenue');
      assert(/ USD$/.test(lines[1]), 'the format is keyed by the field, as before: ' + lines[1]);
      assert.strictEqual(lines[2], 'cost', 'a label that is not text is dropped');
      assert(
        warned.some((w) => /label of "typo" ignored: no such field/.test(w)),
        'a typo is reported',
      );
      assert(warned.some((w) => /label of "cost" must be text/.test(w)));
    } finally {
      console.warn = was;
    }
  });

  test('interaction.tooltip: the date heads the card, the dot takes the series color, no crosshair of its own', async () => {
    const host = new FakeNode('div');
    BC.chart(host, monthly({ interaction: [{ type: 'tooltip' }] }));
    const d = paths(layer(svgOf(host), 'marks'))[0].d;
    const [x, y] = /L([\d.]+) ([\d.]+)/.exec(d).slice(1).map(Number);
    await hover(host, x, y);
    const tip = tipOf(host);
    assert.strictEqual(tip.style.display, 'block');
    const heading = tip.children.find((c) => c.attrs.class === 'bc-tooltip-heading');
    assert(heading && heading.attrs['data-bc-field'] === 'm', 'the date is the heading');
    assert(
      /^[A-Z][a-z]{2} \d{1,2}, 2024$/.test(heading.children[heading.children.length - 1].text),
      'written as a date, not the ISO string: ' + heading.children[heading.children.length - 1].text,
    );
    assert.strictEqual(partOf(host, 'bc-tooltip-crosshair'), undefined, 'the crosshair is its own block now');
    assert(/--bc-c0/.test(partOf(host, 'bc-tooltip-dot').style.background), 'the dot in the line color');

    const listed = new FakeNode('div');
    BC.chart(listed, monthly({ interaction: [{ type: 'tooltip', fields: ['rev', 'target'] }] }));
    await hover(listed, x, y);
    const listedHead = tipOf(listed).children.find((c) => c.attrs.class === 'bc-tooltip-heading');
    assert(listedHead && listedHead.attrs['data-bc-field'] === 'm', 'the date still heads the card when fields are listed');
    assert.deepStrictEqual(
      tipOf(listed)
        .children.find((c) => c.attrs.class === 'bc-tooltip-lines')
        .children.map((c) => c.text)
        .filter((_, i) => i % 2 === 0),
      ['rev', 'target'],
      'then exactly the listed fields',
    );

    assert(
      BC.validate(monthly({ interaction: [{ type: 'tooltip', crosshair: 'on' }] })).some(
        (d) => d.level === 'warn' && /unknown parameter "crosshair"/.test(d.message),
      ),
      'the old parameter is flagged, not silently used',
    );

    const bars = new FakeNode('div');
    BC.chart(bars, {
      data: 'bullet',
      size: [640, 400],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
      interaction: [{ type: 'tooltip' }],
    });
    const b = rects(layer(svgOf(bars), 'marks'))[0];
    await hover(bars, b.x + b.w / 2, b.y + b.h / 2);
    assert.strictEqual(tipOf(bars).style.display, 'block');
    const lines = tipOf(bars).children.find((c) => c.attrs.class === 'bc-tooltip-lines');
    assert.deepStrictEqual(
      lines.children.map((c) => c.text),
      ['v', '70'],
      'the value line; the category went to the heading',
    );

    // a value from the data is text in the card, never markup
    BC.data('evil', [{ k: '<img src=x onerror=alert(1)>', v: 1 }]);
    const evil = new FakeNode('div');
    BC.chart(evil, {
      data: 'evil',
      size: [640, 400],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
      interaction: [{ type: 'tooltip' }],
    });
    const e = rects(layer(svgOf(evil), 'marks'))[0];
    await hover(evil, e.x + e.w / 2, e.y + e.h / 2);
    const head = tipOf(evil).children.find((c) => c.attrs.class === 'bc-tooltip-heading');
    assert.strictEqual(head.children[head.children.length - 1].text, '<img src=x onerror=alert(1)>', 'set as textContent');
    assert.strictEqual(head.children[head.children.length - 1].children.length, 0, 'no element was created from it');
  });

  // ───────────────────────── crosshair, end labels, animation ─────────────────────────

  test('interaction.crosshair: follows the pointer to the nearest point of a line at any height, hides outside the plot', async () => {
    const host = new FakeNode('div');
    BC.chart(host, monthly({ interaction: [{ type: 'crosshair', horizontal: true }] }));
    const pts = [...paths(layer(svgOf(host), 'marks'))[0].d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    const cross = partOf(host, 'bc-crosshair');
    const h = partOf(host, 'bc-crosshair-h');
    // near the third point in x, but far above the line
    await hover(host, pts[2][0] + 3, 30);
    assert.strictEqual(cross.style.display, 'block');
    assert(near(parseFloat(cross.style.left), pts[2][0], 0.01), 'snapped to the point: ' + cross.style.left);
    assert(near(parseFloat(h.style.top), pts[2][1], 0.01), 'the horizontal line through it');
    assert(near(parseFloat(cross.style.top), 16) && near(parseFloat(cross.style.height), 400 - 32), 'as tall as the plot');
    await hover(host, 5, 5);
    assert.strictEqual(cross.style.display, 'none', 'outside the plot: hidden');
    const free = new FakeNode('div');
    BC.chart(free, monthly({ interaction: [{ type: 'crosshair', snap: 'off' }] }));
    await hover(free, 200, 200);
    assert.strictEqual(partOf(free, 'bc-crosshair').style.left, '200px', 'snap "off" follows the pointer');
    const bars = new FakeNode('div');
    BC.chart(bars, {
      data: 'bullet',
      size: [640, 400],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
      interaction: [{ type: 'crosshair' }],
    });
    await hover(bars, 200, 200);
    assert.strictEqual(partOf(bars, 'bc-crosshair').style.display, 'none', 'no line or area to snap to: nothing');
    const all = new FakeNode('div');
    BC.chart(all, {
      data: 'bullet',
      size: [640, 400],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
      interaction: [{ type: 'crosshair', snap: 'all' }],
    });
    const b = rects(layer(svgOf(all), 'marks'))[0];
    await hover(all, b.x + 2, 200);
    assert(near(parseFloat(partOf(all, 'bc-crosshair').style.left), b.x + b.w / 2, 0.01), 'snap "all": the middle of the bar');
    const hd = new FakeNode('div');
    const handle = BC.chart(hd, monthly({ interaction: [{ type: 'crosshair' }] }));
    handle.destroy();
    assert.strictEqual(hd.children.length, 0, 'destroy removes it');
  });

  test('interaction.crosshair: a touch places the line and it stays after the finger lifts; a mouse press does not move it', async () => {
    const host = new FakeNode('div');
    host.contains = (n) => n === host || n === host.children[0];
    const handle = BC.chart(host, monthly({ interaction: [{ type: 'crosshair' }] }));
    const pts = [...paths(layer(svgOf(host), 'marks'))[0].d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    const cross = partOf(host, 'bc-crosshair');
    const root = host.children[0];
    root.fire('pointerdown', { pointerType: 'touch', buttons: 1, clientX: pts[2][0], clientY: pts[2][1] });
    await flush();
    assert.strictEqual(cross.style.display, 'block', 'a tap places it');
    assert(near(parseFloat(cross.style.left), pts[2][0], 0.01));
    root.fire('pointerleave', { pointerType: 'touch' });
    assert.strictEqual(cross.style.display, 'block', 'it stays after the finger lifts');
    root.fire('pointermove', { pointerType: 'touch', buttons: 1, clientX: pts[3][0], clientY: pts[3][1] });
    await flush();
    assert(near(parseFloat(cross.style.left), pts[3][0], 0.01), 'sliding the finger moves it');
    root.fire('pointerdown', { pointerType: 'mouse', buttons: 1, clientX: pts[1][0], clientY: pts[1][1] });
    await flush();
    assert(near(parseFloat(cross.style.left), pts[3][0], 0.01), 'a mouse press leaves it where it is');
    document.fire('pointerdown', { pointerType: 'touch', target: new FakeNode('div') });
    assert.strictEqual(cross.style.display, 'none', 'a touch elsewhere puts it away');
    root.fire('pointerdown', { pointerType: 'touch', buttons: 1, clientX: pts[2][0], clientY: pts[2][1] });
    await flush();
    root.fire('pointercancel', { pointerType: 'touch' });
    assert.strictEqual(cross.style.display, 'none', 'a scroll cancels it');
    handle.destroy();
  });

  test('mark.line label: names and last values at the line ends, in their colors, pushed apart when they would overlap', () => {
    BC.data('close', [
      { t: '2024-01-01', v: 10, s: 'Alpha' },
      { t: '2024-02-01', v: 20, s: 'Alpha' },
      { t: '2024-01-01', v: 11, s: 'Beta' },
      { t: '2024-02-01', v: 20.3, s: 'Beta' },
      { t: '2024-01-01', v: 5, s: 'Gamma' },
      { t: '2024-02-01', v: null, s: 'Gamma' },
    ]);
    const spec = (label, extra) => ({
      data: 'close',
      size: [640, 400],
      padding: { right: 100 },
      scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'line', x: 't', y: 'v', group: 's', label, ...extra }],
    });
    const labels = (svg) =>
      [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*fill="([^"]+)"[^>]*class="bc-line-label">([^<]*)<\/text>/g)].map((m) => ({
        x: +m[1],
        y: +m[2],
        fill: m[3],
        text: m[4],
      }));
    const both = labels(draw(spec('both', { format: { maximumFractionDigits: 0 } })).svg);
    assert.deepStrictEqual(
      both.map((l) => l.text).sort(),
      ['Alpha  20', 'Beta  20', 'Gamma  5'],
      'name and value; a gap ends a series at its last number',
    );
    const ys = both.map((l) => l.y).sort((a, b) => a - b);
    for (let k = 1; k < ys.length; k++) assert(ys[k] - ys[k - 1] >= 13.9, 'no overlap: ' + ys.join(', '));
    assert(new Set(both.map((l) => l.fill)).size === 3, 'each in its line color');
    assert.deepStrictEqual(
      labels(draw(spec('name')).svg)
        .map((l) => l.text)
        .sort(),
      ['Alpha', 'Beta', 'Gamma'],
    );
    const single = labels(
      draw(
        monthly({
          padding: { right: 90 },
          marks: [
            { type: 'line', x: 'm', y: 'rev', label: 'value', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } },
          ],
        }),
      ).svg,
    );
    assert.deepStrictEqual(
      single.map((l) => l.text),
      ['$160'],
    );
    assert.strictEqual(
      labels(draw(monthly({ marks: [{ type: 'line', x: 'm', y: 'rev', label: 'name', name: 'Revenue' }] })).svg)[0].text,
      'Revenue',
      'one line: the name given',
    );
    assert.strictEqual(labels(draw(spec('none')).svg).length, 0, 'none by default');
    // two line marks ending close together (revenue and plan) are spread together, not each on its own
    BC.data('twin', [
      { t: 1, a: 100, b: 101 },
      { t: 2, a: 200, b: 199 },
    ]);
    const twin = labels(
      draw({
        data: 'twin',
        size: [640, 400],
        padding: { right: 90 },
        scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true } },
        marks: [
          { type: 'line', x: 't', y: 'a', label: 'name', name: 'Revenue' },
          { type: 'line', x: 't', y: 'b', label: 'name', name: 'Plan' },
        ],
      }).svg,
    );
    assert.deepStrictEqual(twin.map((l) => l.text).sort(), ['Plan', 'Revenue'], 'each once');
    assert(Math.abs(twin[0].y - twin[1].y) >= 13.9, 'apart: ' + twin.map((l) => l.y).join(', '));
    BC.data('evilname', [
      { t: 1, v: 1, s: '<b>x</b>' },
      { t: 2, v: 2, s: '<b>x</b>' },
    ]);
    const evil = draw({
      data: 'evilname',
      scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'line', x: 't', y: 'v', group: 's', label: 'name' }],
    }).svg;
    assert(!evil.includes('<b>x</b>'), 'a series name is text');
  });

  test('interaction.animate: once per chart, the effect by the marks, nothing for reduced motion or without the API', () => {
    const calls = [];
    const proto = FakeNode.prototype;
    const saved = { animate: proto.animate, querySelector: proto.querySelector, window: globalThis.window };
    proto.animate = function (frames, timing) {
      calls.push({ node: this, frames, timing });
      return { cancel() {} };
    };
    proto.querySelector = function (sel) {
      const m = /data-bc-layer="(\w+)"/.exec(sel);
      return (this.children || []).find((c) => c.attrs && c.attrs['data-bc-layer'] === (m && m[1])) || null;
    };
    try {
      const run = (spec) => {
        calls.length = 0;
        const host = new FakeNode('div');
        const h = BC.chart(host, spec);
        return { host, h, call: calls[0] };
      };
      const bars = run({
        data: 'bullet',
        size: [640, 400],
        scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
        marks: [{ type: 'rect', x: 'k', y: 'v' }],
        interaction: [{ type: 'animate', duration: 500, delay: 100 }],
      });
      assert(bars.call && bars.call.node.attrs['data-bc-layer'] === 'marks', 'the marks layer is animated, not the axes');
      assert.deepStrictEqual(
        bars.call.frames.map((f) => f.transform),
        ['scaleY(0)', 'none'],
        'bars grow',
      );
      assert.strictEqual(bars.call.node.style.transformOrigin, '0px 384px', 'from the baseline (0 on the y scale)');
      assert.deepStrictEqual([bars.call.timing.duration, bars.call.timing.delay], [500, 100]);
      const line = run(monthly({ interaction: [{ type: 'animate' }] }));
      assert(/^inset\(0 /.test(line.call.frames[0].clipPath), 'lines are drawn from the left');
      const pie = run({
        data: 'bullet',
        scales: { color: { type: 'color' } },
        marks: [{ type: 'arc', value: 'v', color: 'k' }],
        interaction: [{ type: 'animate' }],
      });
      assert(/scale/.test(pie.call.frames[0].transform), 'a pie opens');
      const hbars = run({
        data: 'bullet',
        size: [640, 400],
        scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } },
        marks: [{ type: 'rect', x: 'v', y: 'k' }],
        interaction: [{ type: 'animate' }],
      });
      assert.deepStrictEqual(hbars.call.frames[0].transform, 'scaleX(0)', 'horizontal bars grow sideways');
      // from the 0 of any scale that places numbers, whatever its name
      if (!BC.get('scale.level')) BC.define({ ...BC.get('scale.linear'), type: 'level', version: 1 });
      const signed = run({
        data: 'bullet',
        size: [640, 400],
        scales: { x: { type: 'band' }, y: { type: 'level', domain: [-100, 100] } },
        marks: [{ type: 'rect', x: 'k', y: 'v' }],
        interaction: [{ type: 'animate' }],
      });
      assert.strictEqual(signed.call.node.style.transformOrigin, '0px 200px', 'the 0 in the middle of the plot');

      calls.length = 0;
      bars.h.update(bars.h.spec);
      assert.strictEqual(calls.length, 0, 'a rebuild of the same chart does not play again');

      globalThis.window = { matchMedia: (q) => ({ matches: /reduce/.test(q) }) };
      assert.strictEqual(run(monthly({ interaction: [{ type: 'animate' }] })).call, undefined, 'reduced motion: none');
      globalThis.window = saved.window;

      proto.animate = undefined;
      const plain = run(monthly({ interaction: [{ type: 'animate' }] }));
      assert.deepStrictEqual(plain.h.diagnostics, [], 'no animation API: the chart is simply shown');
    } finally {
      proto.animate = saved.animate;
      proto.querySelector = saved.querySelector;
      globalThis.window = saved.window;
    }
  });

  test('blocks meet through what they declare: a mark or an interaction of another name that declares the same is treated the same', async () => {
    // marks with the code of line, rect and arc under names no block knows, saying what those say or not
    const like = (base, type, own) => {
      if (!BC.get('mark.' + type)) BC.define({ ...BC.get('mark.' + base), type, version: 1, ...own });
    };
    like('line', 'trace');
    like('line', 'stroke', { series: false, enter: undefined });
    like('rect', 'slab');
    like('rect', 'tile', { markColor: false });
    const marked = (type, extra) => monthly({ marks: [{ type, x: 'm', y: 'rev' }], ...extra });
    const firstPoint = (host) =>
      /L([\d.]+) ([\d.]+)/
        .exec(paths(layer(svgOf(host), 'marks'))[0].d)
        .slice(1)
        .map(Number);

    // crosshairs of other names, one reading the chart along x and one not
    if (!BC.get('interaction.ruler')) BC.define({ ...BC.get('interaction.crosshair'), type: 'ruler', version: 1 });
    if (!BC.get('interaction.hairline')) BC.define({ ...BC.get('interaction.crosshair'), type: 'hairline', version: 1, alongX: false });
    // a series: a crosshair snaps to it; along x, the pick of a line answers at any height
    for (const [type, cross, snaps, anyHeight] of [
      ['trace', 'ruler', true, true],
      ['stroke', 'ruler', false, true],
      ['trace', 'hairline', true, false],
    ]) {
      const host = new FakeNode('div');
      BC.chart(host, marked(type, { interaction: [{ type: 'tooltip' }, { type: cross }] }));
      const [x, y] = firstPoint(host);
      await hover(host, x + 3, y > 200 ? y - 120 : y + 120);
      assert.strictEqual(partOf(host, 'bc-crosshair').style.display, snaps ? 'block' : 'none', `${type} + ${cross}: snapped`);
      assert.strictEqual(tipOf(host).style.display === 'block', anyHeight, `${type} + ${cross}: the value far from the line`);
    }

    // the color a tooltip shows next to the heading
    const swatch = async (type) => {
      const host = new FakeNode('div');
      BC.chart(host, {
        data: 'bullet',
        size: [640, 400],
        scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
        marks: [{ type, x: 'k', y: 'v' }],
        interaction: [{ type: 'tooltip' }],
      });
      const b = rects(layer(svgOf(host), 'marks'))[0];
      await hover(host, b.x + b.w / 2, b.y + b.h / 2);
      const head = tipOf(host).children.find((c) => c.attrs.class === 'bc-tooltip-heading');
      return head.children.length > 1;
    };
    assert.strictEqual(await swatch('slab'), true, 'a mark drawn in its own color shows it');
    assert.strictEqual(await swatch('tile'), false, 'markColor: false shows none');

    // the effect of interaction.animate
    const calls = [];
    const proto = FakeNode.prototype;
    const saved = { animate: proto.animate, querySelector: proto.querySelector };
    proto.animate = function (frames) {
      calls.push(frames);
      return { cancel() {} };
    };
    proto.querySelector = function (sel) {
      const m = /data-bc-layer="(\w+)"/.exec(sel);
      return (this.children || []).find((c) => c.attrs && c.attrs['data-bc-layer'] === (m && m[1])) || null;
    };
    try {
      const effect = (spec) => {
        calls.length = 0;
        BC.chart(new FakeNode('div'), { ...spec, interaction: [{ type: 'animate' }] });
        const f = calls[0][0];
        return f.clipPath ? 'wipe' : /scale[XY]\(0\)/.test(f.transform) ? 'grow' : /scale/.test(f.transform) ? 'pop' : 'fade';
      };
      assert.strictEqual(effect(marked('trace')), 'wipe');
      assert.strictEqual(effect(marked('stroke')), 'fade', 'no enter: it fades in');
      const bars = { data: 'bullet', size: [640, 400], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } } };
      assert.strictEqual(effect({ ...bars, marks: [{ type: 'slab', x: 'k', y: 'v' }] }), 'grow');
    } finally {
      proto.animate = saved.animate;
      proto.querySelector = saved.querySelector;
    }

    // a drag an interaction of any name claims is not a pan
    if (!BC.get('interaction.grab'))
      BC.define({
        role: 'interaction',
        type: 'grab',
        version: 1,
        doc: 'test',
        params: {},
        attach: (spec, live) => live.claimDrag((ev) => ev.altKey),
      });
    const host = new FakeNode('div');
    const h = BC.chart(host, monthly({ interaction: [{ type: 'zoom' }, { type: 'grab' }] }));
    const [d0, d1] = h.getView().x.map(Number);
    const view = [d0 + (d1 - d0) * 0.2, d0 + (d1 - d0) * 0.7];
    const panned = async (altKey) => {
      h.setView('x', view);
      await flush();
      host.children[0].fire('pointerdown', { button: 0, clientX: 300, clientY: 150, pointerId: 1, altKey });
      host.children[0].fire('pointermove', { clientX: 200, clientY: 150, buttons: 1, altKey });
      host.children[0].fire('pointerup', { clientX: 200, clientY: 150 });
      await flush();
      return Number(h.getView().x[0]) !== view[0];
    };
    assert.strictEqual(await panned(true), false, 'the claimed drag is left alone');
    assert.strictEqual(await panned(false), true, 'any other drag pans');
  });

  test('the core knows no scale or guide by name: one of another name that declares the same is treated the same', () => {
    BC.data(
      'years',
      Array.from({ length: 30 }, (_, i) => ({ k: String(1990 + i), v: 10 + i })),
    );
    const warned = (spec, what) => BC.chart(new FakeNode('div'), spec).diagnostics.some((d) => what.test(d.message));
    // bands of other names: a constant at a category that is not in the data adds it only where the scale does not say
    // its domain is from fields alone
    if (!BC.get('scale.slots')) BC.define({ ...BC.get('scale.band'), type: 'slots', version: 1 });
    if (!BC.get('scale.bins')) BC.define({ ...BC.get('scale.band'), type: 'bins', version: 1, fieldsOnly: false });
    const ruled = (type) => ({
      data: 'bullet',
      size: [640, 400],
      scales: { x: { type }, y: { type: 'linear', zero: true } },
      marks: [
        { type: 'rect', x: 'k', y: 'v' },
        { type: 'rule', x: { value: 'C' } },
      ],
    });
    assert.deepStrictEqual(BC.chart(new FakeNode('div'), ruled('bins')).diagnostics, []);
    assert.strictEqual(warned(ruled('slots'), /constant C is outside scale "x"/), true, 'fieldsOnly: C is no category');
    assert.strictEqual(warned(ruled('bins'), /constant C/), false, 'otherwise C is one');

    // a number scale of a kind the core has never heard of still has a place along the height for a constant to miss
    if (!BC.get('scale.pow')) {
      const linear = BC.get('scale.linear');
      BC.define({
        ...linear,
        type: 'pow',
        version: 1,
        create(spec, ctx) {
          const inner = linear.create(spec, ctx);
          const own = Object.getOwnPropertyDescriptors(inner);
          for (const k of ['length', 'name', 'prototype']) delete own[k];
          return Object.defineProperties((v) => inner(v), own);
        },
      });
    }
    const target = {
      data: 'bullet',
      size: [640, 400],
      scales: { x: { type: 'band' }, y: { type: 'pow', domain: [0, 100] } },
      marks: [
        { type: 'rect', x: 'k', y: 'v' },
        { type: 'rule', y: { value: 500 } },
      ],
    };
    assert.strictEqual(warned(target, /constant 500 is outside scale "y"/), true, 'a constant off a positional scale of any kind');

    // a legend of another name takes the places it declares, "auto" among them
    if (!BC.get('guide.key')) BC.define({ ...BC.get('guide.legend'), type: 'key', version: 1 });
    const keyed = (position) => ({
      ...ruled('band'),
      marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
      guides: [{ type: 'key', scale: 'color', position }],
    });
    assert.strictEqual(warned(keyed('auto'), /position must be/), false, 'auto, as the key declares');
    assert.strictEqual(warned(keyed('middle'), /position must be one of: top, right, bottom, left, auto/), true);

    // how many categories show is what the guides that write them say fits
    if (!BC.get('guide.roomy')) BC.define({ ...BC.get('guide.axis'), type: 'roomy', version: 1, fits: () => 1000 });
    const labels = (type) => {
      const host = new FakeNode('div');
      BC.chart(host, {
        data: 'years',
        size: [320, 200],
        scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
        marks: [{ type: 'rect', x: 'k', y: 'v' }],
        guides: [{ type, scale: 'x' }],
      });
      return texts(layer(svgOf(host), 'axes')).length;
    };
    assert(labels('axis') < 30, `the axis thins thirty years on a phone: ${labels('axis')}`);
    assert.strictEqual(labels('roomy'), 30, 'a guide that says all thirty fit gets all thirty');
  });

  // ───────────────────────── responsive layout ─────────────────────────

  test('responsive: a container narrower than the size lays the chart out at its width, again when it changes, keeping the zoom', async () => {
    const observers = [];
    const savedRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb;
        this.on = true;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.on = false;
      }
    };
    const wait = () => new Promise((r) => setTimeout(r, 40));
    const box = (host) => /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgOf(host)).slice(1).map(Number);
    try {
      const spec = monthly({ size: [640, 300], guides: [{ type: 'axis', scale: 'x' }], interaction: [{ type: 'zoom' }] });
      const host = new FakeNode('div');
      host.clientWidth = 320;
      const h = BC.chart(host, spec);
      assert.deepStrictEqual(box(host), [320, 300], 'laid out at the phone width, not scaled down');
      assert.deepStrictEqual(h.spec.size, [640, 300], 'the spec itself is left as it was');

      h.setView('x', ['2024-02-01', '2024-03-01']);
      await wait();
      const zoomed = h.getView().x.map(Number);
      host.clientWidth = 500;
      observers[observers.length - 1].cb();
      await wait();
      assert.deepStrictEqual(box(host), [500, 300], 'relaid out at the new width');
      assert.deepStrictEqual(h.getView().x.map(Number), zoomed, 'the zoom survives');

      host.clientWidth = 1200;
      observers[observers.length - 1].cb();
      await wait();
      assert.deepStrictEqual(box(host), [640, 300], 'wider than the size: the drawing scales up as before');

      const drawn = svgOf(host);
      observers[observers.length - 1].cb();
      await wait();
      assert.strictEqual(svgOf(host), drawn, 'a resize that does not change the width does not rebuild');

      h.destroy();
      assert.strictEqual(observers[observers.length - 1].on, false, 'destroy stops watching');

      const fixed = new FakeNode('div');
      fixed.clientWidth = 320;
      BC.chart(fixed, { ...spec, responsive: false });
      assert.deepStrictEqual(box(fixed), [640, 300], 'responsive: false keeps the size');

      const tiny = new FakeNode('div');
      tiny.clientWidth = 90;
      BC.chart(tiny, spec);
      assert.deepStrictEqual(box(tiny), [200, 300], 'never laid out narrower than 200 px');

      const unknown = new FakeNode('div');
      BC.chart(unknown, spec);
      assert.deepStrictEqual(box(unknown), [640, 300], 'no width known (a server, a test): the size');
    } finally {
      globalThis.ResizeObserver = savedRO;
    }
  });
};
