// Tests for the business blocks (guide.kpi, transform.waterfall / funnel / treemap, mark.rule, bar thickness) and for the
// dashboard look (quiet axes, smooth curves, fading areas, the card tooltip). Loaded by test.js.
const assert = require('assert');

module.exports = function ({ test, FakeNode, svgOf, count, flush }) {
  const paths = (svg) => [...svg.matchAll(/<path d="([^"]+)"([^>]*)>/g)].map((m) => ({ d: m[1], attrs: m[2] }));
  const rects = (svg) => [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  const texts = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const layer = (svg, name) => { const i = svg.indexOf(`data-bc-layer="${name}"`); return svg.slice(i, svg.indexOf('</g>', i)); };
  const draw = (spec) => { const host = new FakeNode('div'); const h = BC.chart(host, spec); return { host, h, svg: svgOf(host) }; };
  const apply = (type, rows, spec) => {
    const cols = {};
    for (const k of Object.keys(rows[0] || {})) cols[k] = rows.map((r) => r[k]);
    return BC.get(`transform.${type}`).apply({ length: rows.length, columns: cols }, { type, ...spec });
  };
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  BC.data('months', [
    { m: '2024-01-01', rev: 100, cost: 60, target: 120 }, { m: '2024-02-01', rev: 130, cost: 70, target: 120 },
    { m: '2024-03-01', rev: 90, cost: 65, target: 120 }, { m: '2024-04-01', rev: 160, cost: 80, target: 120 },
  ]);
  const monthly = (extra) => ({
    data: 'months',
    scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } },
    marks: [{ type: 'line', x: 'm', y: 'rev' }],
    ...extra,
  });

  // ───────────────────────── the quiet axis ─────────────────────────

  test('guide.axis: by default no tick marks, a line along a horizontal axis only; ticks and line can be asked for', () => {
    const quiet = draw(monthly({ guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }] }));
    const axisPaths = paths(layer(quiet.svg, 'axes')).filter((p) => /class="bc-axis"/.test(p.attrs));
    assert.strictEqual(axisPaths.length, 1, 'one axis line: the bottom one');
    assert(/^M[\d.]+ [\d.]+H[\d.]+$/.test(axisPaths[0].d), 'a plain horizontal baseline, no tick marks: ' + axisPaths[0].d);
    assert(count(quiet.svg, /class="bc-axis-label"/g) > 4, 'labels are there, with a class to style them');
    assert(/fill="var\(--bc-label, var\(--bc-text, #444\)\)"/.test(quiet.svg), 'labels in the quieter label color');

    const classic = draw(monthly({ guides: [{ type: 'axis', scale: 'x', ticks: true }, { type: 'axis', scale: 'y', ticks: true, line: 'on' }] }));
    const lines = paths(layer(classic.svg, 'axes')).filter((p) => /class="bc-axis"/.test(p.attrs));
    assert.strictEqual(lines.length, 2, 'both axes drawn');
    assert(lines.every((p) => (p.d.match(/M/g) || []).length > 3), 'with a tick mark per label');

    const none = draw(monthly({ guides: [{ type: 'axis', scale: 'x', line: 'off' }] }));
    assert.strictEqual(count(none.svg, /class="bc-axis"/g), 0, 'line "off" leaves only the labels');
    assert.deepStrictEqual(BC.validate(monthly({ guides: [{ type: 'axis', scale: 'x', line: 'maybe' }] })).map((d) => d.path), ['guides[0].line']);
  });

  // ───────────────────────── smooth lines, fading areas ─────────────────────────

  test('mark.line curve "smooth": passes through every point and never overshoots between two of them', () => {
    BC.data('zig', [0, 10, 9, 30, 2, 2, 2, 25].map((v, i) => ({ x: i, y: v })));
    const { svg } = draw({ data: 'zig', size: [640, 400], scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'line', x: 'x', y: 'y', curve: 'smooth' }] });
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
    BC.data('holes', [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: null }, { x: 3, y: 2 }, { x: 4, y: 5 }, { x: 5, y: 4 }]);
    const { svg } = draw({ data: 'holes', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'x', y: 'y', curve: 'smooth' }] });
    const d = paths(layer(svg, 'marks'))[0].d;
    assert.strictEqual((d.match(/M/g) || []).length, 2, 'two runs');
    assert(/^M[\d.]+ [\d.]+L/.test(d), 'a run of two points is a straight segment');
    BC.data('samex', [{ x: 1, y: 1 }, { x: 1, y: 5 }, { x: 2, y: 3 }, { x: 3, y: 3 }]);
    const same = draw({ data: 'samex', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'x', y: 'y', curve: 'smooth' }] });
    assert(!/NaN|Infinity/.test(same.svg), 'two rows at the same x do not divide by zero');
  });

  test('mark.area fade: a gradient over the plot, no outline, shared by areas of one color; smooth edges both ways', () => {
    const spec = monthly({ marks: [{ type: 'area', x: 'm', y: 'rev', fade: true, curve: 'smooth', fill: '#3a6fe4' }, { type: 'area', x: 'm', y: 'cost', fade: true, fill: '#3a6fe4' }] });
    const { svg } = draw(spec);
    assert.strictEqual(count(svg, /<linearGradient /g), 1, 'one gradient for one color and opacity');
    assert(/<linearGradient id="bc-fade-\d+" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="[\d.]+" y2="[\d.]+">/.test(svg));
    assert(/stop-color:#3a6fe4;stop-opacity:0.45/.test(svg) && /stop-color:#3a6fe4;stop-opacity:0/.test(svg), 'from the color at 0.45 to transparent');
    const areas = paths(layer(svg, 'marks'));
    assert(areas.every((p) => /fill="url\(#bc-fade-\d+\)"/.test(p.attrs) && !/stroke=/.test(p.attrs) && !/fill-opacity/.test(p.attrs)), 'filled by the gradient, no outline');
    assert(/C/.test(areas[0].d) && /Z$/.test(areas[0].d), 'the smooth area is a closed curve');

    const plain = draw(monthly({ marks: [{ type: 'area', x: 'm', y: 'rev' }] }));
    assert(!/linearGradient/.test(plain.svg) && /fill-opacity="0.85"/.test(plain.svg), 'without fade: as before');
  });

  test('fade: a color cannot smuggle CSS into the gradient, and a var() color is kept for theming', () => {
    const { svg } = draw(monthly({ marks: [{ type: 'area', x: 'm', y: 'rev', fade: true, fill: 'red;background:url(x)}<b>' }] }));
    assert(/stop-color:redbackground:url\(x\)b;stop-opacity/.test(svg), 'semicolons, braces and angle brackets are dropped from the color');
    const themed = draw(monthly({ marks: [{ type: 'area', x: 'm', y: 'rev', fade: true }] }));
    assert(/stop-color:var\(--bc-c0, #[0-9a-f]+\);/.test(themed.svg), 'the theme variable reaches the gradient');
  });

  // ───────────────────────── guide.kpi ─────────────────────────

  const kpiTexts = (svg) => {
    const out = {};
    for (const m of svg.matchAll(/<text [^>]*fill="([^"]+)"[^>]*class="bc-kpi-(\w+)"[^>]*>([^<]*)<\/text>/g)) out[m[2]] = { text: m[3], fill: m[1] };
    return out;
  };

  test('guide.kpi: the last value, its change against the row before, green when it rises', () => {
    const { svg, h } = draw(monthly({ guides: [{ type: 'kpi', field: 'rev', label: 'Revenue', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }, note: 'vs March' }] }));
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
    const sum = kpiTexts(draw(monthly({ guides: [{ type: 'kpi', field: 'rev', aggregate: 'sum', against: 'target', delta: 'absolute' }] })).svg);
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
    const flatRows = [{ t: 1, v: 5 }, { t: 2, v: 5 }];
    BC.data('flat', flatRows);
    const flat = kpiTexts(draw({ data: 'flat', marks: [], guides: [{ type: 'kpi', field: 'v' }] }).svg);
    assert.strictEqual(flat.delta.text, '■ 0%');
    assert(/--bc-label/.test(flat.delta.fill), 'no change is neither good nor bad');
    BC.data('fromzero', [{ v: 0 }, { v: 7 }]);
    assert.strictEqual(kpiTexts(draw({ data: 'fromzero', marks: [], guides: [{ type: 'kpi', field: 'v' }] }).svg).delta.text, '▲', 'from zero there is a direction but no percentage');
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

  test('guide.kpi: takes room at the top (the chart under it is a sparkline), and a tile of the guide alone is valid', () => {
    const top = (svg) => Math.min(...paths(layer(svg, 'marks')).map((p) => Math.min(...[...p.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2]))));
    const bare = draw(monthly({ size: [300, 160] }));
    const tile = draw(monthly({ size: [300, 160], guides: [{ type: 'kpi', field: 'rev', label: 'Revenue' }] }));
    assert(top(tile.svg) > top(bare.svg) + 50, 'the sparkline starts below the figure');
    assert.deepStrictEqual(BC.validate({ data: 'months', marks: [], guides: [{ type: 'kpi', field: 'rev' }] }), [], 'no marks, one guide: fine');
    const d = BC.validate({ data: 'months', marks: [] });
    assert(d.some((x) => x.path === 'marks' && /at least one mark/.test(x.message)), 'nothing to draw is still an error');
    assert(BC.validate({ data: 'months', guides: [{ type: 'kpi', field: 'rev' }] }).some((x) => x.path === 'marks' && /must be a list/.test(x.message)));
    const bad = BC.validate({ data: 'months', marks: [], guides: [{ type: 'kpi', field: 'revnue', aggregate: 'median' }] });
    assert(bad.some((x) => x.path === 'guides[0].field' && /unknown field "revnue"/.test(x.message)), 'a misspelt field is caught');
    assert(bad.some((x) => x.path === 'guides[0].aggregate'), 'so is an aggregate it does not have');
    assert(BC.validate({ data: 'months', marks: [], guides: [{ type: 'kpi' }] }).some((x) => /requires "field"/.test(x.message)));
  });

  // ───────────────────────── transform.waterfall ─────────────────────────

  test('transform.waterfall: running totals, subtotals from 0, kinds; gaps change nothing', () => {
    const t = apply('waterfall', [
      { k: 'Start', v: 100, tot: false }, { k: 'Sales', v: 40, tot: false }, { k: 'Refunds', v: -15, tot: false },
      { k: 'Gap', v: null, tot: false }, { k: 'Subtotal', v: 999, tot: true }, { k: 'Costs', v: -60, tot: 0 }, { k: 'End', v: null, tot: 'yes' },
    ], { field: 'v', total: 'tot' });
    const c = t.columns;
    assert.deepStrictEqual(Array.from(c.v0).slice(0, 3), [0, 100, 140]);
    assert.deepStrictEqual(Array.from(c.v1).slice(0, 3), [100, 140, 125]);
    assert(isNaN(c.v0[3]) && isNaN(c.v1[3]) && c.step[3] === null, 'a gap draws nothing');
    assert.deepStrictEqual([c.v0[4], c.v1[4]], [0, 125], 'a subtotal ignores its own value and shows the running total');
    assert.deepStrictEqual([c.v0[5], c.v1[5]], [125, 65]);
    assert.deepStrictEqual([c.v0[6], c.v1[6]], [0, 65], '"yes" marks a total too');
    assert.deepStrictEqual(c.step, ['increase', 'increase', 'decrease', null, 'total', 'decrease', 'total']);
    assert.deepStrictEqual(Array.from(c.amount).map((v) => (isNaN(v) ? null : v)), [100, 40, -15, null, 125, -60, 65], 'the change, or the total a subtotal shows');
    assert.deepStrictEqual(Array.from(c.top).slice(0, 3), [100, 140, 140], 'the upper end: where a label goes');
    assert.strictEqual(c.k[1], 'Sales', 'other columns pass through');
    const named = apply('waterfall', [{ v: 5 }], { field: 'v', as: ['a', 'b'], kindAs: 'kind', start: 10 });
    assert.deepStrictEqual([named.columns.a[0], named.columns.b[0], named.columns.kind[0]], [10, 15, 'increase']);
  });

  test('transform.waterfall in a chart: bars float between their ends, validation knows the new columns', () => {
    BC.data('bridge', [{ k: 'Q1', v: 100 }, { k: 'Up', v: 30 }, { k: 'Down', v: -50 }, { k: 'Q2', v: 0, t: true }]);
    const spec = {
      data: 'bridge', transforms: [{ type: 'waterfall', field: 'v', total: 't' }],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color', domain: ['increase', 'decrease', 'total'] } },
      marks: [{ type: 'rect', x: 'k', y: 'v1', y2: 'v0', color: 'step' }],
    };
    const { svg, h } = draw(spec);
    assert.deepStrictEqual(h.diagnostics, []);
    const bars = rects(layer(svg, 'marks'));
    assert.strictEqual(bars.length, 4);
    assert(near(bars[1].y + bars[1].h, bars[0].y, 0.02), 'the second bar starts where the first ends');
    assert(near(bars[2].y, bars[1].y, 0.02), 'a loss hangs from the top of the running total');
    const bad = BC.validate({ ...spec, marks: [{ type: 'rect', x: 'k', y: 'v1', y2: 'v0', color: 'stp' }] });
    assert(bad.some((d) => /unknown field "stp"/.test(d.message)), 'a typo in a produced column is caught');
  });

  // ───────────────────────── transform.funnel ─────────────────────────

  test('transform.funnel: centered bars, share of the first stage and of the previous one; bad rows skipped', () => {
    const t = apply('funnel', [{ s: 'Visits', n: 1000 }, { s: 'Sign-ups', n: 250 }, { s: 'Broken', n: -3 }, { s: 'Trials', n: 100 }, { s: 'Paid', n: 0 }], { field: 'n' });
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
    for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) assert(!overlap(cells[a], cells[b]), `cells ${a} and ${b} do not overlap`);
    const biggest = cells.find((c) => c.i === 0);
    assert(near(biggest.x0, 0) && near(biggest.y1, 1), 'the largest cell is at the top left');
    // squarified: in the chart's proportions, no cell is a sliver
    for (const c of cells) {
      const ratio = ((c.x1 - c.x0) * 1.6) / (c.y1 - c.y0);
      assert(ratio < 6 && ratio > 1 / 6, `cell ${c.i} is not a sliver (${ratio.toFixed(2)})`);
    }
    assert.deepStrictEqual(Array.from(t.columns.x0), Array.from(apply('treemap', rows, { field: 'v', name: 'name', padding: 0 }).columns.x0), 'deterministic');
  });

  test('transform.treemap: groups make blocks, labels only for big cells, bad rows and padding', () => {
    const rows = [
      { g: 'EU', p: 'a', v: 40 }, { g: 'US', p: 'b', v: 30 }, { g: 'EU', p: 'c', v: 10 }, { g: 'US', p: 'd', v: 15 },
      { g: 'EU', p: 'tiny', v: 0.5 }, { g: 'US', p: 'neg', v: -5 }, { g: 'US', p: 'nan', v: 'x' },
    ];
    const t = apply('treemap', rows, { field: 'v', group: 'g', name: 'p', padding: 0, labelMin: 0.05 });
    const cells = cellsOf(t);
    assert.deepStrictEqual(cells.map((c) => c.i).sort(), [0, 1, 2, 3, 4], 'zero, negative and non-numeric sizes are left out');
    const box = (g) => {
      const mine = cells.filter((c) => rows[c.i].g === g);
      return { x0: Math.min(...mine.map((c) => c.x0)), x1: Math.max(...mine.map((c) => c.x1)), y0: Math.min(...mine.map((c) => c.y0)), y1: Math.max(...mine.map((c) => c.y1)) };
    };
    assert(!overlap(box('EU'), box('US')), 'each group is one block');
    assert.deepStrictEqual(Array.from(t.columns.label), ['a', 'b', 'c', 'd', null, null, null], 'the tiny cell gets no label');
    const padded = cellsOf(apply('treemap', rows, { field: 'v', group: 'g', padding: 0.02 }));
    for (let a = 0; a < padded.length; a++) for (let b = a + 1; b < padded.length; b++) assert(!overlap(padded[a], padded[b]));
    assert(padded.every((c) => c.x1 > c.x0 && c.y1 > c.y0), 'padding never turns a cell inside out');
    assert.strictEqual(cellsOf(apply('treemap', [{ v: 0 }], { field: 'v' })).length, 0, 'nothing to lay out');
  });

  test('transform.treemap in a chart: rects on unit scales, labels at the corners', () => {
    BC.data('tree', [{ n: 'Alpha', v: 50 }, { n: 'Beta', v: 30 }, { n: 'Gamma', v: 20 }]);
    const { svg, h } = draw({
      data: 'tree', size: [640, 400], padding: { top: 0, right: 0, bottom: 0, left: 0 },
      transforms: [{ type: 'treemap', field: 'v', name: 'n', aspect: 1.6 }],
      scales: { x: { type: 'linear', domain: [0, 1] }, y: { type: 'linear', domain: [0, 1] } },
      marks: [{ type: 'rect', x: 'x0', x2: 'x1', y: 'y1', y2: 'y0' }, { type: 'text', x: 'x0', y: 'y1', text: 'label', anchor: 'start', baseline: 'hanging', dx: 6, dy: 6 }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const cells = rects(layer(svg, 'marks'));
    const area = cells.reduce((a, r) => a + r.w * r.h, 0);
    assert(area > 640 * 400 * 0.97, 'the cells fill the plot: ' + area);
    assert.deepStrictEqual(texts(layer(svg, 'marks')), ['Alpha', 'Beta', 'Gamma']);
  });

  // ───────────────────────── mark.rule, bar thickness ─────────────────────────

  test('mark.rule: a constant is a value on the scale, drawn once across the plot, with its label', () => {
    const { svg, h } = draw(monthly({ scales: { x: { type: 'time' }, y: { type: 'linear', domain: [0, 200] } }, marks: [{ type: 'line', x: 'm', y: 'rev' }, { type: 'rule', y: { value: 150 }, dash: [4, 4], label: 'Target' }] }));
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
    BC.data('bullet', [{ k: 'A', v: 70, t: 80 }, { k: 'B', v: 90, t: 85 }]);
    const spec = {
      data: 'bullet', scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } },
      marks: [{ type: 'rect', x: 'v', y: 'k', thickness: 0.4 }, { type: 'rule', x: 't', y: 'k', thickness: 0.8, stroke: '#111' }],
    };
    const { svg } = draw(spec);
    const bars = rects(layer(svg, 'marks'));
    const ticks = paths(layer(svg, 'marks')).filter((p) => /stroke="#111"/.test(p.attrs)).map((p) => /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(p.d).slice(1).map(Number));
    assert.strictEqual(ticks.length, 2);
    for (let i = 0; i < 2; i++) {
      const b = bars[i];
      const t = ticks[i];
      assert(near(t[0], t[2]), 'vertical');
      const tickLen = Math.abs(t[3] - t[1]);
      assert(near(tickLen, b.h * 2, 0.05), 'the tick spans 0.8 of the band, the bar 0.4');
      assert(near((t[1] + t[3]) / 2, b.y + b.h / 2, 0.05), 'both centered in the band');
    }
    assert.strictEqual(paths(layer(draw({ ...spec, marks: [{ type: 'rule', stroke: '#111' }] }).svg, 'marks')).length, 0, 'no x and no y: nothing');
    assert.strictEqual(paths(layer(draw({ data: 'months', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'rule', x: 'rev', y: 'cost', stroke: '#111' }] }).svg, 'marks')).length, 0, 'a point is not a line');
  });

  test('mark.rect thickness: a slim bar, centered in its band', () => {
    const full = rects(layer(draw({ data: 'bullet', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }] }).svg, 'marks'));
    const slim = rects(layer(draw({ data: 'bullet', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v', thickness: 0.5 }] }).svg, 'marks'));
    assert(near(slim[0].w, full[0].w / 2, 0.02));
    assert(near(slim[0].x + slim[0].w / 2, full[0].x + full[0].w / 2, 0.02));
    const clamp = rects(layer(draw({ data: 'bullet', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v', thickness: 7 }] }).svg, 'marks'));
    assert(near(clamp[0].w, full[0].w, 0.02), 'more than the band is the band');
  });

  // ───────────────────────── wrapping legends and labels, areas to the bottom ─────────────────────────

  test('guide.legend: a row wider than the plot wraps onto more lines, and takes the room it needs', () => {
    BC.data('many', ['Organic search', 'Paid search', 'Referral partners', 'Email campaigns', 'Social media', 'Direct'].map((c, i) => ({ c, v: i + 1 })));
    const spec = (w) => ({ data: 'many', size: [w, 300], scales: { color: { type: 'color' } }, guides: [{ type: 'legend', scale: 'color', position: 'bottom' }], marks: [{ type: 'arc', value: 'v', color: 'c' }] });
    const itemsOf = (svg) => [...svg.matchAll(/<g class="bc-legend-item"[^>]*><rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    const narrow = itemsOf(draw(spec(280)).svg);
    const wide = itemsOf(draw(spec(900)).svg);
    assert.strictEqual(narrow.length, 6);
    assert.strictEqual(new Set(wide.map((i) => i.y)).size, 1, 'on a wide chart: one row');
    assert(new Set(narrow.map((i) => i.y)).size >= 2, 'on a narrow one: several');
    assert(narrow.every((i) => i.x < 280), 'nothing runs off the chart');
    const radius = (svg) => { const d = paths(layer(svg, 'marks'))[0].d; return Math.max(...[...d.matchAll(/A([\d.]+)/g)].map((m) => +m[1])); };
    assert(radius(draw(spec(280)).svg) < radius(draw({ ...spec(280), guides: [] }).svg), 'the wrapped legend takes its room from the plot');
  });

  test('mark.area toBottom: fills to the bottom of the plot when the axis does not start at 0', () => {
    const { svg } = draw(monthly({ size: [300, 150], scales: { x: { type: 'time' }, y: { type: 'linear' } }, marks: [{ type: 'area', x: 'm', y: 'rev', toBottom: true }] }));
    const ys = [...paths(layer(svg, 'marks'))[0].d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2]);
    assert.strictEqual(Math.max(...ys), 150 - 16, 'down to the plot bottom, not to 0 far below it');
    assert(!/NaN/.test(svg));
    const zeroBased = draw(monthly({ size: [300, 150], scales: { x: { type: 'time' }, y: { type: 'linear' } }, marks: [{ type: 'area', x: 'm', y: 'rev' }] }));
    const ys0 = [...paths(layer(zeroBased.svg, 'marks'))[0].d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2]);
    assert(Math.max(...ys0) > 150, 'without it the area goes down to 0, below the plot (why toBottom exists)');
  });

  test('band axis: every category label that fits is shown, a long one wraps onto two lines, many are still thinned', () => {
    BC.data('items', ['Revenue', 'Cost of sales', 'Gross profit', 'Marketing', 'Salaries', 'Other income', 'Operating profit'].map((k, i) => ({ k, v: i + 1 })));
    const axisTexts = (svg) => [...layer(svg, 'axes').matchAll(/<text [^>]*class="bc-axis-label">([^<]*)<\/text>/g)].map((m) => m[1]);
    const bars = (data, w) => ({ data, size: [w, 300], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, guides: [{ type: 'axis', scale: 'x' }], marks: [{ type: 'rect', x: 'k', y: 'v' }] });
    // 440 px: the old one-label-per-80-px rule would thin these; measured, all seven fit
    const labels = axisTexts(draw(bars('items', 440)).svg);
    for (const word of ['Revenue', 'Marketing', 'Salaries']) assert(labels.includes(word), word + ' is shown: ' + labels.join('|'));
    assert(labels.includes('Gross') && labels.includes('profit') && labels.includes('Operating'), 'long labels are split at a space: ' + labels.join('|'));
    assert(labels.every((l) => ['Revenue', 'Cost of', 'sales', 'Cost', 'of sales', 'Gross', 'profit', 'Marketing', 'Salaries', 'Other', 'income', 'Operating'].includes(l)), 'only whole words: ' + labels.join('|'));
    BC.data('longword', [{ k: 'Supercalifragilistic', v: 1 }, { k: 'B', v: 2 }]);
    assert(axisTexts(draw(bars('longword', 200)).svg).includes('Supercalifragilistic'), 'one word is not broken');
    BC.data('sixty', Array.from({ length: 60 }, (_, i) => ({ k: 'Item ' + i, v: i })));
    const sixty = axisTexts(draw(bars('sixty', 640)).svg);
    assert(sixty.length < 60 && sixty.length > 5, 'sixty categories on 640 px are thinned: ' + sixty.length);
  });

  // ───────────────────────── the card tooltip ─────────────────────────

  const tipOf = (host) => host.children.find((c) => c.attrs.class === 'bc-tooltip');
  const partOf = (host, cls) => host.children.find((c) => c.attrs.class === cls);
  const hover = async (host, x, y) => { host.children[0].fire('pointermove', { clientX: x, clientY: y, buttons: 0 }); await flush(); };

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
    assert(/^[A-Z][a-z]{2} \d{1,2}, 2024$/.test(heading.children[heading.children.length - 1].text), 'written as a date, not the ISO string: ' + heading.children[heading.children.length - 1].text);
    assert.strictEqual(partOf(host, 'bc-tooltip-crosshair'), undefined, 'the crosshair is its own block now');
    assert(/--bc-c0/.test(partOf(host, 'bc-tooltip-dot').style.background), 'the dot in the line color');

    const listed = new FakeNode('div');
    BC.chart(listed, monthly({ interaction: [{ type: 'tooltip', fields: ['rev', 'target'] }] }));
    await hover(listed, x, y);
    const listedHead = tipOf(listed).children.find((c) => c.attrs.class === 'bc-tooltip-heading');
    assert(listedHead && listedHead.attrs['data-bc-field'] === 'm', 'the date still heads the card when fields are listed');
    assert.deepStrictEqual(tipOf(listed).children.find((c) => c.attrs.class === 'bc-tooltip-lines').children.map((c) => c.text).filter((_, i) => i % 2 === 0), ['rev', 'target'], 'then exactly the listed fields');

    assert(BC.validate(monthly({ interaction: [{ type: 'tooltip', crosshair: 'on' }] })).some((d) => d.level === 'warn' && /unknown parameter "crosshair"/.test(d.message)), 'the old parameter is flagged, not silently used');

    const bars = new FakeNode('div');
    BC.chart(bars, { data: 'bullet', size: [640, 400], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }], interaction: [{ type: 'tooltip' }] });
    const b = rects(layer(svgOf(bars), 'marks'))[0];
    await hover(bars, b.x + b.w / 2, b.y + b.h / 2);
    assert.strictEqual(tipOf(bars).style.display, 'block');
    const lines = tipOf(bars).children.find((c) => c.attrs.class === 'bc-tooltip-lines');
    assert.deepStrictEqual(lines.children.map((c) => c.text), ['v', '70'], 'the value line; the category went to the heading');

    // a value from the data is text in the card, never markup
    BC.data('evil', [{ k: '<img src=x onerror=alert(1)>', v: 1 }]);
    const evil = new FakeNode('div');
    BC.chart(evil, { data: 'evil', size: [640, 400], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }], interaction: [{ type: 'tooltip' }] });
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
    BC.chart(bars, { data: 'bullet', size: [640, 400], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }], interaction: [{ type: 'crosshair' }] });
    await hover(bars, 200, 200);
    assert.strictEqual(partOf(bars, 'bc-crosshair').style.display, 'none', 'no line or area to snap to: nothing');
    const all = new FakeNode('div');
    BC.chart(all, { data: 'bullet', size: [640, 400], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }], interaction: [{ type: 'crosshair', snap: 'all' }] });
    const b = rects(layer(svgOf(all), 'marks'))[0];
    await hover(all, b.x + 2, 200);
    assert(near(parseFloat(partOf(all, 'bc-crosshair').style.left), b.x + b.w / 2, 0.01), 'snap "all": the middle of the bar');
    const hd = new FakeNode('div');
    const handle = BC.chart(hd, monthly({ interaction: [{ type: 'crosshair' }] }));
    handle.destroy();
    assert.strictEqual(hd.children.length, 0, 'destroy removes it');
  });

  test('mark.line label: names and last values at the line ends, in their colors, pushed apart when they would overlap', () => {
    BC.data('close', [
      { t: '2024-01-01', v: 10, s: 'Alpha' }, { t: '2024-02-01', v: 20, s: 'Alpha' },
      { t: '2024-01-01', v: 11, s: 'Beta' }, { t: '2024-02-01', v: 20.3, s: 'Beta' },
      { t: '2024-01-01', v: 5, s: 'Gamma' }, { t: '2024-02-01', v: null, s: 'Gamma' },
    ]);
    const spec = (label, extra) => ({ data: 'close', size: [640, 400], padding: { right: 100 }, scales: { x: { type: 'time' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'line', x: 't', y: 'v', group: 's', label, ...extra }] });
    const labels = (svg) => [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*fill="([^"]+)"[^>]*class="bc-line-label">([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], fill: m[3], text: m[4] }));
    const both = labels(draw(spec('both', { format: { maximumFractionDigits: 0 } })).svg);
    assert.deepStrictEqual(both.map((l) => l.text).sort(), ['Alpha  20', 'Beta  20', 'Gamma  5'], 'name and value; a gap ends a series at its last number');
    const ys = both.map((l) => l.y).sort((a, b) => a - b);
    for (let k = 1; k < ys.length; k++) assert(ys[k] - ys[k - 1] >= 13.9, 'no overlap: ' + ys.join(', '));
    assert(new Set(both.map((l) => l.fill)).size === 3, 'each in its line color');
    assert.deepStrictEqual(labels(draw(spec('name')).svg).map((l) => l.text).sort(), ['Alpha', 'Beta', 'Gamma']);
    const single = labels(draw(monthly({ padding: { right: 90 }, marks: [{ type: 'line', x: 'm', y: 'rev', label: 'value', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } }] })).svg);
    assert.deepStrictEqual(single.map((l) => l.text), ['$160']);
    assert.strictEqual(labels(draw(monthly({ marks: [{ type: 'line', x: 'm', y: 'rev', label: 'name', name: 'Revenue' }] })).svg)[0].text, 'Revenue', 'one line: the name given');
    assert.strictEqual(labels(draw(spec('none')).svg).length, 0, 'none by default');
    // two line marks ending close together (revenue and plan) are spread together, not each on its own
    BC.data('twin', [{ t: 1, a: 100, b: 101 }, { t: 2, a: 200, b: 199 }]);
    const twin = labels(draw({ data: 'twin', size: [640, 400], padding: { right: 90 }, scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'line', x: 't', y: 'a', label: 'name', name: 'Revenue' }, { type: 'line', x: 't', y: 'b', label: 'name', name: 'Plan' }] }).svg);
    assert.deepStrictEqual(twin.map((l) => l.text).sort(), ['Plan', 'Revenue'], 'each once');
    assert(Math.abs(twin[0].y - twin[1].y) >= 13.9, 'apart: ' + twin.map((l) => l.y).join(', '));
    BC.data('evilname', [{ t: 1, v: 1, s: '<b>x</b>' }, { t: 2, v: 2, s: '<b>x</b>' }]);
    const evil = draw({ data: 'evilname', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 't', y: 'v', group: 's', label: 'name' }] }).svg;
    assert(!evil.includes('<b>x</b>'), 'a series name is text');
  });

  test('interaction.animate: once per chart, the effect by the marks, nothing for reduced motion or without the API', () => {
    const calls = [];
    const proto = FakeNode.prototype;
    const saved = { animate: proto.animate, querySelector: proto.querySelector, window: globalThis.window };
    proto.animate = function (frames, timing) { calls.push({ node: this, frames, timing }); return { cancel() {} }; };
    proto.querySelector = function (sel) {
      const m = /data-bc-layer="(\w+)"/.exec(sel);
      return (this.children || []).find((c) => c.attrs && c.attrs['data-bc-layer'] === (m && m[1])) || null;
    };
    try {
      const run = (spec) => { calls.length = 0; const host = new FakeNode('div'); const h = BC.chart(host, spec); return { host, h, call: calls[0] }; };
      const bars = run({ data: 'bullet', size: [640, 400], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }], interaction: [{ type: 'animate', duration: 500, delay: 100 }] });
      assert(bars.call && bars.call.node.attrs['data-bc-layer'] === 'marks', 'the marks layer is animated, not the axes');
      assert.deepStrictEqual(bars.call.frames.map((f) => f.transform), ['scaleY(0)', 'none'], 'bars grow');
      assert.strictEqual(bars.call.node.style.transformOrigin, '0px 384px', 'from the baseline (0 on the y scale)');
      assert.deepStrictEqual([bars.call.timing.duration, bars.call.timing.delay], [500, 100]);
      const line = run(monthly({ interaction: [{ type: 'animate' }] }));
      assert(/^inset\(0 /.test(line.call.frames[0].clipPath), 'lines are drawn from the left');
      const pie = run({ data: 'bullet', scales: { color: { type: 'color' } }, marks: [{ type: 'arc', value: 'v', color: 'k' }], interaction: [{ type: 'animate' }] });
      assert(/scale/.test(pie.call.frames[0].transform), 'a pie opens');
      const hbars = run({ data: 'bullet', size: [640, 400], scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'v', y: 'k' }], interaction: [{ type: 'animate' }] });
      assert.deepStrictEqual(hbars.call.frames[0].transform, 'scaleX(0)', 'horizontal bars grow sideways');

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

  // ───────────────────────── responsive layout ─────────────────────────

  test('responsive: a container narrower than the size lays the chart out at its width, again when it changes, keeping the zoom', async () => {
    const observers = [];
    const savedRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.on = true; observers.push(this); } observe() {} disconnect() { this.on = false; } };
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
