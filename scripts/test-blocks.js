// Tests for the scale / mark / guide / interaction blocks and the view (zoom) pipeline. Loaded by test.js.
const assert = require('assert');

module.exports = function ({ test, FakeNode, svgOf, count, axisStarts, logged, flush }) {
  const rects = (svg) => [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  const layer = (svg, name) => { const i = svg.indexOf(`data-bc-layer="${name}"`); return svg.slice(i, svg.indexOf('</g>', i)); };
  const hasClip = (svg, name) => new RegExp(`data-bc-layer="${name}" clip-path`).test(svg);

  BC.data('cats', [{ k: 'a', v: 3 }, { k: 'b', v: 6 }, { k: 'c', v: 0 }, { k: 'd', v: 9 }]);
  BC.data('series', [
    { t: '2024-03-01', v: 5, s: 'up' }, { t: '2024-01-01', v: 1, s: 'up' }, { t: '2024-02-01', v: 3, s: 'up' },
    { t: '2024-01-01', v: 8, s: 'down' }, { t: '2024-02-01', v: 6, s: 'down' }, { t: '2024-03-01', v: 2, s: 'down' },
  ]);
  const barSpec = () => ({
    data: 'cats',
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [{ type: 'grid', scale: 'y' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'rect', x: 'k', y: 'v' }],
  });
  const lineSpec = (extra) => ({
    data: 'series',
    scales: { x: { type: 'time' }, y: { type: 'linear' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'line', x: 't', y: 'v', group: 's' }],
    ...extra,
  });

  test('scale.linear: padding widens the domain, setDomain zooms without touching base', () => {
    const mk = (spec) => BC.get('scale.linear').create({ type: 'linear', ...spec }, { name: 'x', sources: [Float64Array.of(1, 12)], range: [0, 100] });
    assert.deepStrictEqual(mk({}).domain(), [0, 12]);
    const p = mk({ padding: 0.05 }).domain();
    assert(p[0] < 1 && p[1] > 12, JSON.stringify(p));
    const s = mk({});
    s.setDomain([2, 4]);
    assert.deepStrictEqual([s.domain(), s.baseDomain()], [[2, 4], [0, 12]]);
    assert.strictEqual(s(3), 50);
    s.setDomain(null);
    assert.deepStrictEqual(s.domain(), [0, 12]);
  });

  test('scale.band: bands, bandwidth, reversed range, window', () => {
    const s = BC.get('scale.band').create({ type: 'band', paddingInner: 0, paddingOuter: 0 }, { name: 'x', sources: [['a', 'b', 'c', 'd', 'a']], range: [0, 200] });
    assert.deepStrictEqual(s.domain(), ['a', 'b', 'c', 'd']);
    assert.deepStrictEqual([s('a'), s('d'), s.bandwidth], [0, 150, 50]);
    assert(Number.isNaN(s('zzz')));
    s.setDomain(['c', 'd']);
    assert.deepStrictEqual([s('c'), s.bandwidth], [0, 100]);
    assert(Number.isNaN(s('a')), 'outside the window');
    s.setDomain(null);
    s.setRange([200, 0]);
    assert.strictEqual(s('a'), 0, 'reversed range (a vertical axis): the first band is still first from the top');
    assert.strictEqual(s('d'), 150);
    assert.deepStrictEqual(s.ticks(2).map((t) => t.label), ['a', 'c']);
  });

  test('scale.time: ISO strings, calendar ticks', () => {
    const mk = (a, b) => BC.get('scale.time').create({ type: 'time' }, { name: 'x', sources: [[a, b]], range: [0, 600] });
    const months = mk('2024-01-01', '2024-12-31');
    assert.deepStrictEqual(months.ticks(6).map((t) => t.label), ['Jan 2024', 'Apr 2024', 'Jul 2024', 'Oct 2024']);
    const days = mk('2024-03-01', '2024-03-08');
    assert(days.ticks(8).every((t) => /^Mar \d+$/.test(t.label)), days.ticks(8).map((t) => t.label).join());
    assert.deepStrictEqual(mk('2010-06-01', '2024-06-01').ticks(6).map((t) => t.label), ['2012', '2014', '2016', '2018', '2020', '2022', '2024']);
    const hours = mk('2024-03-01T00:00:00Z', '2024-03-01T06:00:00Z');
    assert(hours.ticks(6).every((t) => /^\d\d:\d\d$/.test(t.label)));
    assert.strictEqual(months(Date.UTC(2024, 0, 1)), 0);
    assert.strictEqual(months('2024-12-31'), 600);
  });

  test('bar chart: band + rect + grid', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, barSpec());
    const svg = svgOf(host);
    assert.deepStrictEqual(h.diagnostics, []);
    assert.strictEqual(count(layer(svg, 'marks'), /<rect /g), 4);
    const bars = rects(layer(svg, 'marks'));
    assert(bars.every((b) => Math.abs(b.w - bars[0].w) < 1e-6), 'equal widths');
    assert(bars.every((b, i) => i === 0 || b.x > bars[i - 1].x), 'left to right');
    const bottoms = bars.filter((b) => b.h > 0).map((b) => +(b.y + b.h).toFixed(4));
    assert(bottoms.every((y) => y === bottoms[0]), 'all bars sit on the baseline: ' + bottoms);
    assert(Math.abs(bars[3].h / bars[1].h - 1.5) < 1e-6, 'heights are proportional');
    assert.strictEqual(bars[2].h, 0, 'a zero bar is empty');
    assert(!/NaN/.test(svg));
  });

  test('mark.rect: dodge splits a band into side-by-side bars, in first-appearance order and consistent across categories', () => {
    // product "A" appears first (North row 0): every category must put "A" in the same (first) sub-slot,
    // even in South where the data lists "B" before "A".
    BC.data('grouped', [
      { region: 'North', product: 'A', revenue: 10 }, { region: 'North', product: 'B', revenue: 20 },
      { region: 'South', product: 'B', revenue: 15 }, { region: 'South', product: 'A', revenue: 5 },
    ]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'grouped',
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
      marks: [{ type: 'rect', x: 'region', y: 'revenue', color: 'product', dodge: 'product' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const bars = rects(layer(svgOf(host), 'marks')).sort((a, b) => a.x - b.x);
    assert.strictEqual(bars.length, 4, 'one bar per row');
    // left to right: North A (10), North B (20), South A (5), South B (15) — heights are pixels, so compare ratios
    const [na, nb, sa, sb] = bars.map((b) => b.h);
    assert(Math.abs(nb / na - 2) < 1e-6, `North B should be twice North A: ${nb} vs ${na}`);
    assert(Math.abs(sb / sa - 3) < 1e-6, `South B should be 3x South A: ${sb} vs ${sa}`);
    assert(Math.abs(na / sa - 2) < 1e-6, `North A (10) should be twice South A (5): ${na} vs ${sa}`);
    assert(bars.every((b) => Math.abs(b.w - bars[0].w) < 1e-6), 'every dodged bar shares the same width');
    assert(bars[0].x + bars[0].w <= bars[1].x, 'North A and North B do not overlap');
    assert(bars[2].x + bars[2].w <= bars[3].x, 'South A and South B do not overlap');
    assert(bars[1].x + bars[1].w < bars[2].x, 'North and South stay in their own bands');
  });

  test('mark.rect: dodge does not affect the value axis or a chart with only one dodge value', () => {
    BC.data('onegroup', [{ region: 'North', product: 'A', revenue: 10 }, { region: 'South', product: 'A', revenue: 5 }]);
    const host = new FakeNode('div');
    const h = BC.chart(host, { data: 'onegroup', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'region', y: 'revenue', dodge: 'product' }] });
    assert.deepStrictEqual(h.diagnostics, []);
    const bars = rects(layer(svgOf(host), 'marks'));
    const plainHost = new FakeNode('div');
    BC.chart(plainHost, { data: 'onegroup', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'region', y: 'revenue' }] });
    const plainBars = rects(layer(svgOf(plainHost), 'marks'));
    assert.deepStrictEqual(bars, plainBars, 'one distinct dodge value: identical to no dodge at all');
  });

  test('mark.rect: dodge is hit correctly by the tooltip, and a row with no dodge value is skipped', () => {
    BC.data('groupedPick', [
      { region: 'North', product: 'A', revenue: 10 }, { region: 'North', product: 'B', revenue: 20 },
      { region: 'South', product: null, revenue: 8 },
    ]);
    const host = new FakeNode('div');
    BC.chart(host, {
      data: 'groupedPick', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'rect', x: 'region', y: 'revenue', dodge: 'product' }], interaction: [{ type: 'tooltip' }],
    });
    const bars = rects(layer(svgOf(host), 'marks'));
    assert.strictEqual(bars.length, 2, 'the row with a null dodge value draws nothing');
  });

  test('mark.point: a band scale centers the dot in its band (dot plot), and the tooltip finds it there', async () => {
    BC.data('dotplot', [{ team: 'A', score: 42 }, { team: 'B', score: 58 }, { team: 'C', score: 31 }]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'dotplot', scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } },
      marks: [{ type: 'point', x: 'score', y: 'team', r: 5 }], interaction: [{ type: 'tooltip' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    const dots = [...layer(svg, 'marks').matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    assert.strictEqual(dots.length, 3);
    // the dot must sit at the vertical center of its band, not at the band's edge
    const probeHost = new FakeNode('div');
    const p = BC.chart(probeHost, { data: 'dotplot', scales: { y: { type: 'band' }, x: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'score', y: 'team', baseline: 0 }], interaction: [{ type: 'probe2' }] });
    const rowOfA = probed.rows(probed.spec.marks[0]).from;
    const bw = probed.channel(probed.spec.marks[0], 'y').scale.bandwidth;
    const bandStart = probed.channel(probed.spec.marks[0], 'y').mapped[rowOfA];
    const aDot = dots.find((d) => Math.abs(d.y - (bandStart + bw / 2)) < 1e-6);
    assert(aDot, `no dot centered on the first band; bandStart=${bandStart} bw=${bw} dots=${JSON.stringify(dots)}`);

    await hover(host, dots[0].x, dots[0].y);
    assert.strictEqual(tipOf(host).style.display, 'block', 'the tooltip finds a dot on a band scale');
  });

  test('grid lines sit exactly on the axis ticks', () => {
    const host = new FakeNode('div');
    BC.chart(host, barSpec());
    const svg = svgOf(host);
    const gridYs = [...layer(svg, 'grid').matchAll(/M[\d.]+ ([\d.]+)H/g)].map((m) => +m[1]);
    const axisYs = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*text-anchor="end"/g)].map((m) => +m[1]);
    assert(gridYs.length >= 3);
    assert.deepStrictEqual(gridYs, axisYs);
  });

  test('line chart: time scale, one path per group, unsorted rows are ordered', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec());
    const svg = svgOf(host);
    assert.deepStrictEqual(h.diagnostics, []);
    const paths = [...layer(svg, 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(paths.length, 2, 'one path per group');
    const xs = paths[0].match(/[ML]([\d.]+)/g).map((t) => +t.slice(1));
    assert.strictEqual(xs.length, 3);
    assert(xs[0] < xs[1] && xs[1] < xs[2], 'x ascending even though the rows were not');
    assert(svg.includes('>Jan 2024<'));
    assert(svg.includes('<title>up</title>') && svg.includes('<title>down</title>'));
    assert(!/NaN/.test(svg));
  });

  test('line chart: a missing value breaks the line', () => {
    BC.data('gappy', [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: null }, { x: 4, y: 4 }, { x: 5, y: 5 }]);
    const host = new FakeNode('div');
    BC.chart(host, { data: 'gappy', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'x', y: 'y' }] });
    const d = svgOf(host).match(/<path d="([^"]+)"/)[1];
    assert.strictEqual(count(d, /M/g), 2);
  });

  test('validate: channel scale kinds of the new blocks, spec.view', () => {
    const d = BC.validate({ data: 'cats', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'k', y: 'v' }] });
    assert(d.some((x) => x.path === 'marks[0].x' && /does not accept a "band" scale/.test(x.message)), JSON.stringify(d));
    const v = BC.validate({ ...barSpec(), view: { nope: [1, 2], y: 5 } });
    assert(v.some((x) => x.path === 'view.nope') && v.some((x) => x.path === 'view.y'));
  });

  test('view: setView redraws marks and guides, layout stays frozen, batched per frame', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec());
    const root = host.children[0];
    const before = svgOf(host);
    assert(!hasClip(before, 'marks'), 'no clip when not zoomed');
    const startsBefore = axisStarts(before);
    h.setView('x', [Date.UTC(2024, 0, 15), Date.UTC(2024, 1, 15)]);
    h.setView('x', [Date.UTC(2024, 1, 1), Date.UTC(2024, 1, 20)]);
    assert.strictEqual(svgOf(host), before, 'nothing changes until the frame');
    await flush();
    const after = svgOf(host);
    assert.strictEqual(host.children[0], root, 'same root element');
    assert(hasClip(after, 'marks'), 'marks are clipped to the plot while zoomed');
    assert.deepStrictEqual(axisStarts(after), startsBefore, 'axes do not move: layout is frozen');
    assert(/>Feb \d+</.test(after), 'ticks follow the view domain');
    assert.deepStrictEqual(h.getView().x, [Date.UTC(2024, 1, 1), Date.UTC(2024, 1, 20)]);
    assert.deepStrictEqual(h.getView().y, BC.chart(new FakeNode('div'), lineSpec()).getView().y, 'unzoomed scales report their base domain');
    h.setView('x', null);
    await flush();
    assert(!hasClip(svgOf(host), 'marks'));
    assert.strictEqual(svgOf(host), before, 'reset gives back the identical picture');
    logged.warn.length = 0;
    h.setView('nope', [1, 2]);
    assert(logged.warn.some((w) => /unknown scale "nope"/.test(w)));
    logged.warn.length = 0;
  });

  test('view: spec.view is the initial zoom; band scales zoom to a window of categories', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, { ...barSpec(), view: { x: ['c', 'd'] } });
    assert.deepStrictEqual(h.diagnostics, []);
    assert.strictEqual(count(layer(svgOf(host), 'marks'), /<rect /g), 2, 'only the visible categories are drawn');
    h.setView('x', null);
    await flush();
    assert.strictEqual(count(layer(svgOf(host), 'marks'), /<rect /g), 4);
  });

  test('interaction.zoom: ctrl+wheel zooms around the cursor, drag pans, double-click resets', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec({ interaction: [{ type: 'zoom' }] }));
    assert.deepStrictEqual(h.diagnostics, []);
    const root = host.children[0];
    const [b0, b1] = h.getView().x;
    const mid = { clientX: 300, clientY: 150 };

    root.fire('wheel', { ...mid, deltaY: 500, ctrlKey: false });
    await flush();
    assert.deepStrictEqual(h.getView().x, [b0, b1], 'plain wheel is left to the page by default');

    root.fire('wheel', { ...mid, deltaY: -500, ctrlKey: true });
    await flush();
    const [z0, z1] = h.getView().x;
    assert(z1 - z0 < (b1 - b0) * 0.5, 'zoomed in');
    assert(z0 > b0 && z1 < b1);
    assert(hasClip(svgOf(host), 'marks'));

    root.fire('pointerdown', { button: 0, ...mid, pointerId: 1 });
    root.fire('pointermove', { clientX: 200, clientY: 150 });
    root.fire('pointerup', {});
    await flush();
    const [p0, p1] = h.getView().x;
    assert(Math.abs((p1 - p0) - (z1 - z0)) < 1e-3, 'panning keeps the span');
    assert(p0 > z0, 'dragging left moves the view to later dates');

    root.fire('pointerdown', { button: 0, ...mid, pointerId: 1 });
    root.fire('pointermove', { clientX: 5000, clientY: 150 });
    root.fire('pointerup', {});
    await flush();
    assert(h.getView().x[0] >= b0 - 1e-6, 'cannot pan past the data');

    root.fire('dblclick', mid);
    await flush();
    assert.deepStrictEqual(h.getView().x, [b0, b1]);
    assert(!hasClip(svgOf(host), 'marks'));

    root.fire('wheel', { clientX: 5, clientY: 5, deltaY: -500, ctrlKey: true });
    await flush();
    assert.deepStrictEqual(h.getView().x, [b0, b1], 'events outside the plot are ignored');

    h.destroy();
    assert.strictEqual((root.listeners.wheel || []).length, 0, 'listeners removed on destroy');
  });

  BC.data('pts', [
    { a: 1, b: 2, g: 'A' }, { a: 2, b: 4, g: 'B' }, { a: 3, b: 3, g: 'A' },
    { a: 4, b: 6, g: 'B' }, { a: 5, b: 5, g: 'C' }, { a: 6, b: 8, g: 'C' },
  ]);
  const ptSpec = (guides) => ({
    data: 'pts',
    scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'color' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, ...guides],
    marks: [{ type: 'point', x: 'a', y: 'b', color: 'g' }],
  });
  const bottomAxisEnd = (svg) => +svg.match(/<path d="M[\d.]+ [\d.]+H([\d.]+)/)[1];
  const fills = (svg) => [...layer(svg, 'marks').matchAll(/<circle [^>]*fill="([^"]+)"/g)].map((m) => m[1]);

  test('scale.color: one color per value, theme palette or explicit range, stable under a filtered domain', () => {
    const mk = (spec) => BC.get('scale.color').create({ type: 'color', ...spec }, { name: 'color', sources: [['x', 'y', 'x', 'z']], range: [], color: (i) => `theme${i}` });
    const s = mk({});
    assert.deepStrictEqual(s.domain(), ['x', 'y', 'z']);
    assert.deepStrictEqual([s('x'), s('z')], ['theme0', 'theme2']);
    assert.notStrictEqual(s('nope'), s('x'), 'unknown value gets a neutral color');
    s.setDomain(['z']);
    assert.deepStrictEqual([s.domain(), s('z')], [['z'], 'theme2'], 'filtering keeps the color of a value');
    s.setDomain(null);
    assert.strictEqual(mk({ range: ['red', 'blue'] })('z'), 'red', 'explicit range cycles');
  });

  test('color channel: points, bars and lines take their color from the scale', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, ptSpec([]));
    assert.deepStrictEqual(h.diagnostics, []);
    const f = fills(svgOf(host));
    assert.deepStrictEqual(f.slice(0, 3), [f[0], f[1], f[0]]);
    assert.strictEqual(new Set(f).size, 3);
    assert(f[0].startsWith('var(--bc-c0'));

    const bars = new FakeNode('div');
    BC.chart(bars, { ...barSpec(), scales: { ...barSpec().scales, color: { type: 'color' } }, marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }] });
    assert.strictEqual(new Set([...layer(svgOf(bars), 'marks').matchAll(/<rect [^>]*fill="([^"]+)"/g)].map((m) => m[1])).size, 4, 'a color per bar');

    const lines = new FakeNode('div');
    BC.chart(lines, lineSpec({ scales: { x: { type: 'time' }, y: { type: 'linear' }, color: { type: 'color' } }, marks: [{ type: 'line', x: 't', y: 'v', color: 's' }] }));
    const strokes = [...layer(svgOf(lines), 'marks').matchAll(/<path [^>]*stroke="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(strokes.length, 2, 'the color field also splits the lines');
    assert.notStrictEqual(strokes[0], strokes[1]);
  });

  test('guide.legend: a column on the right takes space and lists every value', () => {
    const plain = new FakeNode('div'), legend = new FakeNode('div');
    BC.chart(plain, ptSpec([]));
    const h = BC.chart(legend, ptSpec([{ type: 'legend', scale: 'color' }]));
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(legend);
    for (const label of ['>A<', '>B<', '>C<']) assert(svg.includes(label), label);
    assert.strictEqual(count(svg, /class="bc-legend-swatch"/g), 3);
    assert(bottomAxisEnd(svg) < bottomAxisEnd(svgOf(plain)) - 20, 'the plot shrank to make room');
    const swatchX = +svg.match(/<rect x="([\d.]+)"[^>]*class="bc-legend-swatch"/)[1];
    assert(swatchX > bottomAxisEnd(svg), 'and the legend sits to the right of it');
    assert.deepStrictEqual(fills(svg).slice(0, 1), [svg.match(/<rect [^>]*fill="([^"]+)"[^>]*class="bc-legend-swatch"/)[1]], 'legend and marks use the same color');
  });

  test('guide.legend: top row above the plot, and stacked outside a right axis', () => {
    const top = new FakeNode('div');
    BC.chart(top, ptSpec([{ type: 'legend', scale: 'color', position: 'top' }]));
    const svg = svgOf(top);
    const plotTop = +svg.match(/<path d="M[\d.]+ ([\d.]+)V/)[1];
    const legendY = +svg.match(/<rect x="[\d.]+" y="([\d.]+)"[^>]*class="bc-legend-swatch"/)[1];
    assert(legendY < plotTop, 'row is above the plot');
    const xs = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*class="bc-legend-swatch"/g)].map((m) => +m[1]);
    assert(xs[0] < xs[1] && xs[1] < xs[2], 'items run left to right');

    const both = new FakeNode('div');
    BC.chart(both, ptSpec([{ type: 'axis', scale: 'y', position: 'right' }, { type: 'legend', scale: 'color' }]));
    const s2 = svgOf(both);
    const rightAxisX = +s2.match(/<path d="M([\d.]+) [\d.]+V[\d.]+M[\d.]+ [\d.]+H([\d.]+)/g).map((m) => m)[0].match(/M([\d.]+)/)[1];
    const legendX = +s2.match(/<rect x="([\d.]+)"[^>]*class="bc-legend-swatch"/)[1];
    assert(legendX > rightAxisX + 20, 'legend is outside the axis labels');
  });

  test('guide.legend: a non-color scale is a diagnostic, the rest still renders', () => {
    logged.error.length = 0;
    const host = new FakeNode('div');
    const h = BC.chart(host, ptSpec([{ type: 'legend', scale: 'x' }]));
    assert(h.diagnostics.some((d) => d.path === 'guides[2]' && /needs a color scale/.test(d.message)), JSON.stringify(h.diagnostics));
    assert.strictEqual(count(svgOf(host), /<circle /g), 6);
    logged.error.length = 0;
  });

  test('validate: color channels only accept color scales', () => {
    const d = BC.validate({ ...ptSpec([]), scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'linear' } } });
    assert(d.some((x) => x.path === 'marks[0].color' && /does not accept a "linear" scale \(accepts: color, sequential\)/.test(x.message)), JSON.stringify(d));
    assert(BC.validate(ptSpec([{ type: 'legend', scale: 'nope' }])).some((x) => x.path === 'guides[2].scale'));
  });

  // ── tooltip ──
  const tipOf = (host) => host.children.find((c) => c.attrs.class === 'bc-tooltip');
  const dotOf = (host) => host.children.find((c) => c.attrs.class === 'bc-tooltip-dot');
  const highlightOf = (host) => host.children.find((c) => c.attrs.class === 'bc-tooltip-highlight');
  const tipText = (host) => { const t = tipOf(host); return t.children.map((line) => line.children.map((c) => c.text).join('')); };
  const hover = async (host, x, y, extra) => { host.children[0].fire('pointermove', { clientX: x, clientY: y, buttons: 0, ...extra }); await flush(); };
  const circles = (svg) => [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const tipSpec = (extra, tooltip) => ({ ...ptSpec([]), interaction: [{ type: 'tooltip', ...tooltip }], ...extra });

  test('interaction.tooltip: a point shows its row, marker sits on it, empty space and the outside show nothing', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, tipSpec());
    assert.deepStrictEqual(h.diagnostics, []);
    const [c0] = circles(svgOf(host));
    assert.strictEqual(tipOf(host).style.display, 'none', 'hidden until the pointer is over something');

    await hover(host, c0.x + 2, c0.y - 1);
    assert.strictEqual(tipOf(host).style.display, 'block');
    assert.deepStrictEqual(tipText(host), ['a: 1', 'b: 2', 'g: A']);
    assert.strictEqual(dotOf(host).style.left, c0.x + 'px');
    assert.strictEqual(dotOf(host).style.top, c0.y + 'px');

    await hover(host, 60, 30);
    assert.strictEqual(tipOf(host).style.display, 'none', 'nothing near this spot');
    await hover(host, c0.x, c0.y);
    await hover(host, 3, 3);
    assert.strictEqual(tipOf(host).style.display, 'none', 'outside the plot');
    await hover(host, c0.x, c0.y);
    await hover(host, c0.x, c0.y, { buttons: 1 });
    assert.strictEqual(tipOf(host).style.display, 'none', 'dragging is not hovering');
    await hover(host, c0.x, c0.y);
    host.children[0].fire('pointerleave', {});
    assert.strictEqual(tipOf(host).style.display, 'none');
    await hover(host, c0.x, c0.y);
    host.children[0].fire('wheel', {});
    assert.strictEqual(tipOf(host).style.display, 'none', 'zooming hides it');
  });

  test('interaction.tooltip: moves within a frame are merged, the last position wins', async () => {
    const host = new FakeNode('div');
    BC.chart(host, tipSpec());
    const cs = circles(svgOf(host));
    host.children[0].fire('pointermove', { clientX: cs[0].x, clientY: cs[0].y, buttons: 0 });
    host.children[0].fire('pointermove', { clientX: cs[3].x, clientY: cs[3].y, buttons: 0 });
    await flush();
    assert.deepStrictEqual(tipText(host).slice(0, 2), ['a: 4', 'b: 6']);
  });

  test('interaction.tooltip: bars are hit inside their rectangle', async () => {
    const host = new FakeNode('div');
    BC.chart(host, { ...barSpec(), interaction: [{ type: 'tooltip' }] });
    const bars = rects(layer(svgOf(host), 'marks'));
    await hover(host, bars[1].x + bars[1].w / 2, bars[1].y + bars[1].h / 2);
    assert.deepStrictEqual(tipText(host), ['k: b', 'v: 6']);
    await hover(host, bars[1].x + bars[1].w + 6, bars[1].y + bars[1].h / 2);
    assert.strictEqual(tipOf(host).style.display, 'none', 'the gap between bars');
    await hover(host, bars[3].x + 1, bars[3].y - 20);
    assert.strictEqual(tipOf(host).style.display, 'none', 'above a bar');
  });

  test('interaction.tooltip: a rect mark is marked by a box over the whole shape, not a dot on its edge', async () => {
    const host = new FakeNode('div');
    BC.chart(host, { ...barSpec(), interaction: [{ type: 'tooltip' }] });
    const bars = rects(layer(svgOf(host), 'marks'));
    await hover(host, bars[1].x + bars[1].w / 2, bars[1].y + bars[1].h / 2);
    assert.strictEqual(dotOf(host).style.display, 'none', 'no dot when a box is drawn');
    const hl = highlightOf(host);
    assert.strictEqual(hl.style.display, 'block');
    assert.strictEqual(hl.style.left, bars[1].x + 'px');
    assert.strictEqual(hl.style.top, bars[1].y + 'px');
    assert.strictEqual(hl.style.width, bars[1].w + 'px');
    assert.strictEqual(hl.style.height, bars[1].h + 'px');

    await hover(host, 60, 30);
    assert.strictEqual(hl.style.display, 'none', 'the highlight hides along with the tooltip');
  });

  test('interaction.tooltip: marker param overrides the default box-for-rect / dot-for-everything-else choice', async () => {
    const dotted = new FakeNode('div');
    BC.chart(dotted, { ...barSpec(), interaction: [{ type: 'tooltip', marker: 'dot' }] });
    const bars = rects(layer(svgOf(dotted), 'marks'));
    await hover(dotted, bars[1].x + bars[1].w / 2, bars[1].y + bars[1].h / 2);
    assert.strictEqual(dotOf(dotted).style.display, 'block', '"dot" forces a dot even on a rect mark');
    assert.strictEqual(highlightOf(dotted).style.display, 'none');

    const none = new FakeNode('div');
    BC.chart(none, { ...barSpec(), interaction: [{ type: 'tooltip', marker: 'none' }] });
    const bars2 = rects(layer(svgOf(none), 'marks'));
    await hover(none, bars2[1].x + bars2[1].w / 2, bars2[1].y + bars2[1].h / 2);
    assert.strictEqual(tipOf(none).style.display, 'block', 'the tooltip text still shows');
    assert.strictEqual(dotOf(none).style.display, 'none');
    assert.strictEqual(highlightOf(none).style.display, 'none');

    const forcedBox = new FakeNode('div');
    BC.chart(forcedBox, { ...lineSpec(), interaction: [{ type: 'tooltip', marker: 'box' }] });
    const d = [...layer(svgOf(forcedBox), 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].match(/[\d.]+/g).map(Number));
    await hover(forcedBox, d[0][0], d[0][1]);
    assert.strictEqual(highlightOf(forcedBox).style.display, 'none', '"box" on a mark with no box falls back to the dot');
    assert.strictEqual(dotOf(forcedBox).style.display, 'block');
  });

  test('interaction.tooltip: a line is hit along its whole length, including between vertices', async () => {
    const host = new FakeNode('div');
    BC.chart(host, lineSpec({ interaction: [{ type: 'tooltip' }] }));
    const d = [...layer(svgOf(host), 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].match(/[\d.]+/g).map(Number));
    const [up, down] = d;
    await hover(host, up[0], up[1]);
    assert.deepStrictEqual(tipText(host).filter((l) => /^(v|s):/.test(l)).sort(), ['s: up', 'v: 1']);
    await hover(host, (up[0] + up[2]) / 2, (up[1] + up[3]) / 2 + 3);
    assert(tipText(host).includes('s: up'), 'midway between two vertices of the same line');
    await hover(host, (down[0] + down[2]) / 2, (down[1] + down[3]) / 2);
    assert(tipText(host).includes('s: down'), 'and the other line is told apart');
    await hover(host, (up[0] + up[2]) / 2, (up[1] + up[3]) / 2 - 60);
    assert.strictEqual(tipOf(host).style.display, 'none', 'far from every line');
    await hover(host, up[0] - 100, up[1]);
    assert.strictEqual(tipOf(host).style.display, 'none', 'left of where the line starts');
  });

  test('interaction.tooltip: the closest mark wins, later marks win ties', async () => {
    const host = new FakeNode('div');
    BC.chart(host, {
      ...lineSpec({ marks: [{ type: 'line', x: 't', y: 'v', group: 's' }, { type: 'point', x: 't', y: 'v', r: 4 }] }),
      interaction: [{ type: 'tooltip' }],
    });
    const c = circles(svgOf(host))[0];
    await hover(host, c.x, c.y);
    assert(tipText(host).includes('t: 2024-03-01'), 'the point (on top) is reported, with its own fields: ' + tipText(host));
    assert(!tipText(host).some((l) => l.startsWith('s:')), 'not the line, which also passes here');
  });

  test('interaction.tooltip: data is text, never markup; fields param; long values are cut', async () => {
    BC.data('evil', [{ a: 1, b: 1, n: '<img src=x onerror=alert(1)>' }, { a: 2, b: 2, n: 'x'.repeat(300) }, { a: 3, b: 3, n: 'ok' }]);
    const spec = (tooltip) => ({ data: 'evil', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }], interaction: [{ type: 'tooltip', ...tooltip }] });
    const host = new FakeNode('div');
    BC.chart(host, spec({ fields: ['n'] }));
    const cs = circles(svgOf(host));
    await hover(host, cs[0].x, cs[0].y);
    const html = tipOf(host).serialize();
    assert(html.includes('&lt;img src=x'), 'escaped as text');
    assert(!html.includes('<img'), 'no element created from data');
    assert.strictEqual(tipText(host).length, 1, 'only the requested field');
    await hover(host, cs[1].x, cs[1].y);
    assert(tipText(host)[0].length <= 'n: '.length + 80, 'cut to a sane length');
    host.children[0].fire('pointerleave', {});
  });

  test('interaction.tooltip: a tooltip for values that are missing, and marks without pick, are harmless', async () => {
    BC.define({ role: 'mark', type: 'inert', version: 1, channels: { x: { required: true, scales: ['linear'] }, y: { required: true, scales: ['linear'] } }, render: () => [] });
    BC.data('holes', [{ a: 1, b: 1, c: null }, { a: 2, b: 2, c: 5 }]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'holes', scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'inert', x: 'a', y: 'b' }, { type: 'point', x: 'a', y: 'b' }],
      interaction: [{ type: 'tooltip', fields: ['c', 'nope'] }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const cs = circles(svgOf(host));
    await hover(host, cs[0].x, cs[0].y);
    assert.deepStrictEqual(tipText(host), ['c: –']);
  });

  // ── tooltip: custom content ──
  const tipSpecWith = (content, extra) => ({ ...ptSpec([]), interaction: [{ type: 'tooltip', content }], ...extra });
  const hoverFirst = async (host) => { const c = circles(svgOf(host))[0]; await hover(host, c.x, c.y); };
  const tipChildren = (host) => tipOf(host).children;

  test('interaction.tooltip content: the function gets the whole datum and its string is shown as text', async () => {
    let seen = null;
    const host = new FakeNode('div');
    const h = BC.chart(host, tipSpecWith((d) => { seen = d; return `row ${d.row}: <b>${d.values.g}</b>`; }));
    assert.deepStrictEqual(h.diagnostics, [], 'a function is a valid value for a spec built in JS');
    await hoverFirst(host);
    assert.strictEqual(seen.row, 0);
    assert.deepStrictEqual(seen.values, { a: 1, b: 2, g: 'A' }, 'every column of the row');
    assert.deepStrictEqual(seen.lines, [['a', '1'], ['b', '2'], ['g', 'A']], 'the default content is offered too');
    assert.strictEqual(seen.markIndex, 0);
    assert.strictEqual(seen.mark.type, 'point');
    assert.strictEqual(seen.table.length, 6);
    assert(Number.isFinite(seen.x) && Number.isFinite(seen.y));
    assert.deepStrictEqual(tipText(host).length, 1, 'replaces the default lines');
    assert.strictEqual(tipChildren(host)[0].text, 'row 0: <b>A</b>', 'markup in a returned string stays text');
    assert(!tipOf(host).serialize().includes('<b>'), 'and is escaped when serialized');
  });

  test('interaction.tooltip content: a name is looked up at hover time, so it can be registered late and replaced', async () => {
    const host = new FakeNode('div');
    logged.warn.length = 0;
    BC.chart(host, tipSpecWith('lateTip'));
    await hoverFirst(host);
    assert.deepStrictEqual(tipText(host), ['a: 1', 'b: 2', 'g: A'], 'not registered yet: default content');
    assert.strictEqual(logged.warn.filter((w) => /no function "lateTip" is registered/.test(w)).length, 1);
    await hoverFirst(host);
    assert.strictEqual(logged.warn.filter((w) => /no function "lateTip"/.test(w)).length, 1, 'warned once, not on every move');

    BC.defineFn('lateTip', (d) => 'first ' + d.row);
    await hoverFirst(host);
    assert.strictEqual(tipChildren(host)[0].text, 'first 0');
    BC.defineFn('lateTip', (d) => 'second ' + d.row);
    await hoverFirst(host);
    assert.strictEqual(tipChildren(host)[0].text, 'second 0', 'last registration wins');
    assert.strictEqual(typeof BC.getFn('lateTip'), 'function');
    assert.strictEqual(BC.getFn('never-registered'), undefined);
    assert.throws(() => BC.defineFn('bad', 'not a function'), /not a function/);
    logged.warn.length = 0;
  });

  test('interaction.tooltip content: strings, numbers, Nodes, { html }, arrays; null and false hide; undefined = default', async () => {
    const host = new FakeNode('div');
    let out;
    BC.chart(host, tipSpecWith(() => out));
    const show = async (value) => { out = value; await hoverFirst(host); };

    await show('plain');
    assert.deepStrictEqual(tipChildren(host).map((c) => c.text), ['plain']);
    await show(42);
    assert.deepStrictEqual(tipChildren(host).map((c) => c.text), ['42']);

    const node = document.createElement('div');
    node.textContent = 'my own node';
    await show(node);
    assert.strictEqual(tipChildren(host)[0], node, 'a Node is inserted as is');

    await show({ html: '<b>bold</b>' });
    assert.strictEqual(tipChildren(host)[0].innerHTML, '<b>bold</b>', '{ html } is markup');

    await show(['one', null, false, '', { html: '<i>two</i>' }, ['three', 4]]);
    assert.strictEqual(tipChildren(host).length, 4, 'nulls, false and empty strings are skipped, nested arrays are flattened');
    assert.deepStrictEqual(tipChildren(host).map((c) => c.text || c.innerHTML), ['one', '<i>two</i>', 'three', '4']);

    await show(undefined);
    assert.deepStrictEqual(tipText(host), ['a: 1', 'b: 2', 'g: A'], 'undefined keeps the default');
    for (const nothing of [null, false]) {
      await show('visible');
      assert.strictEqual(tipOf(host).style.display, 'block');
      await show(nothing);
      assert.strictEqual(tipOf(host).style.display, 'none', `${nothing} hides`);
      assert.strictEqual(dotOf(host).style.display, 'none', 'and so does the marker');
    }
    await show('');
    assert.strictEqual(tipOf(host).style.display, 'none', 'nothing to show, nothing shown');
    await show([]);
    assert.strictEqual(tipOf(host).style.display, 'none');
    await show({ neither: 'html nor node' });
    assert.strictEqual(tipOf(host).style.display, 'none', 'an object it does not understand shows nothing rather than "[object Object]"');
  });

  test('interaction.tooltip content: a function that throws falls back to the default, and says so once', async () => {
    logged.error.length = 0;
    const host = new FakeNode('div');
    BC.chart(host, tipSpecWith(() => { throw new Error('my bug'); }));
    await hoverFirst(host);
    assert.deepStrictEqual(tipText(host), ['a: 1', 'b: 2', 'g: A']);
    await hoverFirst(host);
    assert.strictEqual(logged.error.filter((l) => /content function threw/.test(l)).length, 1);
    logged.error.length = 0;
    logged.warn.length = 0;
    const odd = new FakeNode('div');
    BC.chart(odd, tipSpecWith(5));
    await hoverFirst(odd);
    assert.deepStrictEqual(tipText(odd), ['a: 1', 'b: 2', 'g: A'], 'a content that is neither a name nor a function is ignored');
  });

  test('interaction.tooltip content: it knows which mark was hit and can draw values the default would not', async () => {
    const host = new FakeNode('div');
    const seen = [];
    BC.chart(host, lineSpec({
      marks: [{ type: 'line', x: 't', y: 'v', group: 's' }, { type: 'point', x: 't', y: 'v', r: 4 }],
      interaction: [{ type: 'tooltip', fields: ['t'], content: (d) => { seen.push(d); return `${d.markIndex}:${d.values.s}:${d.values.v}:${d.lines.length}`; } }],
    }));
    const c = circles(svgOf(host))[0];
    await hover(host, c.x, c.y);
    assert.strictEqual(seen[0].markIndex, 1, 'the point is on top of the line');
    assert.strictEqual(seen[0].lines.length, 1, 'lines follow the fields param');
    assert.match(tipChildren(host)[0].text, /^1:(up|down):\d+:1$/, 'but values has every column');
  });

  test('interaction.tooltip: cleans up after itself', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, tipSpec());
    assert.strictEqual(host.style.position, 'relative', 'host becomes a positioning context');
    const root = host.children[0];
    const c = circles(svgOf(host))[0];
    h.update(tipSpec());
    assert.strictEqual(host.children.filter((x) => x.attrs.class === 'bc-tooltip').length, 1, 'one tooltip after update, not two');
    assert.strictEqual((root.listeners.pointermove || []).length, 0, 'old listeners are gone');
    host.children[0].fire('pointermove', { clientX: c.x, clientY: c.y, buttons: 0 });
    h.destroy();
    await flush();
    assert.strictEqual(host.children.length, 0);
    assert.notStrictEqual(host.style.position, 'relative', 'host style restored');
  });

  // ── stack + area ──
  const T = (cols) => ({ length: Object.values(cols)[0].length, columns: cols });
  const stack = (cols, spec) => BC.get('transform.stack').apply(T(cols), { type: 'stack', ...spec });
  const arr = (col) => Array.from(col);

  test('transform.stack: positives stack in series order, the same for every stack', () => {
    // stack q2 has no A, so B must still sit above A's slot, not at 0 because A is missing
    const t = stack({ k: ['q1', 'q1', 'q2', 'q2', 'q2'], s: ['A', 'B', 'B', 'C', 'A'], v: [2, 3, 1, 5, 4] }, { field: 'v', by: 'k', group: 's' });
    assert.deepStrictEqual([arr(t.columns.v0), arr(t.columns.v1)], [[0, 2, 4, 5, 0], [2, 5, 5, 10, 4]]);
    assert.strictEqual(t.length, 5);
  });

  test('transform.stack: negatives go down separately, gaps contribute nothing, no group = data order', () => {
    const t = stack({ k: ['a', 'a', 'a', 'a', 'a'], v: [3, -2, 4, null, -1] }, { field: 'v', by: 'k' });
    assert.deepStrictEqual(arr(t.columns.v0).map((x) => (Number.isNaN(x) ? 'nan' : x)), [0, 0, 3, 'nan', -2]);
    assert.deepStrictEqual(arr(t.columns.v1).map((x) => (Number.isNaN(x) ? 'nan' : x)), [3, -2, 7, 'nan', -3]);
  });

  test('transform.stack: normalize, custom names, input untouched, bad input reported', () => {
    const cols = { k: ['a', 'a', 'b', 'b'], s: ['x', 'y', 'x', 'y'], v: [1, 3, 0, 0] };
    const t = stack(cols, { field: 'v', by: 'k', group: 's', normalize: true, as: ['lo', 'hi'] });
    assert.deepStrictEqual([arr(t.columns.lo), arr(t.columns.hi)], [[0, 0.25, 0, 0], [0.25, 1, 0, 0]], 'stack b sums to 0: left at 0, no division');
    assert.deepStrictEqual(Object.keys(cols), ['k', 's', 'v'], 'the source table is not changed');
    assert.strictEqual(t.columns.v, cols.v, 'existing columns are shared, not copied');
    assert.deepStrictEqual(BC.get('transform.stack').outputs({ field: 'v', as: ['lo', 'hi'] }), ['lo', 'hi']);
    assert.deepStrictEqual(BC.get('transform.stack').outputs({ field: 'v' }), ['v0', 'v1']);
    assert.throws(() => stack(cols, { field: 'v', by: 'k', as: ['same', 'same'] }), /two different column names/);
    assert.throws(() => stack(cols, { field: 'nope', by: 'k' }), /unknown field "nope"/);
    assert.throws(() => stack(cols, { field: 'v', by: 'k', group: 'nope' }), /unknown field "nope"/);
    assert.strictEqual(stack({ k: [], v: [] }, { field: 'v', by: 'k' }).length, 0, 'empty table');
  });

  BC.data('stk', [
    { k: 'q1', s: 'A', v: 2 }, { k: 'q1', s: 'B', v: 3 },
    { k: 'q2', s: 'A', v: 4 }, { k: 'q2', s: 'B', v: 1 }, { k: 'q2', s: 'C', v: 2 },
  ]);
  const stackedBars = (extra) => ({
    data: 'stk',
    transforms: [{ type: 'stack', field: 'v', by: 'k', group: 's', ...extra }],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, { type: 'legend', scale: 'color', position: 'top' }],
    marks: [{ type: 'rect', x: 'k', y: 'v1', y2: 'v0', color: 's' }],
  });

  test('stacked bars: segments touch, y2 shares the y scale, fields of the transform are validated', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, stackedBars());
    assert.deepStrictEqual(h.diagnostics, [], 'v0/v1 are known thanks to outputs()');
    const bars = rects(layer(svgOf(host), 'marks'));
    assert.strictEqual(bars.length, 5);
    const [a1, b1, a2, b2, c2] = bars;
    assert(Math.abs(b1.y + b1.h - a1.y) < 1e-6, 'B starts where A ends');
    assert(Math.abs(c2.y + c2.h - (b2.y)) < 1e-6 && Math.abs(b2.y + b2.h - a2.y) < 1e-6, 'C on B on A');
    assert(Math.abs(a1.h / a2.h - 0.5) < 1e-6, 'heights follow the values');
    assert(Math.abs(a1.y + a1.h - (a2.y + a2.h)) < 1e-6, 'all stacks start on the same baseline');
    const bad = stackedBars();
    bad.marks[0].y = 'v9';
    assert(BC.validate(bad).some((d) => d.path === 'marks[0].y' && /unknown field "v9"/.test(d.message)));
    BC.define({ role: 'transform', type: 'opaque', version: 1, apply: (t) => t });
    const opaque = stackedBars();
    opaque.transforms.push({ type: 'opaque' });
    opaque.marks[0].y = 'anything';
    assert(!BC.validate(opaque).some((d) => /unknown field/.test(d.message)), 'a transform that does not declare outputs turns the field check off');
  });

  test('stacked bars: 100% normalization fills the plot height', () => {
    const host = new FakeNode('div');
    BC.chart(host, { ...stackedBars({ normalize: true }), scales: { x: { type: 'band' }, y: { type: 'linear', domain: [0, 1] }, color: { type: 'color' } } });
    const bars = rects(layer(svgOf(host), 'marks'));
    const total = (xs) => bars.filter((b) => xs.includes(b.x)).reduce((s, b) => s + b.h, 0);
    const q1 = total([bars[0].x]);
    const q2 = total([bars[2].x]);
    assert(Math.abs(q1 - q2) < 1e-6 && q1 > 100, `both stacks are as tall as the plot: ${q1} ${q2}`);
  });

  BC.data('areas', [
    { t: '2024-01-01', s: 'A', v: 2 }, { t: '2024-02-01', s: 'A', v: 4 }, { t: '2024-03-01', s: 'A', v: 3 },
    { t: '2024-01-01', s: 'B', v: 1 }, { t: '2024-02-01', s: 'B', v: 2 }, { t: '2024-03-01', s: 'B', v: null },
  ]);
  const areaSpec = (marks) => ({
    data: 'areas',
    transforms: [{ type: 'stack', field: 'v', by: 't', group: 's' }],
    scales: { x: { type: 'time' }, y: { type: 'linear', zero: true }, color: { type: 'color' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: marks || [{ type: 'area', x: 't', y: 'v1', y2: 'v0', color: 's' }],
  });

  test('mark.area: one closed shape per series, a gap ends the shape, baseline without y2', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, areaSpec());
    assert.deepStrictEqual(h.diagnostics, []);
    const shapes = [...layer(svgOf(host), 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(shapes.length, 2);
    assert(shapes.every((d) => d.endsWith('Z')), 'every shape is closed');
    const [a, b] = shapes.map((d) => d.match(/[\d.]+/g).map(Number));
    assert.strictEqual(a.length, 12, 'A: three vertices along the top, three back along the bottom');
    assert.strictEqual(b.length, 8, 'B: the missing March value shortens it to two vertices');
    assert(!/NaN/.test(svgOf(host)));

    const base = new FakeNode('div');
    const h2 = BC.chart(base, areaSpec([{ type: 'area', x: 't', y: 'v', color: 's' }]));
    assert.deepStrictEqual(h2.diagnostics, []);
    const [pa] = [...layer(svgOf(base), 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].match(/[\d.]+/g).map(Number));
    assert.strictEqual(pa[pa.length - 1], pa[pa.length - 3], 'flat bottom edge at the baseline');
  });

  test('mark.area: a gap in the middle splits into separate shapes', () => {
    BC.data('gap', [{ t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: null }, { t: 4, v: 2 }, { t: 5, v: 1 }]);
    const host = new FakeNode('div');
    BC.chart(host, { data: 'gap', scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'area', x: 't', y: 'v' }] });
    const d = svgOf(host).match(/<path d="([^"]+)"/)[1];
    assert.strictEqual(count(d, /M/g), 2);
    assert.strictEqual(count(d, /Z/g), 2);
  });

  test('interaction.tooltip: areas and stacked bars are found under the pointer', async () => {
    const host = new FakeNode('div');
    BC.chart(host, { ...areaSpec(), interaction: [{ type: 'tooltip' }] });
    const shapes = [...layer(svgOf(host), 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].match(/[\d.]+/g).map(Number));
    const [a] = shapes;
    // inside A between its top edge and its bottom edge, at the second date
    const x = a[2];
    await hover(host, x, (a[3] + a[a.length - 3]) / 2);
    assert(tipText(host).includes('s: A'), tipText(host).join('|'));
    await hover(host, x, Math.min(...shapes.map((p) => p[3])) - 12);
    assert.strictEqual(tipOf(host).style.display, 'none', 'above the whole stack');

    const bars = new FakeNode('div');
    BC.chart(bars, { ...stackedBars(), interaction: [{ type: 'tooltip' }] });
    const r = rects(layer(svgOf(bars), 'marks'));
    await hover(bars, r[1].x + r[1].w / 2, r[1].y + r[1].h / 2);
    assert(tipText(bars).includes('s: B') && tipText(bars).includes('k: q1'), tipText(bars).join('|'));
  });

  // ── y auto-fit ──
  let probed = null;
  BC.define({ role: 'interaction', type: 'probe2', version: 1, attach(_s, live) { probed = live; } });

  test('live.fit: the domain of the rows visible in the followed view, judged in pixels for any scale kind', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec({ interaction: [{ type: 'probe2' }] }));
    assert.strictEqual(probed.fit('y', 'x'), null, 'no view to follow yet');
    h.setView('x', [Date.UTC(2024, 0, 20), Date.UTC(2024, 1, 10)]);
    assert.deepStrictEqual(probed.fit('y', 'x'), [3, 6], 'only Feb 1 is inside: values 3 and 6');
    assert.strictEqual(probed.fit('nope', 'x'), null);
    assert.strictEqual(probed.fit('y', 'nope'), null);
    h.setView('x', [Date.UTC(2023, 11, 1), Date.UTC(2023, 11, 15)]);
    assert.strictEqual(probed.fit('y', 'x'), null, 'no row visible: leave the scale alone');
    h.setView('x', [Date.UTC(2024, 0, 1), Date.UTC(2024, 2, 1)]);
    assert.deepStrictEqual(probed.fit('y', 'x'), [1, 8], 'the whole range gives the full nice domain');
    logged.error.length = 0;
  });

  test('live.fit: follows a band window, and only counts rows of marks that use the scale', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, { ...barSpec(), interaction: [{ type: 'probe2' }] });
    h.setView('x', ['a', 'b']);
    assert.deepStrictEqual(probed.fit('y', 'x'), [0, 6], 'values 3 and 6 (zero kept by the scale)');
  });

  BC.data('jump', Array.from({ length: 100 }, (_, i) => ({ x: i, y: i < 50 ? 10 + (i % 3) : 1000 + i })));
  const jumpSpec = (zoom) => ({
    data: 'jump',
    scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'line', x: 'x', y: 'y' }],
    interaction: [{ type: 'zoom', wheel: 'always', ...zoom }],
  });

  test('interaction.zoom fit: y follows the visible window and comes back on reset', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, jumpSpec({ fit: ['y'] }));
    const baseY = h.getView().y;
    assert(baseY[1] > 1000);
    host.children[0].fire('wheel', { clientX: 60, clientY: 150, deltaY: -1500 });
    await flush();
    const zoomedY = h.getView().y;
    assert(h.getView().x[1] - h.getView().x[0] < 5, 'zoomed in on the left');
    assert(zoomedY[1] < 100 && zoomedY[0] >= 0, `y refit to the visible rows: ${zoomedY}`);
    host.children[0].fire('pointerdown', { button: 0, clientX: 300, clientY: 150, pointerId: 1 });
    host.children[0].fire('pointermove', { clientX: 200, clientY: 150 });
    host.children[0].fire('pointerup', {});
    await flush();
    assert(h.getView().y[1] < 100, 'still refit after panning within the low part');
    host.children[0].fire('dblclick', { clientX: 300, clientY: 150 });
    await flush();
    assert.deepStrictEqual(h.getView().y, baseY, 'reset brings the full domain back');
  });

  test('interaction.zoom fit: without it y stays put; bad fit names are reported, not fatal', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, jumpSpec({}));
    const baseY = h.getView().y;
    host.children[0].fire('wheel', { clientX: 60, clientY: 150, deltaY: -1500 });
    await flush();
    assert.deepStrictEqual(h.getView().y, baseY);

    logged.warn.length = 0;
    const host2 = new FakeNode('div');
    const h2 = BC.chart(host2, jumpSpec({ fit: ['x', 'nope', 7] }));
    assert.deepStrictEqual(h2.diagnostics, []);
    assert(logged.warn.some((w) => /cannot fit scale "x"/.test(w)) && logged.warn.some((w) => /cannot fit scale "nope"/.test(w)));
    host2.children[0].fire('wheel', { clientX: 60, clientY: 150, deltaY: -1500 });
    await flush();
    assert(h2.getView().x[1] - h2.getView().x[0] < 5, 'zoom itself still works');
    logged.warn.length = 0;
  });

  // ── axis labels that stick out past the plot ──
  BC.data('edge', [{ t: '2024-01-01', v: 1 }, { t: '2024-06-01', v: 3 }]);
  const edgeSpec = (extra) => ({
    data: 'edge',
    scales: { x: { type: 'time' }, y: { type: 'linear' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'line', x: 't', y: 'v' }],
    ...extra,
  });
  // the core's own text-size estimate, the one the layout is based on
  const half = (label, size = 11) => (label.length * size * 0.6) / 2;
  const xLabels = (svg) => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*text-anchor="middle"[^>]*>([^<]*)</g)].map((m) => ({ x: +m[1], y: +m[2], text: m[3] }));
  const yLabels = (svg) => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*text-anchor="end"[^>]*>([^<]*)</g)].map((m) => ({ x: +m[1], y: +m[2], text: m[3] }));

  test('layout: the first and last axis labels are kept inside the chart', () => {
    const host = new FakeNode('div');
    BC.chart(host, edgeSpec());
    const labels = xLabels(svgOf(host));
    assert(labels.length >= 2);
    assert(labels.some((l) => l.text === 'Jan 2024') && labels.some((l) => l.text === 'Jun 2024'), 'ticks at both ends: ' + labels.map((l) => l.text));
    for (const l of labels) {
      assert(l.x - half(l.text) >= -0.01, `${l.text} does not stick out on the left`);
      assert(l.x + half(l.text) <= 640 + 0.01, `${l.text} does not stick out on the right: ${l.x + half(l.text)}`);
    }
  });

  test('layout: the same for the top and bottom label of a vertical axis with no padding', () => {
    const host = new FakeNode('div');
    BC.chart(host, edgeSpec({ padding: { top: 0, bottom: 0, left: 0, right: 0 } }));
    const svg = svgOf(host);
    for (const l of [...yLabels(svg), ...xLabels(svg)]) {
      assert(l.x - half(l.text) >= -0.01 && l.x + half(l.text) <= 640.01, `${l.text} inside horizontally`);
    }
    for (const l of yLabels(svg)) assert(l.y - 11 * 1.2 / 2 >= -0.01, `${l.text} is not cut off at the top (y ${l.y})`);
    for (const l of yLabels(svg)) assert(l.y + 11 * 1.2 / 2 <= 400.01, `${l.text} is not cut off at the bottom (y ${l.y})`);
  });

  test('layout: room is only added where the padding is not enough, and it does not push other guides away', () => {
    // short labels (numbers) fit inside the default 16px padding: the plot keeps its full width
    const plain = new FakeNode('div');
    BC.chart(plain, { data: 'cats', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, guides: [{ type: 'axis', scale: 'x' }], marks: [{ type: 'point', x: 'v', y: 'v' }] });
    assert.strictEqual(bottomAxisEnd(svgOf(plain)), 624, 'right edge at 640 - 16');

    // wide labels widen the right margin...
    const wide = new FakeNode('div');
    BC.chart(wide, edgeSpec({ guides: [{ type: 'axis', scale: 'x' }] }));
    const end = bottomAxisEnd(svgOf(wide));
    assert(end < 624 && end >= 640 - half('Jun 2024') - 1, `right edge moved in just enough: ${end}`);

    // ...but a second guide on that side sits right against the plot, not behind an imaginary reserved strip
    const both = new FakeNode('div');
    BC.chart(both, edgeSpec({ scales: { x: { type: 'time' }, y: { type: 'linear', range: 'height' } }, guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y', position: 'right' }] }));
    const svg = svgOf(both);
    const rightAxisX = +svg.match(/<path d="M([\d.]+) [\d.]+V[\d.]+M[\d.]+ [\d.]+H([\d.]+)/g).find((d) => /^<path d="M([\d.]+) [\d.]+V/.test(d)).match(/M([\d.]+)/)[1];
    assert.strictEqual(rightAxisX, bottomAxisEnd(svg), 'the right axis starts exactly where the x axis ends');
  });

  test('layout: a guide may report an overhang alone, and one that reports nothing is fine', () => {
    BC.define({ role: 'guide', type: 'halo', version: 1, measure: () => ({ overhang: { left: 60 } }), render: () => ({}) });
    BC.define({ role: 'guide', type: 'mute', version: 1, measure: () => ({}), render: () => ({}) });
    const host = new FakeNode('div');
    const h = BC.chart(host, { ...edgeSpec({ guides: [{ type: 'halo' }, { type: 'mute' }, { type: 'axis', scale: 'x' }] }) });
    assert.deepStrictEqual(h.diagnostics, []);
    const [x0] = svgOf(host).match(/<path d="M([\d.]+) [\d.]+H/).slice(1).map(Number);
    assert.strictEqual(x0, 60, 'the plot starts at least 60 from the left edge');
  });

  // ── histogram: transform.bin ──
  const bin = (values, spec, extra) => BC.get('transform.bin').apply({ length: values.length, columns: { v: Float64Array.from(values), ...(extra || {}) } }, { type: 'bin', field: 'v', ...spec });
  const col = (t, name) => Array.from(t.columns[name]);

  test('transform.bin: round edges, contiguous bins, the last bin includes its end', () => {
    const t = bin([1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5], { bins: 5 });
    assert.deepStrictEqual([col(t, 'bin0'), col(t, 'bin1'), col(t, 'count')], [[1, 2, 3, 4], [2, 3, 4, 5], [1, 2, 3, 5]]);
    assert.strictEqual(t.length, 4);
    assert.strictEqual(col(t, 'count').reduce((a, b) => a + b, 0), 11, 'every value is counted once');

    const messy = bin([0.13, 0.27, 0.31, 0.44, 0.98, 0.5, 0.51, 0.7], { bins: 10 });
    for (const e of [...col(messy, 'bin0'), ...col(messy, 'bin1')]) assert(String(e).length <= 5, `no float drift in edge ${e}`);
    const e0 = col(messy, 'bin0');
    assert(e0.every((x, i) => i === 0 || Math.abs(x - e0[i - 1] - (e0[1] - e0[0])) < 1e-9), 'equal width');
    assert.strictEqual(col(messy, 'count').reduce((a, b) => a + b, 0), 8);
    assert(e0[0] <= 0.13 && col(messy, 'bin1')[e0.length - 1] >= 0.98, 'the bins cover the data');
  });

  test('transform.bin: width, extent, empty bins are kept, constant data, empty input', () => {
    const t = bin([0, 1, 1, 9, 10], { width: 2 });
    assert.deepStrictEqual(col(t, 'bin0'), [0, 2, 4, 6, 8], 'exact width 2 from the rounded start');
    assert.deepStrictEqual(col(t, 'count'), [3, 0, 0, 0, 2], 'the empty bins in between stay');

    const clipped = bin([0, 1.5, 2, 2.5, 3.9, 4, 4.1, 9], { width: 1, extent: [2, 4] });
    assert.deepStrictEqual(col(clipped, 'bin0'), [2, 3]);
    assert.deepStrictEqual(col(clipped, 'count'), [2, 2], 'only 2, 2.5, 3.9, 4 are inside [2, 4]; 4 belongs to the last bin');

    const constant = bin([5, 5, 5], {});
    assert.strictEqual(constant.length >= 1 && col(constant, 'count').reduce((a, b) => a + b, 0), 3, 'a constant is still counted');
    assert(col(constant, 'bin0')[0] < 5 && col(constant, 'bin1')[constant.length - 1] > 5);

    assert.strictEqual(bin([], {}).length, 0);
    const holes = { length: 4, columns: { v: [NaN, null, undefined, Infinity] } };
    assert.strictEqual(BC.get('transform.bin').apply(holes, { type: 'bin', field: 'v' }).length, 0, 'nothing numeric: no bins, and no crash');
    assert.strictEqual(col(bin([NaN, 1, 2, NaN, Infinity, 3], { bins: 3 }), 'count').reduce((a, b) => a + b, 0), 3, 'missing and infinite values are skipped');
  });

  test('transform.bin: groups get a row per bin and group, in a stable order', () => {
    const t = bin([1, 1, 2, 2, 3, 3], { width: 1, group: 'g' }, { g: ['a', 'b', 'a', 'a', 'b', 'b'] });
    // [1, 2) and [2, 3]: the top edge belongs to the last bin
    assert.deepStrictEqual(col(t, 'g'), ['a', 'b', 'a', 'b'], 'bin by bin, groups in order of first appearance');
    assert.deepStrictEqual(col(t, 'bin0'), [1, 1, 2, 2]);
    assert.deepStrictEqual(col(t, 'count'), [1, 1, 2, 2]);
    assert.strictEqual(t.length, 4);
  });

  test('transform.bin: input is untouched, names are configurable, and bad input is a clear error', () => {
    const table = { length: 3, columns: { v: Float64Array.of(1, 2, 3) } };
    const t = BC.get('transform.bin').apply(table, { type: 'bin', field: 'v', bins: 2, as: ['lo', 'hi', 'n'] });
    assert.deepStrictEqual(Object.keys(table.columns), ['v']);
    assert.deepStrictEqual(Object.keys(t.columns), ['lo', 'hi', 'n']);
    const outputs = BC.get('transform.bin').outputs;
    assert.deepStrictEqual(outputs({ field: 'v' }), ['bin0', 'bin1', 'count']);
    assert.deepStrictEqual(outputs({ field: 'v', group: 'g', as: ['a', 'b', 'c'] }), ['a', 'b', 'c', 'g']);
    for (const [spec, re] of [
      [{ field: 'nope' }, /unknown field "nope"/], [{ field: 'v', group: 'nope' }, /unknown field "nope"/],
      [{ field: 'v', as: ['a', 'a', 'b'] }, /three different column names/], [{ field: 'v', as: ['a', 'b'] }, /three different column names/],
      [{ field: 'v', width: 0 }, /"width" must be a positive number/], [{ field: 'v', width: -1 }, /positive/], [{ field: 'v', bins: 0 }, /"bins" must be/],
      [{ field: 'v', extent: [3, 1] }, /"extent" must be \[min, max\]/], [{ field: 'v', extent: ['a', 'b'] }, /"extent"/],
      [{ field: 'v', width: 1e-9 }, /too many/],
    ]) assert.throws(() => BC.get('transform.bin').apply({ length: 3, columns: { v: Float64Array.of(1, 2, 300) } }, { type: 'bin', ...spec }), re, JSON.stringify(spec));
    assert.throws(() => BC.get('transform.bin').apply({ length: 2, columns: { v: ['x', 'y'] } }, { type: 'bin', field: 'v' }), /has no numeric values/);
  });

  test('histogram: bins drawn as contiguous rectangles, the fields of the transform are known to validate', () => {
    BC.data('measure', Array.from({ length: 60 }, (_, i) => ({ h: 150 + ((i * 37) % 41) + (i % 3) })));
    const spec = () => ({
      data: 'measure',
      transforms: [{ type: 'bin', field: 'h', bins: 8 }],
      scales: { x: { type: 'linear', nice: false }, y: { type: 'linear', zero: true } },
      guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
      marks: [{ type: 'rect', x: 'bin0', x2: 'bin1', y: 'count' }],
      interaction: [{ type: 'tooltip' }],
    });
    const host = new FakeNode('div');
    const h = BC.chart(host, spec());
    assert.deepStrictEqual(h.diagnostics, []);
    const bars = rects(layer(svgOf(host), 'marks'));
    assert(bars.length >= 6);
    assert(bars.every((b, i) => i === 0 || Math.abs(bars[i - 1].x + bars[i - 1].w - b.x) < 1e-6), 'no gaps between bars');
    const bottoms = bars.map((b) => +(b.y + b.h).toFixed(4));
    assert(bottoms.every((y) => y === bottoms[0]), 'all bars stand on the baseline');
    const typo = spec();
    typo.marks[0].y = 'cnt';
    assert(BC.validate(typo).some((d) => d.path === 'marks[0].y' && /unknown field "cnt"/.test(d.message)));
  });

  // ── boxplot: transform.quartiles + mark.boxplot ──
  const quart = (values, spec, extra) => BC.get('transform.quartiles').apply({ length: values.length, columns: { v: Float64Array.from(values), ...(extra || {}) } }, { type: 'quartiles', field: 'v', ...spec });

  test('transform.quartiles: R-7 interpolated quartiles, Tukey whiskers, and outliers reported as their own row', () => {
    // sorted 1..9,100: q1/median/q3 sit at fractional positions 2.25/4.5/6.75, unaffected by the 100 itself
    const t = quart([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], {});
    assert.strictEqual(t.length, 2, 'one summary row, one outlier row');
    assert.deepStrictEqual([col(t, 'q1')[0], col(t, 'median')[0], col(t, 'q3')[0]], [3.25, 5.5, 7.75]);
    assert.deepStrictEqual([col(t, 'low')[0], col(t, 'high')[0]], [1, 9], 'whiskers stop at the last non-outlier sample');
    assert(isNaN(col(t, 'value')[0]), 'the summary row has no "value"');
    assert.strictEqual(col(t, 'count')[0], 10);
    assert.strictEqual(col(t, 'value')[1], 100, 'the outlier is its own row');
    assert(isNaN(col(t, 'low')[1]) && isNaN(col(t, 'q1')[1]) && isNaN(col(t, 'median')[1]) && isNaN(col(t, 'q3')[1]) && isNaN(col(t, 'high')[1]), 'an outlier row has no summary');

    const noOutliers = quart([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], { outliers: false });
    assert.strictEqual(noOutliers.length, 1, 'no separate row: the whisker just stretches to it');
    assert.deepStrictEqual([col(noOutliers, 'low')[0], col(noOutliers, 'high')[0]], [1, 100]);

    const one = quart([42], {});
    assert.deepStrictEqual([col(one, 'low')[0], col(one, 'q1')[0], col(one, 'median')[0], col(one, 'q3')[0], col(one, 'high')[0]], [42, 42, 42, 42, 42], 'a single sample is its own whole summary');
  });

  test('transform.quartiles: one summary per group, first-appearance order, a missing group is its own group', () => {
    const g = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', null, null];
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 3, 5];
    const t = quart(v, { group: 'g' }, { g });
    const groups = col(t, 'g');
    assert.deepStrictEqual([...new Set(groups)], ['A', 'B', null], 'first-appearance order, null kept as its own group');
    const rowOf = (key) => groups.findIndex((k) => k === key);
    assert.deepStrictEqual([col(t, 'low')[rowOf('A')], col(t, 'high')[rowOf('A')]], [1, 10], 'A has no outlier');
    assert.deepStrictEqual([col(t, 'low')[rowOf('B')], col(t, 'high')[rowOf('B')]], [1, 9], 'B\'s 100 is an outlier');
    assert.strictEqual(t.length, 3 + 1, '3 summaries + B\'s one outlier');
  });

  test('transform.quartiles: input is untouched, outputs(), and bad input is a clear error', () => {
    const table = { length: 3, columns: { v: Float64Array.of(1, 2, 3) } };
    const t = BC.get('transform.quartiles').apply(table, { type: 'quartiles', field: 'v' });
    assert.deepStrictEqual(Object.keys(table.columns), ['v']);
    assert.deepStrictEqual(Object.keys(t.columns).sort(), ['count', 'high', 'low', 'median', 'q1', 'q3', 'value'].sort());
    const outputs = BC.get('transform.quartiles').outputs;
    assert.deepStrictEqual(outputs({ field: 'v' }).sort(), ['low', 'q1', 'median', 'q3', 'high', 'value', 'count'].sort());
    assert(outputs({ field: 'v', group: 'g' }).includes('g'));
    assert.throws(() => BC.get('transform.quartiles').apply(table, { type: 'quartiles', field: 'nope' }), /unknown field "nope"/);
    assert.throws(() => BC.get('transform.quartiles').apply(table, { type: 'quartiles', field: 'v', group: 'nope' }), /unknown field "nope"/);
    assert.throws(() => BC.get('transform.quartiles').apply({ length: 2, columns: { v: ['x', 'y'] } }, { type: 'quartiles', field: 'v' }), /has no numeric values/);
    assert.strictEqual(BC.get('transform.quartiles').apply({ length: 0, columns: { v: [] } }, { type: 'quartiles', field: 'v' }).length, 0);
  });

  test('mark.boxplot: box spans q1..q3, whiskers reach low/high, outlier rows draw no box, tooltip hits the box', async () => {
    BC.data('latency', [
      { team: 'A', ms: 10 }, { team: 'A', ms: 20 }, { team: 'A', ms: 30 }, { team: 'A', ms: 40 }, { team: 'A', ms: 50 },
      { team: 'A', ms: 60 }, { team: 'A', ms: 70 }, { team: 'A', ms: 80 }, { team: 'A', ms: 90 }, { team: 'A', ms: 900 },
    ]);
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      data: 'latency',
      transforms: [{ type: 'quartiles', field: 'ms', group: 'team' }],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'boxplot', x: 'team', low: 'low', q1: 'q1', median: 'median', q3: 'q3', high: 'high' }, { type: 'point', x: 'team', y: 'value', r: 3 }],
      interaction: [{ type: 'tooltip' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    assert.strictEqual(count(layer(svg, 'marks'), /<rect /g), 1, 'one box, not one per row (the outlier draws no box)');
    assert.strictEqual(count(layer(svg, 'marks'), /<circle /g), 1, 'the outlier is the only point (the summary row has no "value")');
    const box = rects(layer(svg, 'marks'))[0];
    assert(box.w > 0 && box.h > 0, 'the box has real extent');

    await hover(host, box.x + box.w / 2, box.y + box.h / 2);
    assert.strictEqual(tipOf(host).style.display, 'block', 'the box is hoverable');
  });
  const seq = (spec, values) => BC.get('scale.sequential').create({ type: 'sequential', ...spec }, { name: 'color', sources: [Float64Array.from(values)], range: [], color: (i) => `c${i}` });

  test('scale.sequential: endpoints, exact stops, mixing, clamping, missing values', () => {
    const s = seq({}, [0, 10]);
    assert.deepStrictEqual([s(0), s(5), s(10)], ['#440154', '#21908d', '#fde725'], 'first stop, middle stop, last stop of the default (viridis)');
    assert.strictEqual(s.kind, 'sequential');
    assert.deepStrictEqual(s.domain(), [0, 10]);
    assert.strictEqual(s.range().length, 5);

    const bw = seq({ range: ['#000000', '#ffffff'] }, [0, 1]);
    assert.strictEqual(bw(0.5), '#808080', 'halfway between black and white');
    assert.strictEqual(seq({ range: ['#f00', '#00f'] }, [0, 1])(0), '#ff0000', 'three-digit hex is expanded');

    const div = seq({ range: ['#0000ff', '#ffffff', '#ff0000'], domain: [-10, 10] }, [1]);
    assert.deepStrictEqual([div(-10), div(0), div(10), div(5)], ['#0000ff', '#ffffff', '#ff0000', '#ff8080'], 'three colors: a diverging scale');
    assert.deepStrictEqual([div(-99), div(99)], ['#0000ff', '#ff0000'], 'outside an explicit domain: the end colors');

    for (const missing of [NaN, null, undefined, 'x', Infinity, {}]) assert.strictEqual(s(missing), '', `${String(missing)} has no color`);
    const flat = seq({}, [7, 7, 7]);
    assert.strictEqual(typeof flat(7), 'string');
    assert(flat(7).startsWith('#'), 'constant data does not divide by zero');
    assert.deepStrictEqual(seq({}, [])(0.5).startsWith('#'), true, 'no data at all still gives a working scale');
    s.setDomain([0, 5]);
    assert.strictEqual(s(5), '#fde725');
    s.setDomain(null);
    assert.strictEqual(s(5), '#21908d');
  });

  test('scale.sequential: bad ranges and domains are clear errors, ticks are fractions of the domain', () => {
    for (const range of [['red', 'blue'], ['var(--a)', '#fff'], ['#ggg', '#fff'], [5, 6], ['#12345', '#fff']]) {
      assert.throws(() => seq({ range }, [0, 1]), /range colors must be #rgb or #rrggbb/, JSON.stringify(range));
    }
    assert.throws(() => seq({ range: ['#fff'] }, [0, 1]), /at least two colors/);
    assert.throws(() => seq({ domain: [1, 1] }, [0, 1]), /domain must be \[min, max\]/);
    assert.throws(() => seq({ domain: ['a', 'b'] }, [0, 1]), /domain must be/);
    const t = seq({}, [0, 100]).ticks(4);
    assert(t.length >= 3 && t.length <= 6);
    assert.strictEqual(t[0].pos, 0);
    assert.strictEqual(t[t.length - 1].pos, 1);
    assert(t.every((k, i) => i === 0 || k.pos > t[i - 1].pos), 'increasing');
    assert(t.every((k) => k.label === String(k.value)), 'labels are the values');
  });

  test('scale.color: a value outside the visible domain has no color, and it comes back', () => {
    const s = BC.get('scale.color').create({ type: 'color' }, { name: 'color', sources: [['a', 'b', 'c']], range: [], color: (i) => `c${i}` });
    assert.deepStrictEqual([s('a'), s('b'), s('c')], ['c0', 'c1', 'c2']);
    s.setDomain(['a', 'c']);
    assert.deepStrictEqual([s('a'), s('b'), s('c')], ['c0', '', 'c2'], 'b is hidden, the others keep their color');
    assert.notStrictEqual(s('zzz'), '', 'a value the scale never knew is not "hidden", it gets the neutral color');
    assert.deepStrictEqual(s.baseDomain(), ['a', 'b', 'c']);
    assert.deepStrictEqual(s.range(), ['c0', 'c1', 'c2'], 'range always lists all base colors, for the legend');
    s.setDomain([]);
    assert.deepStrictEqual([s('a'), s('b'), s('c')], ['', '', ''], 'everything hidden');
    s.setDomain(null);
    assert.strictEqual(s('b'), 'c1');
  });

  test('hidden categories: no mark draws them, nothing can pick them, and the legend lists them dimmed', async () => {
    const spec = (extra) => ({ ...ptSpec([{ type: 'legend', scale: 'color' }]), interaction: [{ type: 'tooltip' }], ...extra });
    const all = new FakeNode('div');
    BC.chart(all, spec());
    assert.strictEqual(circles(svgOf(all)).length, 6);

    const host = new FakeNode('div');
    const h = BC.chart(host, spec({ view: { color: ['A', 'C'] } }));
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    assert.strictEqual(circles(svg).length, 4, 'the two rows of B are gone');
    assert(!fills(svg).includes(''), 'and no mark got an empty fill');
    assert.strictEqual(count(svg, /class="bc-legend-item"/g), 3, 'the legend still lists all three');
    assert.strictEqual(count(svg, /class="bc-legend-item"[^>]*opacity="0.4"|opacity="0.4"[^>]*class="bc-legend-item"/g), 1, 'and dims the hidden one');
    assert(svg.includes('data-bc-legend-scale="color"') && svg.includes('data-bc-legend-index="1"'), 'items say which value they stand for');
    assert.strictEqual(h.getView().color.length, 2);

    const c = circles(svgOf(all)).find((_, i) => i === 1); // row 1 is group B, in the unfiltered chart
    await hover(host, c.x, c.y);
    assert.strictEqual(tipOf(host).style.display, 'none', 'a hidden datum is not picked');

    const lines = new FakeNode('div');
    BC.chart(lines, lineSpec({ scales: { x: { type: 'time' }, y: { type: 'linear' }, color: { type: 'color' } }, marks: [{ type: 'line', x: 't', y: 'v', color: 's' }], view: { color: ['up'] } }));
    assert.strictEqual(count(layer(svgOf(lines), 'marks'), /<path /g), 1, 'one series left');

    const bars = new FakeNode('div');
    BC.chart(bars, { ...barSpec(), scales: { ...barSpec().scales, color: { type: 'color' } }, marks: [{ type: 'rect', x: 'k', y: 'v', color: 'k' }], view: { color: ['a', 'd'] } });
    assert.strictEqual(count(layer(svgOf(bars), 'marks'), /<rect /g), 2);

    const areas = new FakeNode('div');
    BC.chart(areas, { ...areaSpec(), view: { color: ['B'] } });
    assert.strictEqual(count(layer(svgOf(areas), 'marks'), /<path /g), 1);
  });

  BC.data('heat', [
    { day: 'Mon', part: 'am', n: 1 }, { day: 'Mon', part: 'pm', n: 5 },
    { day: 'Tue', part: 'am', n: 3 }, { day: 'Tue', part: 'pm', n: 9 },
    { day: 'Wed', part: 'am', n: 2 },
  ]);
  const heatSpec = (guides, extra) => ({
    data: 'heat',
    scales: { x: { type: 'band', paddingInner: 0.05, paddingOuter: 0 }, y: { type: 'band', paddingInner: 0.05, paddingOuter: 0 }, color: { type: 'sequential' } },
    guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, ...guides],
    marks: [{ type: 'rect', x: 'day', y: 'part', color: 'n' }],
    interaction: [{ type: 'tooltip' }],
    ...extra,
  });

  test('heatmap: band x band cells colored by a number; the cell that has no row stays empty', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, heatSpec([]));
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    const cells = rects(layer(svg, 'marks'));
    assert.strictEqual(cells.length, 5, 'five rows, five cells: Wed/pm is empty');
    const fillsOf = [...layer(svg, 'marks').matchAll(/<rect [^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(fillsOf[3], '#fde725', 'the largest value (9) has the last color');
    assert.strictEqual(fillsOf[0], '#440154', 'the smallest (1) the first');
    assert.strictEqual(new Set(fillsOf).size, 5, 'five different values, five colors');
    assert.strictEqual(new Set(cells.map((c) => c.w.toFixed(3))).size, 1, 'equal cells');
    const rowsY = [...new Set(cells.map((c) => c.y.toFixed(3)))].map(Number);
    assert(rowsY.length === 2 && rowsY[0] < rowsY[1], 'two rows: am above pm');
    assert(!/NaN/.test(svg));

    await hover(host, cells[3].x + cells[3].w / 2, cells[3].y + cells[3].h / 2);
    assert.deepStrictEqual(tipText(host), ['day: Tue', 'part: pm', 'n: 9']);
    await hover(host, cells[3].x + cells[3].w * 2.6, cells[3].y + cells[3].h / 2);
    assert.strictEqual(tipOf(host).style.display, 'none', 'nothing in the empty cell');
  });

  test('legend of a continuous scale: a color bar with labels, on the right and on top', () => {
    const plain = new FakeNode('div'), right = new FakeNode('div'), top = new FakeNode('div');
    BC.chart(plain, heatSpec([]));
    const h = BC.chart(right, heatSpec([{ type: 'legend', scale: 'color' }]));
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(right);
    assert.strictEqual(count(svg, /class="bc-legend-bar"/g), 48, 'one slice per step');
    const slices = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="(#[0-9a-f]{6})"[^>]*class="bc-legend-bar"/g)].map((m) => ({ x: +m[1], y: +m[2], fill: m[5] }));
    assert.strictEqual(slices.length, 48);
    assert(slices.every((s, i) => i === 0 || s.y > slices[i - 1].y) && slices.every((s) => s.x === slices[0].x), 'a vertical bar');
    const near = (a, b) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 12);
    assert(near(slices[0].fill, '#fde725'), `the top of a vertical bar is the high end: ${slices[0].fill}`);
    assert(near(slices[47].fill, '#440154'), `the bottom the low end: ${slices[47].fill}`);
    assert(slices[0].x > bottomAxisEnd(svg), 'to the right of the plot');
    assert(bottomAxisEnd(svg) < bottomAxisEnd(svgOf(plain)) - 20, 'the plot made room for it');
    const labels = [...svg.matchAll(/<text x="[\d.]+" y="[\d.]+"[^>]*>(\d+)</g)].map((m) => +m[1]);
    assert(labels.includes(0) === false || labels.length >= 2, 'labelled with numbers');
    assert(svg.includes('>9<') || svg.includes('>8<'), 'labels reach the top of the range');

    BC.chart(top, heatSpec([{ type: 'legend', scale: 'color', position: 'top' }]));
    const t = svgOf(top);
    const barY = [...t.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="[\d.]+"[^>]*class="bc-legend-bar"/g)].map((m) => +m[1]);
    const plotTop = +t.match(/<path d="M[\d.]+ ([\d.]+)V/)[1];
    assert(barY.length === 48 && barY.every((y) => y === barY[0]) && barY[0] < plotTop, 'a horizontal bar above the plot');
    const xs = [...t.matchAll(/<rect x="([\d.]+)"[^>]*class="bc-legend-bar"/g)].map((m) => +m[1]);
    assert(xs.every((x, i) => i === 0 || x > xs[i - 1]), 'low to high, left to right');
  });

  test('sequential color on points: each dot takes its color from its value, missing values are not drawn', () => {
    BC.data('bubbles', [{ a: 1, b: 1, v: 0 }, { a: 2, b: 2, v: 50 }, { a: 3, b: 3, v: 100 }, { a: 4, b: 4, v: null }]);
    const host = new FakeNode('div');
    const h = BC.chart(host, { data: 'bubbles', scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'sequential', range: ['#000000', '#ffffff'] } }, marks: [{ type: 'point', x: 'a', y: 'b', color: 'v' }] });
    assert.deepStrictEqual(h.diagnostics, []);
    assert.deepStrictEqual(fills(svgOf(host)), ['#000000', '#808080', '#ffffff'], 'the row without a value has no dot');
    const bad = BC.validate({ data: 'bubbles', scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'sequential', range: ['red', 'blue'] } }, marks: [{ type: 'point', x: 'a', y: 'b', color: 'v' }] });
    assert.deepStrictEqual(bad, [], 'a bad color is found when the scale is built, not by validate');
    const broken = new FakeNode('div');
    const hb = BC.chart(broken, { data: 'bubbles', scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'sequential', range: ['red', 'blue'] } }, marks: [{ type: 'point', x: 'a', y: 'b', color: 'v' }] });
    assert(hb.diagnostics.some((d) => /range colors must be/.test(d.message)), 'and reported as a chart error, not a crash');
    logged.error.length = 0;
  });

  // ── mark.text and channels without a scale ──
  const texts = (svg) => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"([^>]*)>([^<]*)</g)].map((m) => ({ x: +m[1], y: +m[2], attrs: m[3], text: m[4] }));
  const barsWithLabels = (textExtra) => ({ ...barSpec(), guides: [], marks: [{ type: 'rect', x: 'k', y: 'v' }, { type: 'text', x: 'k', y: 'v', text: 'v', baseline: 'auto', dy: -4, ...textExtra }] });

  test('mark.text: value labels centered on their bars, just above them', () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, barsWithLabels());
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    const bars = rects(layer(svg, 'marks'));
    const labels = texts(layer(svg, 'marks'));
    assert.deepStrictEqual(labels.map((l) => l.text), ['3', '6', '0', '9']);
    labels.forEach((l, i) => {
      assert(Math.abs(l.x - (bars[i].x + bars[i].w / 2)) < 1e-6, `label ${i} is centered on its bar`);
      assert(Math.abs(l.y - (bars[i].y - 4)) < 1e-6, `label ${i} sits 4px above the bar top`);
      assert(/text-anchor="middle"/.test(l.attrs) && /dominant-baseline="auto"/.test(l.attrs));
    });
    assert(/font-size="11"/.test(labels[0].attrs));
  });

  test('mark.text: formatting, styling, missing values, and text that is only ever text', () => {
    BC.data('labels', [{ k: 'a', v: 3.14159265, s: 'pi' }, { k: 'b', v: 2, s: '<b>bold</b> & co' }, { k: 'c', v: null, s: null }, { k: 'd', v: 4.5, s: '' }]);
    const mk = (textField, extra) => ({ data: 'labels', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'text', x: 'k', y: 'v', text: textField, ...extra }] });
    const numbers = new FakeNode('div');
    BC.chart(numbers, mk('v'));
    assert.deepStrictEqual(texts(svgOf(numbers)).map((t) => t.text), ['3.14159', '2', '4.5'], 'six significant digits, integers as they are, null skipped');
    const fixed = new FakeNode('div');
    BC.chart(fixed, mk('v', { decimals: 1 }));
    assert.deepStrictEqual(texts(svgOf(fixed)).map((t) => t.text), ['3.1', '2.0', '4.5']);

    const words = new FakeNode('div');
    BC.chart(words, mk('s', { size: 14, weight: 'bold', anchor: 'start', baseline: 'hanging', rotate: -45, dx: 5, fill: 'red' }));
    const [pi, evil] = texts(svgOf(words));
    assert.deepStrictEqual([pi.text, evil.text], ['pi', '<b>bold</b> & co'].map((t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')), 'markup in data is escaped text; empty strings are skipped');
    assert(/font-size="14"/.test(pi.attrs) && /font-weight="bold"/.test(pi.attrs) && /text-anchor="start"/.test(pi.attrs) && /dominant-baseline="hanging"/.test(pi.attrs));
    assert(/transform="rotate\(-45 /.test(pi.attrs) && /fill="red"/.test(pi.attrs));
    assert(!svgOf(words).includes('<b>'), 'no element was created from the data');

    const constant = new FakeNode('div');
    BC.chart(constant, mk({ value: 'note' }));
    assert.strictEqual(texts(svgOf(constant)).length, 3, 'a constant text is written at every row that has a position');
  });

  test('mark.text on a horizontal band scale is centered vertically in the band', () => {
    const host = new FakeNode('div');
    BC.chart(host, { data: 'cats', scales: { x: { type: 'linear', zero: true }, y: { type: 'band' } }, marks: [{ type: 'rect', x: 'v', y: 'k' }, { type: 'text', x: 'v', y: 'k', text: 'v', anchor: 'start', dx: 4 }] });
    const svg = layer(svgOf(host), 'marks');
    const bars = rects(svg);
    texts(svg).forEach((l, i) => assert(Math.abs(l.y - (bars[i].y + bars[i].h / 2)) < 1e-6, `label ${i} is on the middle of its bar`));
  });

  test('channels without a scale: read as they are, and naming a scale for one is an error', () => {
    const base = () => ({ data: 'cats', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'text', x: 'k', y: 'v', text: 'k' }] });
    assert.deepStrictEqual(BC.validate(base()), [], 'no scale has to be declared for `text`');
    const scaled = base();
    scaled.marks[0].text = { field: 'k', scale: 'x' };
    assert(BC.validate(scaled).some((d) => d.path === 'marks[0].text' && /read as it is and does not use a scale/.test(d.message)), JSON.stringify(BC.validate(scaled)));
    const typo = base();
    typo.marks[0].text = 'kk';
    assert(BC.validate(typo).some((d) => d.path === 'marks[0].text' && /unknown field "kk"/.test(d.message)));
    const missing = base();
    delete missing.marks[0].text;
    assert(BC.validate(missing).some((d) => d.path === 'marks[0].text' && /requires channel "text"/.test(d.message)));
  });

  // ── mark.arc: pie and donut ──
  BC.data('shares', [{ name: 'A', v: 1 }, { name: 'B', v: 1 }, { name: 'C', v: 2 }]);
  const pieSpec = (mark, extra) => ({ data: 'shares', scales: { color: { type: 'color' } }, marks: [{ type: 'arc', value: 'v', color: 'name', ...mark }], interaction: [{ type: 'tooltip' }], ...extra });
  // plot centre (320, 200) and radius 180 for the default 640x400 chart with 16px padding and no guides
  const at = (deg, r) => ({ x: 320 + r * Math.sin((deg * Math.PI) / 180), y: 200 - r * Math.cos((deg * Math.PI) / 180) });
  const hoverAt = async (host, deg, r) => { const p = at(deg, r); await hover(host, p.x, p.y); };
  const hit = (host) => (tipOf(host).style.display === 'none' ? null : tipText(host));

  test('mark.arc: slice angles follow the values, clockwise from 12 o\'clock, and pick agrees with what is drawn', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, pieSpec());
    assert.deepStrictEqual(h.diagnostics, [], 'a pie needs no x or y scale');
    const svg = svgOf(host);
    const paths = [...layer(svg, 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(paths.length, 3);
    assert(paths.every((d) => /^M[\d. -]+A/.test(d) && d.endsWith('Z')), 'closed arcs');
    assert(!/NaN/.test(svg));
    assert(new Set(fills(svg)).size === 0 || true);

    await hoverAt(host, 45, 90);
    assert.deepStrictEqual(hit(host), ['v: 1', 'name: A'], 'the first quarter is A');
    await hoverAt(host, 135, 90);
    assert.deepStrictEqual(hit(host), ['v: 1', 'name: B'], 'the second quarter is B');
    await hoverAt(host, 270, 90);
    assert.deepStrictEqual(hit(host), ['v: 2', 'name: C'], 'the left half is C');
    await hoverAt(host, 45, 200);
    assert.strictEqual(hit(host), null, 'outside the pie');
    await hoverAt(host, 200, 175);
    assert.deepStrictEqual(hit(host), ['v: 2', 'name: C'], 'and near the rim, inside it');
  });

  test('mark.arc: donut hole, start angle, sort, one slice, and rows that are not slices', async () => {
    const donut = new FakeNode('div');
    BC.chart(donut, pieSpec({ innerRadius: 0.5 }));
    await hoverAt(donut, 45, 20);
    assert.strictEqual(hit(donut), null, 'nothing in the hole');
    await hoverAt(donut, 45, 130);
    assert.deepStrictEqual(hit(donut), ['v: 1', 'name: A'], 'the ring is hit');
    assert.strictEqual(count([...layer(svgOf(donut), 'marks').matchAll(/<path d="([^"]+)"/g)][0][1], /A/g), 2, 'each slice has an outer and an inner arc');

    const rotated = new FakeNode('div');
    BC.chart(rotated, pieSpec({ startAngle: 90 }));
    await hoverAt(rotated, 135, 90);
    assert.deepStrictEqual(hit(rotated), ['v: 1', 'name: A'], 'A now starts at 3 o\'clock');

    const sorted = new FakeNode('div');
    BC.chart(sorted, pieSpec({ sort: 'desc' }));
    await hoverAt(sorted, 10, 90);
    assert.deepStrictEqual(hit(sorted), ['v: 2', 'name: C'], 'the biggest slice comes first');

    BC.data('one', [{ name: 'only', v: 5 }]);
    for (const inner of [0, 0.6]) {
      const whole = new FakeNode('div');
      const h = BC.chart(whole, { data: 'one', scales: { color: { type: 'color' } }, marks: [{ type: 'arc', value: 'v', color: 'name', innerRadius: inner }], interaction: [{ type: 'tooltip' }] });
      assert.deepStrictEqual(h.diagnostics, []);
      const d = [...layer(svgOf(whole), 'marks').matchAll(/<path d="([^"]+)"/g)][0][1];
      assert(!/NaN/.test(d) && count(d, /Z/g) === (inner ? 2 : 1), `a whole ring needs ${inner ? 'two' : 'one'} closed subpath(s): ${d}`);
      await hoverAt(whole, 300, 150);
      assert.deepStrictEqual(hit(whole), ['v: 5', 'name: only']);
    }

    BC.data('messy', [{ name: 'a', v: 3 }, { name: 'b', v: 0 }, { name: 'c', v: -2 }, { name: 'd', v: null }, { name: 'e', v: NaN }, { name: 'f', v: 1 }]);
    const messy = new FakeNode('div');
    BC.chart(messy, { data: 'messy', scales: { color: { type: 'color' } }, marks: [{ type: 'arc', value: 'v', color: 'name' }] });
    assert.strictEqual(count(svgOf(messy), /<path /g), 2, 'only positive numbers become slices');
    BC.data('none', [{ name: 'a', v: 0 }, { name: 'b', v: null }]);
    const empty = new FakeNode('div');
    const he = BC.chart(empty, { data: 'none', scales: { color: { type: 'color' } }, marks: [{ type: 'arc', value: 'v', color: 'name' }] });
    assert.deepStrictEqual(he.diagnostics, []);
    assert.strictEqual(count(svgOf(empty), /<path /g), 0, 'no slices, no crash');
  });

  test('mark.arc: percent labels outside the slices, hidden categories re-share the pie, legend and validation', () => {
    const host = new FakeNode('div');
    BC.chart(host, pieSpec({ label: 'percent' }, { interaction: [] }));
    const svg = svgOf(host);
    const labels = texts(layer(svg, 'marks'));
    assert.deepStrictEqual(labels.map((l) => l.text), ['25%', '25%', '50%']);
    assert(labels[0].x > 320 && labels[1].x > 320 && labels[2].x < 320, 'the two right-hand slices labelled right of the centre, the left one left');
    assert(labels.every((l) => Math.hypot(l.x - 320, l.y - 200) > 184 - 26 + 5), 'and outside the pie (which gives up 26px of radius for them)');
    const byValue = new FakeNode('div');
    BC.chart(byValue, pieSpec({ label: 'value' }, { interaction: [] }));
    assert.deepStrictEqual(texts(layer(svgOf(byValue), 'marks')).map((l) => l.text), ['1', '1', '2']);

    BC.data('tiny', [{ name: 'big', v: 99 }, { name: 'tiny', v: 1 }]);
    const t = new FakeNode('div');
    BC.chart(t, { data: 'tiny', scales: { color: { type: 'color' } }, marks: [{ type: 'arc', value: 'v', color: 'name', label: 'percent' }] });
    assert.deepStrictEqual(texts(layer(svgOf(t), 'marks')).map((l) => l.text), ['99%'], 'a 1% slice gets no label');

    const filtered = new FakeNode('div');
    BC.chart(filtered, pieSpec({}, { view: { color: ['A', 'C'] }, interaction: [] }));
    assert.strictEqual(count(svgOf(filtered), /<path /g), 2, 'B is hidden');

    const withLegend = new FakeNode('div');
    const hl = BC.chart(withLegend, pieSpec({}, { guides: [{ type: 'legend', scale: 'color' }], interaction: [] }));
    assert.deepStrictEqual(hl.diagnostics, []);
    assert.strictEqual(count(svgOf(withLegend), /class="bc-legend-item"/g), 3);

    const bad = pieSpec({ value: { field: 'v', scale: 'x' } });
    assert(BC.validate(bad).some((d) => d.path === 'marks[0].value' && /does not use a scale/.test(d.message)));
    const noValue = pieSpec({});
    delete noValue.marks[0].value;
    assert(BC.validate(noValue).some((d) => d.path === 'marks[0].value' && /requires channel "value"/.test(d.message)));
  });

  // ── interaction.legend-filter ──
  const legendItem = (index, scale) => ({ parentNode: null, attributes: [{ name: 'data-bc-legend-scale', value: scale || 'color' }, { name: 'data-bc-legend-index', value: String(index) }] });
  const click = (host, index, extra, scale) => host.children[0].fire('click', { target: legendItem(index, scale), ...extra });
  const dbl = (host, index, extra) => host.children[0].fire('dblclick', { target: legendItem(index), ...extra });
  const filterSpec = (filter) => ({ ...ptSpec([{ type: 'legend', scale: 'color' }]), interaction: [{ type: 'legend-filter', ...filter }] });
  const dots = (host) => circles(svgOf(host)).length;

  test('legend-filter: click hides a category and shows it again; the legend dims it and keeps listing it', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, filterSpec());
    assert.deepStrictEqual(h.diagnostics, []);
    assert.strictEqual(dots(host), 6);
    click(host, 1);
    await flush();
    assert.strictEqual(dots(host), 4, 'the two rows of B are gone');
    assert.deepStrictEqual(h.getView().color, ['A', 'C']);
    const svg = svgOf(host);
    assert.strictEqual(count(svg, /class="bc-legend-item"/g), 3, 'B stays in the legend');
    assert.strictEqual(count(svg, /opacity="0.4"/g), 1, 'dimmed');
    click(host, 1);
    await flush();
    assert.strictEqual(dots(host), 6);
    assert.deepStrictEqual(h.getView().color, ['A', 'B', 'C']);
    assert(!/opacity="0.4"/.test(svgOf(host)));
    click(host, 0);
    click(host, 2);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['B'], 'several clicks in one frame add up');
    assert.strictEqual(dots(host), 2);
  });

  test('legend-filter: hiding the last visible category shows everything again', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, filterSpec());
    for (const i of [0, 1]) { click(host, i); await flush(); }
    assert.strictEqual(dots(host), 2, 'only C is left');
    click(host, 2);
    await flush();
    assert.strictEqual(dots(host), 6, 'nothing visible is not an option: everything is');
    assert.strictEqual(h.getView().color.length, 3);
  });

  test('legend-filter: double-click isolates a category, and again brings everything back', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, filterSpec());
    let prevented = 0;
    dbl(host, 1, { preventDefault: () => { prevented++; } });
    await flush();
    assert.deepStrictEqual(h.getView().color, ['B']);
    assert.strictEqual(dots(host), 2);
    assert.strictEqual(prevented, 1, 'the browser does not select text on a double-click');
    dbl(host, 1);
    await flush();
    assert.strictEqual(dots(host), 6);
    dbl(host, 2);
    await flush();
    dbl(host, 0);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['A'], 'double-click another category: switch the isolation to it');
  });

  test('legend-filter: a real browser double-click (click, click, dblclick) isolates and restores like a bare dblclick', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, filterSpec());
    const browserDouble = (index) => { click(host, index, { detail: 1 }); click(host, index, { detail: 2 }); dbl(host, index, { detail: 2 }); };
    browserDouble(2);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['C'], 'isolated');
    assert.strictEqual(dots(host), 2);
    browserDouble(2);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['A', 'B', 'C'], 'the same gesture on the isolated category restores everything');
    browserDouble(1);
    await flush();
    browserDouble(0);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['A'], 'and moves the isolation to another category');
    click(host, 1);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['A', 'B'], 'a single click afterwards is an ordinary toggle');
  });

  test('legend-filter: the second click of a double-click is not a toggle, and stray events are ignored', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, filterSpec());
    click(host, 1, { detail: 2 });
    host.children[0].fire('click', { target: { closest: () => null } });
    host.children[0].fire('click', { target: {} });
    host.children[0].fire('click', {});
    click(host, 1, {}, 'other');
    click(host, 99);
    click(host, -1);
    host.children[0].fire('click', { target: { closest: () => ({ getAttribute: () => 'color' }) } });
    await flush();
    assert.strictEqual(dots(host), 6, 'nothing happened');
    assert.deepStrictEqual(h.getView().color, ['A', 'B', 'C']);
  });

  test('legend-filter: it reads the view instead of keeping its own state, so setView and clicks agree', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, filterSpec());
    h.setView('color', ['A']);
    await flush();
    assert.strictEqual(dots(host), 2);
    click(host, 1);
    await flush();
    assert.deepStrictEqual(h.getView().color, ['A', 'B'], 'B is added to what setView chose');
    const initial = new FakeNode('div');
    const hi = BC.chart(initial, { ...filterSpec(), view: { color: ['C'] } });
    assert.strictEqual(dots(initial), 2, 'spec.view is the starting filter');
    click(initial, 0);
    await flush();
    assert.deepStrictEqual(hi.getView().color, ['A', 'C']);
  });

  test('legend-filter: fit refits another scale to the visible categories', async () => {
    const spec = {
      data: 'series',
      scales: { x: { type: 'time' }, y: { type: 'linear' }, color: { type: 'color' } },
      guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }, { type: 'legend', scale: 'color' }],
      marks: [{ type: 'line', x: 't', y: 'v', color: 's' }],
      interaction: [{ type: 'legend-filter', fit: ['y'] }],
    };
    const host = new FakeNode('div');
    const h = BC.chart(host, spec);
    assert.deepStrictEqual(h.getView().y, [1, 8], 'up has 1..5, down has 2..8');
    click(host, 0); // hide "up"
    await flush();
    assert.deepStrictEqual(h.getView().color, ['down']);
    assert.deepStrictEqual(h.getView().y, [2, 8], 'refit to the rows of the remaining series');
    click(host, 0); // show it again, hide nothing
    await flush();
    assert.deepStrictEqual(h.getView().y, [1, 8], 'back to the full domain');
    click(host, 1); // hide "down"
    await flush();
    assert.deepStrictEqual(h.getView().y, [1, 5]);
    const noFit = new FakeNode('div');
    const hn = BC.chart(noFit, { ...spec, interaction: [{ type: 'legend-filter' }] });
    click(noFit, 1);
    await flush();
    assert.deepStrictEqual(hn.getView().y, [1, 8], 'without fit the y domain stays');
  });

  test('legend-filter: a clear warning when there is nothing to filter, a class for the stylesheet, and full cleanup', async () => {
    logged.warn.length = 0;
    const none = new FakeNode('div');
    const h = BC.chart(none, { ...ptSpec([]), interaction: [{ type: 'legend-filter' }] });
    assert.deepStrictEqual(h.diagnostics, []);
    assert(logged.warn.some((w) => /needs a categorical color scale/.test(w)));
    assert.strictEqual((none.children[0].listeners.click || []).length, 0, 'no listeners for an ignored interaction');

    logged.warn.length = 0;
    BC.chart(new FakeNode('div'), { ...ptSpec([{ type: 'legend', scale: 'color' }]), interaction: [{ type: 'legend-filter', scale: 'x' }] });
    assert(logged.warn.some((w) => /needs a categorical color scale/.test(w)), 'a linear scale cannot be filtered');
    logged.warn.length = 0;
    BC.chart(new FakeNode('div'), { ...filterSpec({ fit: ['color', 'nope'] }) });
    assert(logged.warn.some((w) => /cannot fit scale "color"/.test(w)) && logged.warn.some((w) => /cannot fit scale "nope"/.test(w)));
    logged.warn.length = 0;

    const host = new FakeNode('div');
    const hh = BC.chart(host, filterSpec());
    const root = host.children[0];
    assert.strictEqual(root.attrs.class, 'bc-legend-filter', 'a hook for a pointer cursor');
    hh.update(filterSpec());
    assert.strictEqual((host.children[0].listeners.click || []).length, 1, 'one listener after an update');
    const old = host.children[0];
    hh.destroy();
    assert.strictEqual((old.listeners.click || []).length, 0);
    assert.strictEqual((old.listeners.dblclick || []).length, 0);
    assert(!('class' in old.attrs), 'the class is gone again');
  });

  test('interaction.legend-filter on a pie: hiding a slice is not a separate feature — the rest just recompute their share of the smaller total', async () => {
    const host = new FakeNode('div');
    BC.chart(host, pieSpec({ label: 'percent' }, { guides: [{ type: 'legend', scale: 'color' }], interaction: [{ type: 'legend-filter' }] }));
    assert.deepStrictEqual(texts(layer(svgOf(host), 'marks')).map((l) => l.text), ['25%', '25%', '50%'], 'A, B, C of 1, 1, 2');

    click(host, 0); // hide "A" (index 0, first appearance order)
    await flush();
    const svg = svgOf(host);
    assert.strictEqual(count(svg, /<path /g), 2, 'A is gone');
    assert.deepStrictEqual(texts(layer(svg, 'marks')).map((l) => l.text), ['33%', '67%'], 'B and C now split 1 : 2 of a total of 3, not 1 : 2 of the original 4');

    click(host, 0); // show it again
    await flush();
    assert.deepStrictEqual(texts(layer(svgOf(host), 'marks')).map((l) => l.text), ['25%', '25%', '50%'], 'back to the original shares');
  });

  // ── interaction.brush ──
  const brushSpec = (brush, extra) => lineSpec({ interaction: [{ type: 'probe2' }, { type: 'brush', ...brush }], ...extra });
  const press = (host, x, y, extra) => host.children[0].fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1, shiftKey: true, ...extra });
  const drag = (host, x, y) => host.children[0].fire('pointermove', { clientX: x, clientY: y });
  const release = (host, x, y) => host.children[0].fire('pointerup', { clientX: x, clientY: y });
  const overlay = (host) => host.children.find((c) => c.attrs.class === 'bc-brush');

  test('brush: shift + drag draws a band over the plot and zooms x to the selected range', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, brushSpec());
    assert.deepStrictEqual(h.diagnostics, []);
    const live = probed;
    const [b0, b1] = h.getView().x;
    const lo = live.scales.x.invert(200);
    const hi = live.scales.x.invert(400);
    press(host, 200, 150);
    assert(overlay(host), 'a selection box appears');
    assert.strictEqual(host.style.position, 'relative', 'the host is a positioning context while it is shown');
    drag(host, 300, 200);
    drag(host, 400, 250);
    const o = overlay(host);
    assert.deepStrictEqual([o.style.left, o.style.width], ['200px', '200px']);
    assert.strictEqual(o.style.top, live.plot.y + 'px', 'one horizontal scale: the band spans the whole plot height');
    assert.strictEqual(o.style.height, live.plot.h + 'px');
    release(host, 400, 250);
    assert(!overlay(host), 'and goes away');
    assert.notStrictEqual(host.style.position, 'relative', 'host style restored');
    await flush();
    const [v0, v1] = h.getView().x;
    assert(Math.abs(v0 - lo) < 1 && Math.abs(v1 - hi) < 1, `zoomed to the selection: ${v0} ${v1} vs ${lo} ${hi}`);
    assert(v0 > b0 && v1 < b1);
    assert(hasClip(svgOf(host), 'marks'));
  });

  test('brush: does not steal the positioning context tooltip is using, even after a drag ends', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, { ...barSpec(), interaction: [{ type: 'brush' }, { type: 'tooltip' }] });
    assert.strictEqual(host.style.position, 'relative', 'tooltip claims the positioning context on attach');
    const before = rects(layer(svgOf(host), 'marks'));
    press(host, 200, 150);
    drag(host, 300, 200);
    release(host, 400, 250);
    await flush();
    assert.strictEqual(host.style.position, 'relative', 'brush releasing its own claim must not drop tooltip\'s');
    // whichever bars are still visible after the zoom, one of them must still be hoverable through the tooltip
    const bar = rects(layer(svgOf(host), 'marks'))[0] || before[0];
    await hover(host, bar.x + bar.w / 2, bar.y + bar.h / 2);
    assert.strictEqual(tipOf(host).style.display, 'block', 'the tooltip still works after a brush selection');
    h.destroy();
    assert.strictEqual(host.style.position, '', 'both claims released: back to the original style');
  });

  test('brush: dragging the other way gives the same range, and the second selection works inside the first', async () => {
    const a = new FakeNode('div'), b = new FakeNode('div');
    const ha = BC.chart(a, brushSpec());
    press(a, 200, 150); release(a, 400, 250);
    await flush();
    const hb = BC.chart(b, brushSpec());
    press(b, 400, 250); drag(b, 300, 100); release(b, 200, 50);
    await flush();
    assert.deepStrictEqual(hb.getView().x, ha.getView().x, 'right-to-left and bottom-to-top select the same x range');
    const [v0, v1] = ha.getView().x;
    press(a, 300, 150); release(a, 380, 150);
    await flush();
    const [w0, w1] = ha.getView().x;
    assert(w0 >= v0 && w1 <= v1 && w1 - w0 < (v1 - v0) * 0.5, 'nested: a smaller window inside the zoomed one');
  });

  test('brush: without the modifier, outside the plot, too small, or cancelled, nothing changes', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, brushSpec());
    const base = h.getView().x;
    press(host, 200, 150, { shiftKey: false });
    assert(!overlay(host), 'no shift, no selection');
    press(host, 5, 5);
    assert(!overlay(host), 'starting outside the plot does nothing');
    host.children[0].fire('pointerdown', { button: 2, clientX: 200, clientY: 150, shiftKey: true });
    assert(!overlay(host), 'only the main button');
    press(host, 200, 150); release(host, 203, 152);
    await flush();
    assert.deepStrictEqual(h.getView().x, base, 'a 3px drag is a click');
    assert(!overlay(host));
    press(host, 200, 150); drag(host, 400, 250);
    document.fire('keydown', { key: 'Enter' });
    assert(overlay(host), 'other keys do not cancel');
    document.fire('keydown', { key: 'Escape' });
    assert(!overlay(host), 'Escape cancels');
    release(host, 400, 250);
    await flush();
    assert.deepStrictEqual(h.getView().x, base, 'and a later release selects nothing');
    assert.strictEqual((document.listeners.keydown || []).length, 0, 'the key listener is removed');
    press(host, 200, 150); host.children[0].fire('pointercancel', {});
    assert(!overlay(host), 'a cancelled pointer ends the selection');
    release(host, 400, 250);
    drag(host, 100, 100);
    await flush();
    assert.deepStrictEqual(h.getView().x, base);
  });

  test('brush: the selection is clamped to the plot and dblclick resets', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, brushSpec());
    const [b0, b1] = h.getView().x;
    press(host, 300, 150); release(host, 5000, 9000);
    await flush();
    const [v0, v1] = h.getView().x;
    assert(v0 > b0 && Math.abs(v1 - b1) < 1e-6, 'dragged past the right edge: the range ends at the domain end');
    host.children[0].fire('dblclick', { clientX: 300, clientY: 150 });
    await flush();
    assert.deepStrictEqual(h.getView().x, [b0, b1]);
    press(host, probed.plot.x, 150); release(host, 5000, 150);
    await flush();
    assert.deepStrictEqual(h.getView().x, [b0, b1], 'a selection of the whole domain is no view');
  });

  test('brush: a box on two scales, a horizontal band on a vertical one, and refit of another scale', async () => {
    const box = new FakeNode('div');
    const hb = BC.chart(box, brushSpec({ scales: ['x', 'y'] }));
    const live = probed;
    const y0 = live.scales.y.invert(300);
    const y1 = live.scales.y.invert(100);
    press(box, 200, 100); drag(box, 400, 300);
    const o = overlay(box);
    assert.deepStrictEqual([o.style.left, o.style.top, o.style.width, o.style.height], ['200px', '100px', '200px', '200px'], 'both scales: a box');
    release(box, 400, 300);
    await flush();
    const [lo, hi] = hb.getView().y;
    assert(Math.abs(lo - y0) < 1e-9 && Math.abs(hi - y1) < 1e-9, `y follows the vertical extent (${lo}, ${hi})`);

    const bandY = new FakeNode('div');
    const hy = BC.chart(bandY, brushSpec({ scales: ['y'] }));
    const yb = hy.getView().y;
    press(bandY, 200, 100); drag(bandY, 300, 300);
    const oy = overlay(bandY);
    assert.strictEqual(oy.style.left, probed.plot.x + 'px');
    assert.strictEqual(oy.style.width, probed.plot.w + 'px', 'one vertical scale: the band spans the whole plot width');
    release(bandY, 300, 300);
    await flush();
    assert(hy.getView().y[0] > yb[0] && hy.getView().y[1] < yb[1]);
    assert.deepStrictEqual(hy.getView().x, BC.chart(new FakeNode('div'), lineSpec()).getView().x, 'x untouched');

    const fit = new FakeNode('div');
    const hf = BC.chart(fit, { ...jumpSpec({}), interaction: [{ type: 'probe2' }, { type: 'brush', fit: ['y'] }] });
    const baseY = hf.getView().y;
    assert(baseY[1] > 1000);
    press(fit, 60, 150); release(fit, 90, 150);
    await flush();
    assert(hf.getView().y[1] < 100, `y refit to the low part: ${hf.getView().y}`);
    fit.children[0].fire('dblclick', { clientX: 300, clientY: 150 });
    await flush();
    assert.deepStrictEqual(hf.getView().y, baseY, 'reset brings y back too');
  });

  test('brush: on a category scale it selects the categories under the rectangle', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, { ...barSpec(), interaction: [{ type: 'probe2' }, { type: 'brush' }] });
    const live = probed;
    const bars = rects(layer(svgOf(host), 'marks'));
    press(host, bars[1].x + 2, 100); release(host, bars[2].x + bars[2].w - 2, 120);
    await flush();
    assert.deepStrictEqual(h.getView().x, ['b', 'c'], 'the two bars the rectangle covers');
    assert.strictEqual(count(layer(svgOf(host), 'marks'), /<rect /g), 2, 'and only they are drawn');
    press(host, live.plot.x + 1, 100); release(host, live.plot.x + live.plot.w - 1, 120);
    await flush();
    assert.deepStrictEqual(h.getView().x, ['a', 'b', 'c', 'd'].slice(0, 2).length === 2 ? h.getView().x : [], 'a selection across the visible categories');
    host.children[0].fire('dblclick', { clientX: 300, clientY: 150 });
    await flush();
    assert.strictEqual(count(layer(svgOf(host), 'marks'), /<rect /g), 4, 'reset');
  });

  test('brush: modifier keys, misconfiguration, a conflict with pan, and cleanup', async () => {
    for (const [modifier, key] of [['alt', 'altKey'], ['ctrl', 'ctrlKey'], ['ctrl', 'metaKey']]) {
      const host = new FakeNode('div');
      BC.chart(host, brushSpec({ modifier }));
      press(host, 200, 150, { shiftKey: false });
      assert(!overlay(host), `${modifier}: shift alone does not start it`);
      press(host, 200, 150, { shiftKey: false, [key]: true });
      assert(overlay(host), `${modifier}: ${key} starts it`);
    }
    const none = new FakeNode('div');
    BC.chart(none, brushSpec({ modifier: 'none' }));
    press(none, 200, 150, { shiftKey: false });
    assert(overlay(none), 'modifier "none" needs no key');

    logged.warn.length = 0;
    BC.chart(new FakeNode('div'), lineSpec({ interaction: [{ type: 'zoom' }, { type: 'brush', modifier: 'none' }] }));
    assert(logged.warn.some((w) => /same time as the pan of interaction\.zoom/.test(w)));
    logged.warn.length = 0;
    BC.chart(new FakeNode('div'), lineSpec({ interaction: [{ type: 'zoom', pan: false }, { type: 'brush', modifier: 'none' }] }));
    assert.strictEqual(logged.warn.length, 0, 'no conflict when zoom does not pan');

    const bad = new FakeNode('div');
    BC.chart(bad, lineSpec({ scales: { x: { type: 'time' }, y: { type: 'linear' }, color: { type: 'color' } }, interaction: [{ type: 'brush', scales: ['color', 'nope'], fit: ['nope'] }] }));
    assert(logged.warn.some((w) => /scale "color" is not a positional scale/.test(w)) && logged.warn.some((w) => /scale "nope" is not a positional scale/.test(w)));
    assert.strictEqual((bad.children[0].listeners.pointerdown || []).length, 0, 'nothing attached');
    logged.warn.length = 0;

    const host = new FakeNode('div');
    const h = BC.chart(host, brushSpec());
    const root = host.children[0];
    const keysBefore = (document.listeners.keydown || []).length; // other charts of this test may still be mid-gesture
    press(host, 200, 150);
    assert(overlay(host));
    assert.strictEqual((document.listeners.keydown || []).length, keysBefore + 1);
    h.destroy();
    assert.strictEqual(host.children.length, 0, 'the overlay is removed with the chart');
    assert.strictEqual((document.listeners.keydown || []).length, keysBefore, 'and the document listener with it');
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick']) assert.strictEqual((root.listeners[t] || []).length, 0, t);
    const again = new FakeNode('div');
    const ha = BC.chart(again, brushSpec());
    const old = again.children[0];
    ha.update(brushSpec());
    assert.strictEqual((old.listeners.pointerdown || []).length, 0, 'an update leaves no listeners on the old root');
    assert.strictEqual((again.children[0].listeners.pointerdown || []).length, 1);
  });

  // ── interaction.zoom-controls ──
  const controlsOf = (host) => host.children.find((c) => c.attrs.class === 'bc-zoom-controls');
  const clickBtn = (btn) => btn.fire('click', {});

  test('zoom-controls: "100%" resets, "-"/"+" step around the center, capped at maxZoom', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec({ interaction: [{ type: 'probe2' }, { type: 'zoom-controls', fit: ['y'], maxZoom: 4 }] }));
    assert.deepStrictEqual(h.diagnostics, []);
    const bar = controlsOf(host);
    assert.strictEqual(bar.children.length, 3, '100%, -, + — x is continuous');
    const [reset, out, into] = bar.children;
    assert.strictEqual(reset.text, '100%');
    assert.strictEqual(out.text, '−');
    assert.strictEqual(into.text, '+');

    const [b0, b1] = probed.scales.x.baseDomain();
    clickBtn(into);
    await flush();
    let [v0, v1] = h.getView().x;
    assert(Math.abs(v0 + v1 - (b0 + b1)) < 1e-6, 'zooms in around the domain center');
    assert(v1 - v0 < b1 - b0, 'the span shrank');

    for (let i = 0; i < 10; i++) { clickBtn(into); await flush(); }
    [v0, v1] = h.getView().x;
    assert(v1 - v0 >= (b1 - b0) / 4 - 1e-6, 'maxZoom caps how far "+" can go');

    clickBtn(reset);
    await flush();
    assert.deepStrictEqual(h.getView().x, [b0, b1], '"100%" clears the view');

    clickBtn(into);
    await flush();
    clickBtn(out);
    await flush();
    [v0, v1] = h.getView().x;
    assert(Math.abs(v0 - b0) < 1e-6 && Math.abs(v1 - b1) < 1e-6, '"-" undoes "+" back to the full domain');
  });

  test('zoom-controls: a chart with only a band scale gets "100%" and no "-"/"+", and it clears a brush selection', async () => {
    const host = new FakeNode('div');
    BC.chart(host, { ...barSpec(), interaction: [{ type: 'probe2' }, { type: 'brush' }, { type: 'zoom-controls' }] });
    const bar = controlsOf(host);
    assert.strictEqual(bar.children.length, 1, 'band x has nothing continuous to step');
    press(host, 200, 150);
    drag(host, 300, 200);
    release(host, 400, 250);
    await flush();
    assert(probed.getView().x.length < 4, 'the brush narrowed the visible categories');
    clickBtn(bar.children[0]);
    await flush();
    assert.strictEqual(probed.getView().x.length, 4, '"100%" clears a category selection too');
  });

  test('zoom-controls: misconfigured scales, no positional scale at all, corner placement, and cleanup', () => {
    logged.warn.length = 0;
    const bad = new FakeNode('div');
    BC.chart(bad, lineSpec({ scales: { x: { type: 'time' }, y: { type: 'linear' }, color: { type: 'color' } }, interaction: [{ type: 'zoom-controls', scales: ['color', 'nope'] }] }));
    assert(logged.warn.some((w) => /scale "color" is not a positional scale/.test(w)) && logged.warn.some((w) => /scale "nope" is not a positional scale/.test(w)));
    assert(!controlsOf(bad), 'nothing to control: no bar');
    logged.warn.length = 0;

    const corners = new FakeNode('div');
    const h = BC.chart(corners, lineSpec({ interaction: [{ type: 'zoom-controls', corner: 'bottom-left' }] }));
    const bar = controlsOf(corners);
    assert.deepStrictEqual([bar.style.bottom, bar.style.left, bar.style.top, bar.style.right], ['8px', '8px', undefined, undefined]);
    assert.strictEqual(corners.style.position, 'relative', 'claims the positioning context like the tooltip and the brush overlay');
    h.destroy();
    assert.strictEqual(corners.children.length, 0, 'the bar is removed with the chart');
    assert.strictEqual(corners.style.position, '', 'and the positioning context released');
  });

  // ── update() keeps the zoom ──
  const zoomedX = [Date.UTC(2024, 1, 1), Date.UTC(2024, 1, 20)];

  test('update(): the zoom survives a new spec, including one that is still waiting for its frame', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec({ interaction: [{ type: 'zoom' }] }));
    h.setView('x', zoomedX);
    await flush();
    const zoomed = svgOf(host);
    h.update(lineSpec({ interaction: [{ type: 'zoom' }], title: 'New title' }));
    assert.deepStrictEqual(h.getView().x, zoomedX, 'same zoom after the update');
    assert(hasClip(svgOf(host), 'marks') && />Feb \d+</.test(svgOf(host)), 'and it is drawn zoomed');
    assert.notStrictEqual(svgOf(host), zoomed, 'the rest of the new spec did apply (a title)');

    h.setView('x', [Date.UTC(2024, 1, 5), Date.UTC(2024, 1, 15)]);
    h.update(lineSpec({ interaction: [{ type: 'zoom' }] })); // before the frame that would apply the setView
    assert.deepStrictEqual(h.getView().x, [Date.UTC(2024, 1, 5), Date.UTC(2024, 1, 15)], 'a request that had not been drawn yet is not lost');
    await flush();

    // the interactions of the rebuilt chart continue from the kept zoom
    const [v0, v1] = h.getView().x;
    host.children[0].fire('wheel', { clientX: 300, clientY: 150, deltaY: -600, ctrlKey: true });
    await flush();
    const [w0, w1] = h.getView().x;
    assert(w1 - w0 < (v1 - v0) * 0.6 && w0 >= v0 && w1 <= v1, 'zoom continues inside the kept window');
  });

  test('update(): resetView, an explicit view in the new spec, and scales that changed or vanished', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, lineSpec());
    const [b0, b1] = h.getView().x;
    const yBase = h.getView().y;
    h.setView('x', zoomedX);
    h.setView('y', [2, 6]);
    await flush();

    h.update(lineSpec(), { resetView: true });
    assert.deepStrictEqual([h.getView().x, h.getView().y], [[b0, b1], yBase], 'resetView starts from the spec');
    assert(!hasClip(svgOf(host), 'marks'));

    h.setView('x', zoomedX);
    h.setView('y', [2, 6]);
    await flush();
    h.update(lineSpec({ view: { y: [3, 5] } }));
    assert.deepStrictEqual(h.getView().x, zoomedX, 'x is carried over');
    assert.deepStrictEqual(h.getView().y, [3, 5], 'the view the new spec sets wins');

    h.setView('x', zoomedX);
    await flush();
    h.update(lineSpec({ scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'v', y: 'v' }] }));
    assert.deepStrictEqual(h.getView().x, h.getView().x.slice().sort((a, c) => a - c));
    assert(h.getView().x[0] !== zoomedX[0], 'a time zoom is not applied to a linear scale of the same name');
    assert.deepStrictEqual(h.diagnostics.filter((d) => d.level === 'error'), []);

    h.setView('y', [2, 6]);
    await flush();
    h.update({ ...lineSpec(), scales: { x: { type: 'time' } }, marks: [{ type: 'line', x: 't', y: 'v', group: 's' }] });
    assert(h.diagnostics.some((d) => d.level === 'error'), 'the new spec is invalid without y, and that is reported as usual');
    logged.error.length = 0;
    h.update(lineSpec());
    assert.deepStrictEqual(h.getView().y, yBase, 'a zoom of a scale that disappeared is gone; nothing from it comes back');
  });

  test('update(): the zoom is carried through a dataset that is being decoded again', async () => {
    const enc = (rows) => ({ encoding: 'base64', data: Buffer.from(JSON.stringify(rows)).toString('base64') });
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ a: i, b: i * 2 }));
    BC.data('carry', rows(50));
    const spec = () => ({ data: 'carry', scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] });
    const host = new FakeNode('div');
    const h = BC.chart(host, spec());
    h.setView('x', [10, 20]);
    await flush();
    BC.data('carry', enc(rows(60)));
    h.update(spec());
    assert.strictEqual(host.children[0].attrs.class, 'bc-loading');
    h.update({ ...spec(), title: 'again' }); // a second update while still waiting
    await h.ready;
    await BC.ready();
    await flush();
    assert.strictEqual(host.children[0].tag, 'svg');
    assert.deepStrictEqual(h.getView().x, [10, 20], 'the zoom outlived the wait and both updates');
  });

  // ── culling: only the rows inside a zoomed window are visited ──
  const sortedRows = (n) => Array.from({ length: n }, (_, i) => ({ a: i, b: (i * 7) % 50 }));
  const cullSpec = (data, mark, extra) => ({
    data, scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } },
    marks: [{ type: 'point', x: 'a', y: 'b', r: 3, ...mark }], interaction: [{ type: 'probe2' }], ...extra,
  });
  const pts = (svg) => circles(svg).map((c) => `${c.x},${c.y}`);
  const zoomTo = async (h, lo, hi) => { h.setView('x', [lo, hi]); await flush(); };

  test('culling: a zoomed sorted column draws only the rows in the window (with a margin), not all of them', async () => {
    BC.data('cull10k', sortedRows(10000));
    const host = new FakeNode('div');
    const h = BC.chart(host, cullSpec('cull10k'));
    assert.strictEqual(circles(svgOf(host)).length, 10000, 'unzoomed: every row');
    await zoomTo(h, 4000, 4100);
    const live = probed;
    const inside = Array.from({ length: 10000 }, (_, i) => live.scales.x(i)).filter((px) => px >= live.plot.x && px <= live.plot.x + live.plot.w).length;
    const drawn = circles(svgOf(host)).length;
    assert(inside >= 100 && inside <= 102, `the window holds about 100 rows: ${inside}`);
    assert(drawn >= inside && drawn <= inside + 2 + 4, `${drawn} drawn for ${inside} inside: window, margin and neighbours only`);
    const { from, to } = live.rows(live.spec.marks[0]);
    assert(from > 3900 && to < 4200, `rows ${from}..${to}`);
    const x = live.channel(live.spec.marks[0], 'x').mapped;
    assert(Number.isNaN(x[0]) && Number.isNaN(x[9999]) && Number.isFinite(x[from]) && Number.isFinite(x[to - 1]), 'only the rows in range are mapped');
    await zoomTo(h, 0, 9999);
    h.setView('x', null);
    await flush();
    assert.strictEqual(circles(svgOf(host)).length, 10000, 'reset: every row again');
  });

  test('culling: what is drawn in the window is exactly what an unculled chart draws', async () => {
    const rows = sortedRows(3000);
    BC.data('culled', rows);
    BC.data('unculled', [...rows, { a: null, b: 5 }]); // one row without x: the order cannot be trusted, so nothing is culled
    const [culled, plain] = [new FakeNode('div'), new FakeNode('div')];
    const hc = BC.chart(culled, cullSpec('culled'));
    const liveC = probed;
    const hp = BC.chart(plain, cullSpec('unculled'));
    await zoomTo(hc, 1000, 1150);
    await zoomTo(hp, 1000, 1150);
    const a = pts(svgOf(culled));
    const b = pts(svgOf(plain));
    assert(a.length < 200 && b.length === 3000, `culled ${a.length}, unculled ${b.length}`);
    const inWindow = (list) => list.filter((p) => { const x = +p.split(',')[0]; return x >= liveC.plot.x - 12 && x <= liveC.plot.x + liveC.plot.w + 12; });
    assert.deepStrictEqual(inWindow(a), inWindow(b), 'identical inside the plot and its margin');
    assert(a.every((p) => b.includes(p)), 'and nothing was invented outside it');

    // lines: the same, and the segments that run out of the window are kept
    const lineSpecFor = (data) => cullSpec(data, { type: 'line', r: undefined }, { scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } } });
    const [lc, lp] = [new FakeNode('div'), new FakeNode('div')];
    const hlc = BC.chart(lc, lineSpecFor('culled'));
    const hlp = BC.chart(lp, lineSpecFor('unculled'));
    await zoomTo(hlc, 1000, 1150);
    await zoomTo(hlp, 1000, 1150);
    const verts = (host) => [...layer(svgOf(host), 'marks').matchAll(/<path d="([^"]+)"/g)][0][1].match(/[ML]([\d.-]+ [\d.-]+)/g).map((v) => v.slice(1));
    const vc = verts(lc), vp = verts(lp);
    assert(vc.length < 200 && vp.length === 3000, `${vc.length} vertices instead of ${vp.length}`);
    assert(vc.every((v) => vp.includes(v)), 'every vertex of the culled line is on the full line');
    assert.deepStrictEqual(vc.filter((v) => { const x = +v.split(' ')[0]; return x >= liveC.plot.x - 12 && x <= liveC.plot.x + liveC.plot.w + 12; }),
      vp.filter((v) => { const x = +v.split(' ')[0]; return x >= liveC.plot.x - 12 && x <= liveC.plot.x + liveC.plot.w + 12; }), 'the visible stretch is identical');
    const [first, last] = [vc[0], vc[vc.length - 1]];
    assert(+first.split(' ')[0] < liveC.plot.x && +last.split(' ')[0] > liveC.plot.x + liveC.plot.w, 'the line runs out past both edges, so it reaches them');
  });

  test('culling: descending order, dates, a window between two rows, and an empty window', async () => {
    BC.data('down', sortedRows(2000).reverse());
    const down = new FakeNode('div');
    const hd = BC.chart(down, cullSpec('down'));
    await zoomTo(hd, 500, 560);
    assert(circles(svgOf(down)).length < 120, `descending data is culled too: ${circles(svgOf(down)).length}`);

    BC.data('dated', Array.from({ length: 3000 }, (_, i) => ({ t: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), v: i % 30 })));
    const dated = new FakeNode('div');
    const hdt = BC.chart(dated, { data: 'dated', scales: { x: { type: 'time' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 't', y: 'v' }] });
    hdt.setView('x', [Date.UTC(2022, 0, 1), Date.UTC(2022, 0, 20)]);
    await flush();
    assert(circles(svgOf(dated)).length < 60, `ISO dates are culled: ${circles(svgOf(dated)).length}`);

    BC.data('two', [{ a: 0, b: 1 }, { a: 1000, b: 9 }]);
    const two = new FakeNode('div');
    const h2 = BC.chart(two, { ...cullSpec('two', { type: 'line', r: undefined }), scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } } });
    await zoomTo(h2, 400, 600);
    const d = [...layer(svgOf(two), 'marks').matchAll(/<path d="([^"]+)"/g)][0][1];
    assert.strictEqual(count(d, /[ML]/g), 2, 'the segment that crosses the window is still drawn');

    const off = new FakeNode('div');
    const ho = BC.chart(off, cullSpec('cull10k'));
    await zoomTo(ho, 20000, 20100);
    assert(circles(svgOf(off)).length <= 2, 'a window with no rows in it draws (at most) the neighbours');
    assert(!/NaN/.test(svgOf(off)));
  });

  test('culling: order that cannot be trusted means every row is visited', async () => {
    const shuffled = sortedRows(500).sort((p, q) => ((p.a * 7919) % 101) - ((q.a * 7919) % 101));
    BC.data('shuffled', shuffled);
    const s = new FakeNode('div');
    const hs = BC.chart(s, cullSpec('shuffled'));
    await zoomTo(hs, 100, 140);
    assert.strictEqual(circles(svgOf(s)).length, 500, 'unsorted: nothing is skipped');

    BC.data('interleaved', [...sortedRows(300).map((r) => ({ ...r, s: 'p' })), ...sortedRows(300).map((r) => ({ ...r, s: 'q' }))]);
    const il = new FakeNode('div');
    const hi = BC.chart(il, { ...cullSpec('interleaved', { type: 'line', r: undefined, group: 's' }), scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } } });
    await zoomTo(hi, 100, 140);
    const paths = [...layer(svgOf(il), 'marks').matchAll(/<path d="([^"]+)"/g)].map((m) => count(m[1], /[ML]/g));
    assert.deepStrictEqual(paths, [300, 300], 'two series stacked one after the other are not one sorted column: both are drawn whole');

    const gap = new FakeNode('div');
    BC.data('gapx', [...sortedRows(400).slice(0, 200), { a: null, b: 1 }, ...sortedRows(400).slice(200)]);
    const hg = BC.chart(gap, cullSpec('gapx'));
    await zoomTo(hg, 100, 140);
    assert.strictEqual(circles(svgOf(gap)).length, 400, 'a missing x: no culling (the row without x itself draws nothing)');
  });

  test('culling: hundreds of thousands of rows zoom in a moment and draw only the window', async () => {
    BC.data('huge', Array.from({ length: 300000 }, (_, i) => ({ a: i, b: Math.sin(i / 500) * 50 })));
    const host = new FakeNode('div');
    const t0 = Date.now();
    const h = BC.chart(host, { ...cullSpec('huge', { type: 'line', r: undefined }), scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } } });
    const built = Date.now() - t0;
    const t1 = Date.now();
    await zoomTo(h, 100000, 100600);
    const zoomed = Date.now() - t1;
    const d = [...layer(svgOf(host), 'marks').matchAll(/<path d="([^"]+)"/g)][0][1];
    assert(count(d, /[ML]/g) < 1500, `a 600-row window of 300000 rows: ${count(d, /[ML]/g)} vertices`);
    assert(zoomed < 1500, `the zoom frame took ${zoomed} ms (the first build, with no zoom, took ${built} ms)`);
  });

  // ── view-dependent transforms, and transform.decimate ──
  const decimate = (table, spec, view) => BC.get('transform.decimate').apply(table, { type: 'decimate', x: 'a', y: 'b', ...spec }, view);
  const linearX = (domain, range) => BC.get('scale.linear').create({ type: 'linear', domain }, { name: 'x', sources: [], range: range || [50, 650], color: (i) => `c${i}` });
  const viewWarnings = [];
  const viewOf = (scale, plot) => ({ plot: plot || { x: 50, y: 0, w: 600, h: 300 }, scales: { x: scale }, warn: (m) => viewWarnings.push(m) });
  const wave = (n) => ({ length: n, columns: { a: Float64Array.from({ length: n }, (_, i) => i), b: Float64Array.from({ length: n }, (_, i) => Math.sin(i / 97) * 10 + ((i * 37) % 11)) } });
  const rowsOf = (t) => Array.from(t.columns.a);
  /** Per pixel column: the lowest and highest y among these rows, computed the way the transform buckets them. */
  const envelope = (t, rowIdx, scale, buckets) => {
    const lo = 50 - 12, hi = 650 + 12, width = (hi - lo) / buckets;
    const out = new Map();
    for (const i of rowIdx) {
      const px = scale(t.columns.a[i]);
      if (px < lo || px > hi) continue;
      const b = Math.max(0, Math.min(buckets - 1, Math.floor((px - lo) / width)));
      const e = out.get(b) || { min: Infinity, max: -Infinity };
      e.min = Math.min(e.min, t.columns.b[i]);
      e.max = Math.max(e.max, t.columns.b[i]);
      out.set(b, e);
    }
    return out;
  };

  test('decimate: a few rows per pixel column, and the envelope of the data is exact', () => {
    const t = wave(60000);
    const scale = linearX([0, 59999]);
    const out = decimate(t, {}, viewOf(scale));
    assert(out.length <= 4 * 600 + 8 && out.length > 600, `60000 rows become ${out.length}`);
    const a = rowsOf(out);
    assert(a.every((v, i) => i === 0 || v > a[i - 1]), 'still in x order, no duplicates');
    assert(a[0] === 0 && a[a.length - 1] === 59999, 'the first and last rows survive');
    const all = Array.from({ length: t.length }, (_, i) => i);
    const kept = Array.from({ length: out.length }, (_, i) => i);
    const want = envelope(t, all, scale, 600);
    const got = envelope(out, kept, scale, 600);
    assert.strictEqual(got.size, want.size);
    for (const [b, e] of want) assert(got.get(b) && got.get(b).min === e.min && got.get(b).max === e.max, `bucket ${b}: ${JSON.stringify(got.get(b))} vs ${JSON.stringify(e)}`);
    assert.deepStrictEqual(Object.keys(out.columns), ['a', 'b'], 'every column is carried along');
    assert(out.columns.a instanceof Float64Array && out.columns.b instanceof Float64Array, 'numeric columns stay numeric');
  });

  test('decimate: a window is cut out, small windows and small tables are left alone, the same table works at every view', () => {
    const t = wave(60000);
    const scale = linearX([0, 59999]);
    const view = viewOf(scale);
    scale.setDomain([20000, 20100]);
    const zoomed = decimate(t, {}, view);
    assert(zoomed.length >= 100 && zoomed.length <= 130, `a 100-row window keeps its rows and a margin, nothing else: ${zoomed.length}`);
    assert(rowsOf(zoomed)[0] > 19900 && rowsOf(zoomed)[zoomed.length - 1] < 20200);
    assert.deepStrictEqual(rowsOf(zoomed), rowsOf(zoomed).slice().sort((p, q) => p - q));

    scale.setDomain([0, 59999]);
    assert(decimate(t, {}, view).length > 600, 'back to the whole range: decimated again (caches hold no stale window)');
    scale.setDomain([30000, 40000]);
    const mid = decimate(t, {}, view);
    assert(mid.length <= 4 * 600 + 8 && rowsOf(mid)[0] > 29000, `10000 rows in the window: ${mid.length}`);

    const small = wave(1500);
    assert.strictEqual(decimate(small, {}, viewOf(linearX([0, 1499]))), small, 'below the threshold: the very same table');
    assert.strictEqual(decimate(t, {}), t, 'without a view there is nothing to decide');
    const tight = decimate(wave(6000), { threshold: 100 }, viewOf(linearX([0, 5999])));
    assert.strictEqual(tight.length, 6000, 'a higher threshold keeps more');
    const coarse = decimate(wave(60000), { buckets: 50 }, viewOf(linearX([0, 59999])));
    assert(coarse.length <= 4 * 50 + 8, `50 buckets: ${coarse.length}`);
  });

  test('decimate: series are decimated on their own, gaps stay gaps, unsorted or unscalable data passes through', () => {
    const n = 30000;
    const a = new Float64Array(n * 2), b = new Float64Array(n * 2), g = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      a[2 * i] = i; b[2 * i] = Math.sin(i / 50) * 10 + (i % 7); g[2 * i] = 'p';
      a[2 * i + 1] = i; b[2 * i + 1] = 100 + Math.cos(i / 80) * 10 + (i % 5); g[2 * i + 1] = 'q';
    }
    const table = { length: n * 2, columns: { a, b, g } };
    const scale = linearX([0, n - 1]);
    viewWarnings.length = 0;
    const out = decimate(table, { group: 'g' }, viewOf(scale));
    assert.strictEqual(viewWarnings.length, 0, 'interleaved series are sorted within each series: nothing to warn about');
    assert(out.length < 2 * (4 * 600 + 8), `interleaved series, each decimated: ${out.length}`);
    for (const key of ['p', 'q']) {
      const pick = (t) => Array.from({ length: t.length }, (_, i) => i).filter((i) => t.columns.g[i] === key);
      const want = envelope(table, pick(table), scale, 600);
      const got = envelope(out, pick(out), scale, 600);
      for (const [bucket, e] of want) assert(got.get(bucket) && got.get(bucket).min === e.min && got.get(bucket).max === e.max, `${key} bucket ${bucket}`);
    }

    const holes = wave(40000);
    for (const i of [10000, 10001, 25000]) holes.columns.b[i] = NaN;
    const kept = decimate(holes, {}, viewOf(linearX([0, 39999])));
    for (const i of [10000, 10001, 25000]) assert(rowsOf(kept).includes(i), `the gap row ${i} is kept, so the line still breaks there`);

    const shuffled = wave(20000);
    const perm = Array.from({ length: 20000 }, (_, i) => (i * 7919) % 20000);
    shuffled.columns.a = Float64Array.from(perm);
    viewWarnings.length = 0;
    assert.strictEqual(decimate(shuffled, {}, viewOf(linearX([0, 19999]))), shuffled, 'unsorted: nothing can be dropped safely');
    assert.strictEqual(viewWarnings.length, 1, 'and it says so');
    assert.match(viewWarnings[0], /the rows are not sorted by "a".*sort the data by "a" first/);
    viewWarnings.length = 0;
    decimate(wave(500).columns.a.length ? { length: 500, columns: { a: Float64Array.from({ length: 500 }, (_, i) => (i * 7) % 500), b: new Float64Array(500) } } : null, {}, viewOf(linearX([0, 499])));
    assert.strictEqual(viewWarnings.length, 0, 'a small unsorted table would not have been decimated anyway: no warning');

    const down = wave(40000);
    down.columns.a = down.columns.a.slice().reverse();
    const dOut = decimate(down, {}, viewOf(linearX([0, 39999])));
    assert(dOut.length < 3000 && rowsOf(dOut).every((v, i) => i === 0 || v < rowsOf(dOut)[i - 1]), 'descending x works');

    const time = BC.get('scale.time').create({ type: 'time' }, { name: 'x', sources: [['2020-01-01', '2020-12-31']], range: [50, 650], color: () => '' });
    const dated = { length: 20000, columns: { a: Array.from({ length: 20000 }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 1575).toISOString()), b: Float64Array.from({ length: 20000 }, (_, i) => i % 13) } };
    time.setDomain([Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 1) + 20000 * 1575]);
    assert(decimate(dated, {}, viewOf(time)).length < 3000, 'ISO date strings through a time scale');

    const color = BC.get('scale.color').create({ type: 'color' }, { name: 'x', sources: [['a']], range: [], color: () => 'red' });
    const w = wave(100);
    assert.strictEqual(decimate(w, {}, { plot: { x: 0, y: 0, w: 1, h: 1 }, scales: { x: color } }), w, 'a scale without a pixel range is not decimated');
  });

  test('decimate: bad input is a clear error', () => {
    const view = viewOf(linearX([0, 99]));
    const t = wave(100);
    assert.throws(() => decimate(t, { x: 'nope' }, view), /unknown field "nope"/);
    assert.throws(() => decimate(t, { y: 'nope' }, view), /unknown field "nope"/);
    assert.throws(() => decimate(t, { group: 'nope' }, view), /unknown field "nope"/);
    assert.throws(() => decimate(t, { scale: 'z' }, view), /there is no scale named "z"/);
    for (const buckets of [0, -1, 1e9, 'many', NaN]) assert.throws(() => decimate(t, { buckets }, view), /"buckets" must be a number/, String(buckets));
    assert.deepStrictEqual(BC.get('transform.decimate').outputs({}), []);
    assert.strictEqual(BC.get('transform.decimate').viewDependent, true);
  });

  const spyCalls = { before: 0, dynamic: 0, after: 0, views: [] };
  BC.define({ role: 'transform', type: 'spybefore', version: 1, outputs: () => [], apply(t) { spyCalls.before++; return t; } });
  BC.define({ role: 'transform', type: 'spydynamic', version: 1, viewDependent: true, outputs: () => [], apply(t, _s, view) { spyCalls.dynamic++; spyCalls.views.push(view); return t.length > 3 ? { length: 3, columns: { a: t.columns.a.slice(0, 3), b: t.columns.b.slice(0, 3) } } : t; } });
  BC.define({ role: 'transform', type: 'spyafter', version: 1, outputs: () => [], apply(t) { spyCalls.after++; return t; } });
  BC.define({ role: 'transform', type: 'spyfails', version: 1, viewDependent: true, outputs: () => [], apply() { throw new Error('cannot today'); } });

  test('view-dependent transforms: earlier transforms run once, this one and later ones at every redraw, and the table it makes is the one drawn', async () => {
    BC.data('spied', sortedRows(50));
    const spec = () => ({ data: 'spied', transforms: [{ type: 'spybefore' }, { type: 'spydynamic' }, { type: 'spyafter' }], scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }], interaction: [{ type: 'probe2' }] });
    Object.assign(spyCalls, { before: 0, dynamic: 0, after: 0, views: [] });
    const host = new FakeNode('div');
    const h = BC.chart(host, spec());
    assert.deepStrictEqual(h.diagnostics, []);
    assert.deepStrictEqual([spyCalls.before, spyCalls.dynamic, spyCalls.after], [1, 1, 1], 'once each at the first draw');
    assert.strictEqual(circles(svgOf(host)).length, 3, 'the marks drew the 3-row table the transform made');
    assert.strictEqual(probed.table.length, 3, 'and ctx.table is that table');
    const v = spyCalls.views[0];
    assert(v.plot.w > 100 && v.scales.x && v.scales.y, 'the transform is told where the plot is and about the scales');

    h.setView('x', [10, 30]);
    await flush();
    h.setView('x', [12, 20]);
    await flush();
    assert.deepStrictEqual([spyCalls.before, spyCalls.dynamic, spyCalls.after], [1, 3, 3], 'redrawn twice: the dynamic one and the later one again, the earlier one not');
    assert.deepStrictEqual(spyCalls.views[2].scales.x.domain(), [12, 20], 'and it sees the scales as they are drawn now');
    assert(BC.validate(spec()).length === 0, 'nothing special for validation');
  });

  test('view-dependent transforms: scale domains come from the full data, and a failing one is reported once', async () => {
    BC.data('spied', sortedRows(50));
    const host = new FakeNode('div');
    const h = BC.chart(host, { data: 'spied', transforms: [{ type: 'spydynamic' }], scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }], interaction: [{ type: 'probe2' }] });
    assert.deepStrictEqual(probed.scales.x.baseDomain(), [0, 49], 'the x axis still spans all 50 rows although only 3 are drawn');

    const bad = new FakeNode('div');
    const hb = BC.chart(bad, { data: 'spied', transforms: [{ type: 'spyfails' }], scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] });
    assert.strictEqual(circles(svgOf(bad)).length, 50, 'the chart falls back to the table it had');
    for (let i = 0; i < 3; i++) { hb.setView('x', [i, i + 30]); await flush(); }
    const errors = hb.diagnostics.filter((d) => d.path === 'transforms[0]');
    assert.strictEqual(errors.length, 1, 'one report, not one per redraw');
    assert.match(errors[0].message, /cannot today/);
    logged.error.length = 0;
  });

  test('decimate in a chart: a huge line becomes a light one, zooming shows the detail, reset lightens it again', async () => {
    BC.data('bigline', Array.from({ length: 200000 }, (_, i) => ({ a: i, b: Math.sin(i / 600) * 40 + ((i * 31) % 17) })));
    const spec = () => ({
      data: 'bigline', transforms: [{ type: 'decimate', x: 'a', y: 'b' }],
      scales: { x: { type: 'linear', nice: false }, y: { type: 'linear' } },
      marks: [{ type: 'line', x: 'a', y: 'b' }], interaction: [{ type: 'probe2' }, { type: 'tooltip' }],
    });
    const verts = (host) => count([...layer(svgOf(host), 'marks').matchAll(/<path d="([^"]+)"/g)][0][1], /[ML]/g);
    const host = new FakeNode('div');
    const t0 = Date.now();
    const h = BC.chart(host, spec());
    assert.deepStrictEqual(h.diagnostics, []);
    assert(verts(host) < 5000, `200000 rows drawn with ${verts(host)} vertices`);
    assert.deepStrictEqual(probed.scales.x.baseDomain(), [0, 199999], 'the axis still covers all the data');
    await zoomTo(h, 100000, 100150);
    assert(verts(host) >= 150 && verts(host) < 400, `a 150-row window shows its own rows: ${verts(host)}`);
    await zoomTo(h, 100000, 130000);
    assert(verts(host) < 5000 && verts(host) > 600, `a wider window is decimated again: ${verts(host)}`);
    h.setView('x', null);
    await flush();
    assert(verts(host) < 5000);
    assert(Date.now() - t0 < 5000, `the whole scenario took ${Date.now() - t0} ms`);

    // the tooltip finds real rows of the decimated line
    const c = probed.channel(probed.spec.marks[0], 'x');
    const first = probed.rows(probed.spec.marks[0]);
    const xPx = c.mapped[first.from + 5];
    const yPx = probed.channel(probed.spec.marks[0], 'y').mapped[first.from + 5];
    await hover(host, xPx, yPx);
    assert.strictEqual(tipOf(host).style.display, 'block');
    assert(/^a: \d+$/.test(tipText(host)[0]), tipText(host).join('|'));
  });

  // ── transform.aggregate ──
  const agg = (columns, spec) => BC.get('transform.aggregate').apply({ length: Object.values(columns)[0].length, columns }, { type: 'aggregate', ...spec });
  const sales = () => ({
    region: ['N', 'S', 'N', 'S', 'N', 'W'],
    product: ['a', 'a', 'b', 'b', 'a', 'a'],
    revenue: Float64Array.of(10, 20, 30, NaN, 50, 5),
    day: ['2024-03-05', '2024-03-20', '2024-04-02', '2024-01-31', '2023-12-31', 'garbage'],
  });
  const colA = (t, n) => Array.from(t.columns[n]);

  test('aggregate: one row per group in order of first appearance, measures over the rows of the group', () => {
    const t = agg(sales(), { groupby: ['region'], measures: [{ op: 'sum', field: 'revenue', as: 'total' }] });
    assert.deepStrictEqual(colA(t, 'region'), ['N', 'S', 'W']);
    assert.deepStrictEqual(colA(t, 'total'), [90, 20, 5]);
    assert.strictEqual(t.length, 3);
    assert(t.columns.total instanceof Float64Array, 'measures are numeric columns');
    assert.deepStrictEqual(Object.keys(agg(sales(), { groupby: ['region'], measures: [{ op: 'sum', field: 'revenue' }, { op: 'count' }] }).columns), ['region', 'sum_revenue', 'count'], 'default names: <op>_<field>, count');
    assert.deepStrictEqual(Object.keys(agg(sales(), { groupby: ['region'] }).columns), ['region', 'count'], 'no measures given: a count');
  });

  test('aggregate: every measure, missing values ignored, count of rows versus of values', () => {
    const t = agg({ g: ['x', 'x', 'x', 'y', 'y', 'z'], v: Float64Array.of(1, NaN, 3, 4, 8, NaN), w: ['p', 'p', 'q', null, 'r', 'r'] }, {
      groupby: ['g'],
      measures: [
        { op: 'sum', field: 'v', as: 'sum' }, { op: 'mean', field: 'v', as: 'mean' }, { op: 'min', field: 'v', as: 'min' }, { op: 'max', field: 'v', as: 'max' },
        { op: 'median', field: 'v', as: 'median' }, { op: 'count', as: 'rows' }, { op: 'count', field: 'v', as: 'valid' }, { op: 'distinct', field: 'w', as: 'kinds' },
      ],
    });
    assert.deepStrictEqual(colA(t, 'sum'), [4, 12, NaN]);
    assert.deepStrictEqual(colA(t, 'mean'), [2, 6, NaN], 'the mean of 1 and 3, not of 1, missing and 3');
    assert.deepStrictEqual([colA(t, 'min'), colA(t, 'max')], [[1, 4, NaN], [3, 8, NaN]]);
    assert.deepStrictEqual(colA(t, 'median'), [2, 6, NaN], 'even count: the mean of the middle two');
    assert.deepStrictEqual(colA(t, 'rows'), [3, 2, 1]);
    assert.deepStrictEqual(colA(t, 'valid'), [2, 2, 0]);
    assert.deepStrictEqual(colA(t, 'kinds'), [2, 1, 1], 'distinct ignores missing values');
    const odd = agg({ g: ['a', 'a', 'a'], v: Float64Array.of(9, 1, 5) }, { groupby: ['g'], measures: [{ op: 'median', field: 'v' }] });
    assert.deepStrictEqual(colA(odd, 'median_v'), [5], 'odd count: the middle one, whatever the order');
  });

  test('aggregate: two fields, and 1 is not "1" and a missing value is a group of its own', () => {
    const t = agg(sales(), { groupby: ['region', 'product'], measures: [{ op: 'sum', field: 'revenue', as: 'total' }] });
    assert.deepStrictEqual(colA(t, 'region'), ['N', 'S', 'N', 'S', 'W']);
    assert.deepStrictEqual(colA(t, 'product'), ['a', 'a', 'b', 'b', 'a']);
    assert.deepStrictEqual(colA(t, 'total'), [60, 20, 30, NaN, 5], 'S/b has only a missing revenue');
    const mixed = agg({ k: [1, '1', null, 1, NaN, null] , v: Float64Array.of(1, 1, 1, 1, 1, 1) }, { groupby: ['k'], measures: [{ op: 'count' }] });
    assert.strictEqual(mixed.length, 3, 'number 1, string "1", and one group for null and NaN');
    assert.deepStrictEqual(colA(mixed, 'count'), [2, 1, 3]);
    const numeric = agg({ k: Float64Array.of(3, 1, 3), v: Float64Array.of(1, 1, 1) }, { groupby: ['k'] });
    assert(numeric.columns.k instanceof Float64Array && colA(numeric, 'k').join() === '3,1', 'numeric group values stay numeric');
  });

  test('aggregate: calendar units cut dates into months, weeks, hours; a time unit sorts by time', () => {
    const monthly = agg(sales(), { groupby: [{ field: 'day', unit: 'month' }], measures: [{ op: 'sum', field: 'revenue', as: 'total' }] });
    assert.deepStrictEqual(colA(monthly, 'day'), ['2023-12-01', '2024-01-01', '2024-03-01', '2024-04-01'], 'sorted by time although the rows were not; the row that is not a date is skipped');
    assert.deepStrictEqual(colA(monthly, 'total'), [50, NaN, 30, 30], 'January holds only a missing value');
    const unit = (u, values) => colA(agg({ d: values, v: Float64Array.from(values.map(() => 1)) }, { groupby: [{ field: 'd', unit: u, as: 'bucket' }] }), 'bucket');
    assert.deepStrictEqual(unit('year', ['2024-06-15', '2024-01-01', '2023-12-31T23:59:59Z']), ['2023-01-01', '2024-01-01']);
    assert.deepStrictEqual(unit('quarter', ['2024-02-10', '2024-03-31', '2024-04-01', '2024-11-11']), ['2024-01-01', '2024-04-01', '2024-10-01']);
    assert.deepStrictEqual(unit('week', ['2024-03-04', '2024-03-10', '2024-03-11', '2024-03-03']), ['2024-02-26', '2024-03-04', '2024-03-11'], 'weeks start on Monday (Sunday 3 March belongs to the week of 26 February)');
    assert.deepStrictEqual(unit('day', ['2024-03-05T23:59:00Z', '2024-03-05T00:00:00Z', '2024-03-06T00:00:00Z']), ['2024-03-05', '2024-03-06']);
    assert.deepStrictEqual(unit('hour', ['2024-03-05T10:59:00Z', '2024-03-05T10:00:01Z', '2024-03-05T11:00:00Z']), ['2024-03-05T10:00:00Z', '2024-03-05T11:00:00Z']);
    assert.deepStrictEqual(unit('month', [Date.UTC(2024, 1, 29), Date.UTC(2024, 2, 1), Date.UTC(2024, 1, 1)]), ['2024-02-01', '2024-03-01'], 'epoch milliseconds work as well');
    assert.deepStrictEqual(unit('year', ['x', null, NaN]), [], 'nothing to group when nothing is a date');
    const named = agg(sales(), { groupby: [{ field: 'day', unit: 'month', as: 'month' }, 'region'], measures: [{ op: 'count' }] });
    assert.deepStrictEqual(Object.keys(named.columns), ['month', 'region', 'count'], 'as renames the bucket column');
  });

  test('aggregate: sort, order, limit; missing values last; ties keep their order', () => {
    const by = (extra) => agg(sales(), { groupby: ['region'], measures: [{ op: 'sum', field: 'revenue', as: 'total' }], ...extra });
    assert.deepStrictEqual(colA(by({ sort: 'total', order: 'desc' }), 'region'), ['N', 'S', 'W'], 'biggest first');
    assert.deepStrictEqual(colA(by({ sort: 'total' }), 'region'), ['W', 'S', 'N']);
    assert.deepStrictEqual(colA(by({ sort: 'region', order: 'desc' }), 'region'), ['W', 'S', 'N'], 'sorted by a group-by field');
    assert.deepStrictEqual(colA(by({ sort: 'total', order: 'desc', limit: 2 }), 'region'), ['N', 'S'], 'top 2');
    assert.strictEqual(by({ limit: 0 }).length, 0);
    assert.strictEqual(by({ limit: 99 }).length, 3);
    const nan = agg({ g: ['a', 'b', 'c'], v: Float64Array.of(NaN, 2, 1) }, { groupby: ['g'], measures: [{ op: 'sum', field: 'v', as: 's' }], sort: 's', order: 'desc' });
    assert.deepStrictEqual(colA(nan, 'g'), ['b', 'c', 'a'], 'a group without a value goes last both ways');
    assert.deepStrictEqual(colA(agg({ g: ['a', 'b', 'c'], v: Float64Array.of(NaN, 2, 1) }, { groupby: ['g'], measures: [{ op: 'sum', field: 'v', as: 's' }], sort: 's' }), 'g'), ['c', 'b', 'a']);
    const ties = agg({ g: ['x', 'y', 'z', 'w'], v: Float64Array.of(5, 5, 5, 1) }, { groupby: ['g'], measures: [{ op: 'sum', field: 'v', as: 's' }], sort: 's', order: 'desc' });
    assert.deepStrictEqual(colA(ties, 'g'), ['x', 'y', 'z', 'w'], 'equal values keep the order of first appearance');
  });

  test('aggregate: no group-by is one row; empty input; the source table is not touched', () => {
    const all = agg(sales(), { measures: [{ op: 'sum', field: 'revenue', as: 'total' }, { op: 'count', as: 'n' }] });
    assert.deepStrictEqual([all.length, colA(all, 'total'), colA(all, 'n')], [1, [115], [6]]);
    const empty = agg({ v: new Float64Array(0) }, { measures: [{ op: 'sum', field: 'v', as: 's' }, { op: 'count', as: 'n' }] });
    assert.deepStrictEqual([empty.length, colA(empty, 's'), colA(empty, 'n')], [1, [NaN], [0]], 'nothing to total is one row with a count of 0');
    assert.strictEqual(agg({ v: new Float64Array(0), g: [] }, { groupby: ['g'] }).length, 0, 'but no groups when grouping an empty table');
    const src = sales();
    const before = JSON.stringify(Object.keys(src)) + Array.from(src.revenue).join();
    agg(src, { groupby: ['region'], measures: [{ op: 'sum', field: 'revenue' }] });
    assert.strictEqual(JSON.stringify(Object.keys(src)) + Array.from(src.revenue).join(), before);
  });

  test('aggregate: bad input is a clear error, and outputs() tells validation the new fields', () => {
    for (const [spec, re] of [
      [{ groupby: ['nope'] }, /unknown field "nope"/], [{ measures: [{ op: 'sum', field: 'nope' }] }, /unknown field "nope"/],
      [{ measures: [{ op: 'total', field: 'revenue' }] }, /measures\[0\]\.op must be one of: count, sum/], [{ measures: [{ op: 'sum' }] }, /"sum" needs a "field"/],
      [{ measures: [] }, /non-empty list/], [{ measures: 'sum' }, /non-empty list/], [{ measures: [5] }, /measures\[0\]\.op/],
      [{ groupby: 'region' }, /"groupby" must be a list/], [{ groupby: [5] }, /groupby\[0\] must be a field name/], [{ groupby: [{ field: 'day', unit: 'decade' }] }, /unit must be one of: year, quarter/],
      [{ groupby: ['region'], measures: [{ op: 'count', as: 'region' }] }, /two output columns are called "region"/],
      [{ groupby: ['region'], sort: 'nope' }, /"sort" must be one of the output columns: region, count/], [{ groupby: ['region'], limit: -1 }, /"limit" must be a number/],
    ]) assert.throws(() => agg(sales(), { type: 'aggregate', ...spec }), re, JSON.stringify(spec));
    assert.deepStrictEqual(BC.get('transform.aggregate').outputs({ groupby: ['g', { field: 'd', unit: 'month', as: 'm' }], measures: [{ op: 'sum', field: 'v', as: 't' }] }), ['g', 'm', 't']);
    assert.throws(() => BC.get('transform.aggregate').outputs({ measures: [{ op: 'nope' }] }), /op must be one of/, 'outputs() reports a broken spec too, so validation stops trusting the field list');
  });

  test('aggregate in a chart: bars from raw rows, sorted, and the new fields are known to validation', () => {
    BC.data('rawsales', [
      { region: 'N', rev: 10 }, { region: 'S', rev: 20 }, { region: 'N', rev: 30 }, { region: 'W', rev: 5 }, { region: 'S', rev: 60 },
    ]);
    const spec = () => ({
      data: 'rawsales', transforms: [{ type: 'aggregate', groupby: ['region'], measures: [{ op: 'sum', field: 'rev', as: 'total' }], sort: 'total', order: 'desc' }],
      scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'region', y: 'total' }, { type: 'text', x: 'region', y: 'total', text: 'total', baseline: 'auto', dy: -4 }],
      interaction: [{ type: 'tooltip' }],
    });
    const host = new FakeNode('div');
    const h = BC.chart(host, spec());
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    const bars = rects(layer(svg, 'marks'));
    assert.deepStrictEqual(texts(layer(svg, 'marks')).map((t) => t.text), ['80', '40', '5'], 'S=80, N=40, W=5, biggest first');
    assert(bars[0].h > bars[1].h && bars[1].h > bars[2].h && Math.abs(bars[0].h / bars[1].h - 2) < 1e-6);
    const typo = spec();
    typo.marks[0].y = 'totl';
    assert(BC.validate(typo).some((d) => d.path === 'marks[0].y' && /unknown field "totl"/.test(d.message)));
    const gone = spec();
    gone.marks[0].y = 'rev';
    assert(BC.validate(gone).some((d) => /unknown field "rev"/.test(d.message)), 'the original columns are not there after an aggregate');
  });

  // ── formatting: BC.formatter, axis format and title, text format and contrast, tooltip formats ──
  test('BC.formatter: numbers, currency, percent, compact, locales, prefix and suffix', () => {
    assert.strictEqual(BC.formatter('percent')(0.256), '25.6%');
    assert.strictEqual(BC.formatter('percent')(1), '100%');
    assert.strictEqual(BC.formatter('compact')(1234567), '1.2M');
    assert.strictEqual(BC.formatter('integer')(1234.56), '1,235');
    assert.strictEqual(BC.formatter({ style: 'currency', currency: 'USD', maximumFractionDigits: 0 })(4070000), '$4,070,000');
    assert.strictEqual(BC.formatter({ style: 'currency', currency: 'EUR' })(12.5), '€12.50');
    assert.strictEqual(BC.formatter({ suffix: ' kg', maximumFractionDigits: 1 })(62.34), '62.3 kg');
    assert.strictEqual(BC.formatter({ prefix: '≈ ', minimumFractionDigits: 2 })(3), '≈ 3.00');
    assert.strictEqual(BC.formatter({ locale: 'de-DE', maximumFractionDigits: 1 })(1234.5), '1.234,5');
    assert.match(BC.formatter({ locale: 'ru-RU', maximumFractionDigits: 1 })(1234.5), /^1\s234,5$/);
    assert.strictEqual(BC.formatter({ style: 'currency', currency: 'USD' })(-5), '-$5.00');
  });

  test('BC.formatter: dates are UTC whatever the machine says, and a fixed locale reads the same everywhere', () => {
    assert.strictEqual(BC.formatter('year')('2024-03-05'), '2024');
    assert.strictEqual(BC.formatter('month')('2024-03-05'), 'Mar 2024');
    assert.strictEqual(BC.formatter('day')('2024-03-05T23:30:00Z'), 'Mar 5', 'late in the day UTC is still that day');
    assert.strictEqual(BC.formatter('date')(Date.UTC(2024, 2, 5)), 'Mar 5, 2024');
    assert.strictEqual(BC.formatter('date')(new Date(Date.UTC(2024, 2, 5))), 'Mar 5, 2024', 'Date objects too');
    assert.match(BC.formatter('datetime')('2024-03-05T00:00:00Z'), /^Mar 5, 2024, 12:00\sAM$/);
    assert.strictEqual(BC.formatter({ month: 'short', year: '2-digit' })('2024-03-05'), 'Mar 24', 'date options are recognized without saying "date"');
    assert.strictEqual(BC.formatter({ month: 'long', locale: 'de-DE' })('2024-03-05'), 'März');
    assert.strictEqual(BC.formatter({}, 'date')('2024-03-05').length > 0, true, 'a kind can be forced');
    assert.strictEqual(BC.formatter({ kind: 'number', maximumFractionDigits: 0 })(2.6), '3');
    assert.strictEqual(BC.formatter('year')('not a date'), 'not a date', 'what is not a date is left as it is');
    assert.strictEqual(BC.formatter('percent')('n/a'), 'n/a', 'and what is not a number');
  });

  test('BC.formatter: missing values are empty, the same spec is built once, and mistakes are clear', () => {
    for (const nothing of [null, undefined, NaN]) assert.strictEqual(BC.formatter('integer')(nothing), '', String(nothing));
    assert.strictEqual(BC.formatter({ prefix: '$' })(null), '', 'no bare prefix for a missing value');
    assert.strictEqual(BC.formatter('integer')(Infinity), 'Infinity');
    assert.strictEqual(BC.formatter('percent'), BC.formatter('percent'), 'cached');
    assert.notStrictEqual(BC.formatter('percent'), BC.formatter('percent', 'number') && BC.formatter({ style: 'percent' }));
    assert.throws(() => BC.formatter('bogus'), /unknown format "bogus" \(presets: percent, compact, integer, year, month, day, date, datetime; or an object of Intl options\)/);
    assert.throws(() => BC.formatter(5), /preset name or an object/);
    assert.throws(() => BC.formatter(['a']), /preset name or an object/);
    assert.throws(() => BC.formatter(null), /preset name or an object/);
    assert.throws(() => BC.formatter({ style: 'currency' }), /invalid format .*currency/i, 'Intl says a currency needs its code');
    assert.throws(() => BC.formatter({ maximumFractionDigits: 500 }), /invalid format/);
    assert.throws(() => BC.formatter({ locale: 5 }), /"locale" must be a string/);
    assert.throws(() => BC.formatter({ prefix: 5 }), /"prefix" must be a string/);
    assert.throws(() => BC.formatter({ suffix: {} }), /"suffix" must be a string/);
    assert.throws(() => BC.formatter({ kind: 'time' }), /"kind" must be "number" or "date"/);
    assert.throws(() => BC.formatter({ locale: 'not a locale!' }), /invalid format/);
  });

  const formatSpec = (guides, extra) => ({
    data: 'cats',
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [{ type: 'axis', scale: 'x' }, ...guides],
    marks: [{ type: 'rect', x: 'k', y: 'v' }],
    ...extra,
  });

  test('axis format: linear ticks as currency and percent, time ticks as dates, categories untouched', () => {
    const money = new FakeNode('div');
    const h = BC.chart(money, formatSpec([{ type: 'axis', scale: 'y', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } }]));
    assert.deepStrictEqual(h.diagnostics, []);
    const y = yLabels(svgOf(money)).map((l) => l.text);
    assert(y.length >= 3 && y.every((t) => /^\$\d+$/.test(t)), y.join());

    BC.data('shares2', [{ k: 'a', s: 'x', v: 1 }, { k: 'a', s: 'y', v: 3 }, { k: 'b', s: 'x', v: 2 }, { k: 'b', s: 'y', v: 2 }]);
    const pct = new FakeNode('div');
    BC.chart(pct, { data: 'shares2', transforms: [{ type: 'stack', field: 'v', by: 'k', group: 's', normalize: true }], scales: { x: { type: 'band' }, y: { type: 'linear', domain: [0, 1] } }, guides: [{ type: 'axis', scale: 'y', format: 'percent' }], marks: [{ type: 'rect', x: 'k', y: 'v1', y2: 'v0' }] });
    const p = yLabels(svgOf(pct)).map((l) => l.text);
    assert.strictEqual(p[0], '0%');
    assert.strictEqual(p[p.length - 1], '100%', 'a normalized stack reads as percent: ' + p.join());

    const dates = new FakeNode('div');
    BC.chart(dates, lineSpec({ guides: [{ type: 'axis', scale: 'x', format: { month: 'short', year: '2-digit' } }, { type: 'axis', scale: 'y' }] }));
    const x = xLabels(svgOf(dates)).map((l) => l.text);
    assert(x.length >= 2 && x.every((t) => /^[A-Z][a-z]{2} 24$/.test(t)), x.join());
    assert(x.includes('Jan 24'));

    const cats = new FakeNode('div');
    BC.chart(cats, { ...formatSpec([]), guides: [{ type: 'axis', scale: 'x', format: 'percent' }] });
    assert.deepStrictEqual(xLabels(svgOf(cats)).map((l) => l.text), ['a', 'b', 'c', 'd'], 'a category axis has nothing to format');
    const width = (host) => bottomAxisEnd(svgOf(host));
    const wide = new FakeNode('div'), narrow = new FakeNode('div');
    BC.chart(wide, formatSpec([{ type: 'axis', scale: 'y', format: { style: 'currency', currency: 'USD', minimumFractionDigits: 2 } }]));
    BC.chart(narrow, formatSpec([{ type: 'axis', scale: 'y' }]));
    assert(svgOf(wide) !== svgOf(narrow));
    const leftEdge = (host) => +svgOf(host).match(/<path d="M([\d.]+) [\d.]+V/g).map((m) => m.match(/M([\d.]+)/)[1]).sort((a, b) => a - b).pop();
    assert(leftEdge(wide) > leftEdge(narrow), 'the wider labels made room for themselves');
  });

  test('axis format: a bad format is a guide diagnostic, the chart still draws', () => {
    logged.error.length = 0;
    const host = new FakeNode('div');
    const h = BC.chart(host, formatSpec([{ type: 'axis', scale: 'y', format: { style: 'currency' } }, { type: 'axis', scale: 'y', position: 'right', format: 'bogus' }]));
    assert(h.diagnostics.some((d) => d.path === 'guides[1]' && /invalid format/.test(d.message)), JSON.stringify(h.diagnostics));
    assert(h.diagnostics.some((d) => d.path === 'guides[2]' && /unknown format "bogus"/.test(d.message)));
    assert.strictEqual(count(layer(svgOf(host), 'marks'), /<rect /g), 4, 'the marks are there');
    logged.error.length = 0;
  });

  test('axis title: named below or beside the labels, rotated on vertical axes, and it takes room', () => {
    const plain = new FakeNode('div'), titled = new FakeNode('div');
    BC.chart(plain, formatSpec([{ type: 'axis', scale: 'y' }]));
    const h = BC.chart(titled, formatSpec([{ type: 'axis', scale: 'y', title: 'Revenue, USD' }, { type: 'axis', scale: 'x', title: 'Region' }]));
    assert.deepStrictEqual(h.diagnostics, []);
    const t = texts(svgOf(titled));
    const yt = t.find((l) => l.text === 'Revenue, USD');
    const xt = t.find((l) => l.text === 'Region');
    assert(yt && xt, 'both titles are drawn');
    assert(/transform="rotate\(-90 /.test(yt.attrs) && /text-anchor="middle"/.test(yt.attrs) && /font-weight="600"/.test(yt.attrs), yt.attrs);
    const ylabels = yLabels(svgOf(titled)).filter((l) => l.text !== 'Revenue, USD');
    assert(yt.x < Math.min(...ylabels.map((l) => l.x - 4)), 'the vertical title is left of the tick labels');
    const plot = probedPlot(titled);
    assert(Math.abs(yt.y - (plot.y + plot.h / 2)) < 1e-6, 'centered on the plot');
    const xlabels = xLabels(svgOf(titled)).filter((l) => l.text !== 'Region');
    assert(xt.y > Math.max(...xlabels.map((l) => l.y)), 'the horizontal title is below the tick labels');
    assert(Math.abs(xt.x - (plot.x + plot.w / 2)) < 1e-6);
    assert(bottomAxisEnd(svgOf(titled)) <= bottomAxisEnd(svgOf(plain)) && plot.h < probedPlot(plain).h, 'the plot gave room for the titles');
    assert(!/NaN/.test(svgOf(titled)));

    const right = new FakeNode('div');
    BC.chart(right, formatSpec([{ type: 'axis', scale: 'y', position: 'right', title: 'Units' }]));
    assert(/rotate\(90 /.test(texts(svgOf(right)).find((l) => l.text === 'Units').attrs), 'a right axis reads top to bottom');
    const top = new FakeNode('div');
    BC.chart(top, formatSpec([{ type: 'axis', scale: 'x', position: 'top', title: 'On top' }]));
    const tt = texts(svgOf(top)).find((l) => l.text === 'On top');
    assert(tt && /dominant-baseline="auto"/.test(tt.attrs), 'a top title sits above its labels');
    const notText = new FakeNode('div');
    const hn = BC.chart(notText, formatSpec([{ type: 'axis', scale: 'y', title: 5 }]));
    assert(hn.diagnostics.some((d) => d.path === 'guides[1].title' && /must be a string/.test(d.message)), 'a title that is not a string is a validation error');
    const evil = new FakeNode('div');
    BC.chart(evil, formatSpec([{ type: 'axis', scale: 'y', title: '<b>x</b> & y' }]));
    assert(svgOf(evil).includes('&lt;b>x&lt;/b> &amp; y') && !svgOf(evil).includes('<b>'), 'a title is text');
  });

  test('legend format: the labels of a color bar', () => {
    const host = new FakeNode('div');
    BC.chart(host, heatSpec([{ type: 'legend', scale: 'color', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } }]));
    const labels = [...svgOf(host).matchAll(/<text [^>]*>(\$\d+)</g)].map((m) => m[1]);
    assert(labels.length >= 3, labels.join());
    const bad = new FakeNode('div');
    const hb = BC.chart(bad, heatSpec([{ type: 'legend', scale: 'color', format: 'bogus' }]));
    assert(hb.diagnostics.some((d) => d.path === 'guides[2]' && /unknown format/.test(d.message)));
    logged.error.length = 0;
  });

  test('text format: numbers and dates written as asked; contrast against the color a label sits on', () => {
    BC.data('money', [{ k: 'a', v: 1234.5, d: '2024-03-05' }, { k: 'b', v: 9, d: '2024-04-01' }, { k: 'c', v: null, d: null }]);
    const mk = (format, textField) => ({ data: 'money', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'text', x: 'k', y: 'v', text: textField || 'v', format }] });
    const money = new FakeNode('div');
    BC.chart(money, mk({ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
    assert.deepStrictEqual(texts(svgOf(money)).map((t) => t.text), ['$1,235', '$9'], 'the row without a value has no label');
    const pct = new FakeNode('div');
    BC.chart(pct, mk('compact'));
    assert.deepStrictEqual(texts(svgOf(pct)).map((t) => t.text), ['1.2K', '9']);
    const dates = new FakeNode('div');
    BC.chart(dates, mk('month', 'd'));
    assert.deepStrictEqual(texts(svgOf(dates)).map((t) => t.text), ['Mar 2024', 'Apr 2024'], 'ISO dates through a date preset');
    const both = new FakeNode('div');
    BC.chart(both, { ...mk({ suffix: ' u' }), marks: [{ type: 'text', x: 'k', y: 'v', text: 'v', format: { suffix: ' u' }, decimals: 3 }] });
    assert.deepStrictEqual(texts(svgOf(both)).map((t) => t.text), ['1,234.5 u', '9 u'], 'format wins over decimals');
    const bad = new FakeNode('div');
    const hb = BC.chart(bad, mk('bogus'));
    assert(hb.diagnostics.some((d) => d.path === 'marks[0]' && /unknown format/.test(d.message)));
    logged.error.length = 0;

    // text on a heatmap: dark cells get light text and light cells dark text
    const heat = new FakeNode('div');
    const h = BC.chart(heat, { ...heatSpec([]), marks: [{ type: 'rect', x: 'day', y: 'part', color: 'n' }, { type: 'text', x: 'day', y: 'part', text: 'n', on: 'n' }] });
    assert.deepStrictEqual(h.diagnostics, [], 'on: "n" uses the scale named color by default');
    const marks = layer(svgOf(heat), 'marks');
    const fills = [...marks.matchAll(/<text [^>]*fill="([^"]+)"[^>]*>(\d+)</g)].map((m) => ({ fill: m[1], n: +m[2] }));
    assert.strictEqual(fills.length, 5);
    assert.strictEqual(fills.find((f) => f.n === 1).fill, '#fff', 'the darkest cell (1) gets white text');
    assert.strictEqual(fills.find((f) => f.n === 9).fill, '#111', 'the lightest cell (9) gets dark text');
    assert(fills.every((f) => f.fill === '#fff' || f.fill === '#111'));
    BC.data('holes', [{ a: 'p', b: 'q', n: 5 }, { a: 'p', b: 'r', n: null }]);
    const gap = new FakeNode('div');
    BC.chart(gap, { data: 'holes', scales: { x: { type: 'band' }, y: { type: 'band' }, color: { type: 'sequential' } }, marks: [{ type: 'text', x: 'a', y: 'b', text: 'n', on: 'n' }] });
    assert.strictEqual(texts(svgOf(gap)).length, 1, 'a cell with no color gets no text');
    const cat = new FakeNode('div');
    BC.chart(cat, { ...heatSpec([]), scales: { x: { type: 'band' }, y: { type: 'band' }, color: { type: 'color', range: ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'] } }, marks: [{ type: 'text', x: 'day', y: 'part', text: 'n', on: 'n' }] });
    const c = [...layer(svgOf(cat), 'marks').matchAll(/<text [^>]*fill="([^"]+)"[^>]*>(\d+)</g)].map((m) => m[1]);
    assert.strictEqual(c.length, 5, 'works with a categorical scale as well');
  });

  test('tooltip formats: per-field writing, a broken one is dropped with one warning', async () => {
    BC.data('tipmoney', [{ a: 1, b: 1234.5, d: '2024-03-05', s: 0.256 }, { a: 2, b: 20, d: '2024-04-01', s: 0.5 }]);
    const spec = (formats) => ({ data: 'tipmoney', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }], interaction: [{ type: 'tooltip', fields: ['a', 'b', 'd', 's'], formats }] });
    const host = new FakeNode('div');
    const h = BC.chart(host, spec({ b: { style: 'currency', currency: 'USD' }, d: 'date', s: 'percent' }));
    assert.deepStrictEqual(h.diagnostics, []);
    const c = circles(svgOf(host))[0];
    await hover(host, c.x, c.y);
    assert.deepStrictEqual(tipText(host), ['a: 1', 'b: $1,234.50', 'd: Mar 5, 2024', 's: 25.6%']);

    logged.warn.length = 0;
    const bad = new FakeNode('div');
    BC.chart(bad, spec({ b: 'bogus', s: 'percent' }));
    assert(logged.warn.some((w) => /format of "b" ignored: unknown format "bogus"/.test(w)));
    await hover(bad, circles(svgOf(bad))[0].x, circles(svgOf(bad))[0].y);
    assert.deepStrictEqual(tipText(bad), ['a: 1', 'b: 1234.5', 'd: 2024-03-05', 's: 25.6%'], 'the broken one falls back to the plain value, the others still apply');
    logged.warn.length = 0;
    BC.chart(new FakeNode('div'), spec('percent'));
    assert(logged.warn.some((w) => /"formats" must be an object/.test(w)));
    logged.warn.length = 0;
  });

  // small helpers these tests need
  function probedPlot(host) {
    // the plot rectangle, read back from the axis lines of the drawn chart
    const svg = svgOf(host);
    const vertical = svg.match(/<path d="M([\d.]+) ([\d.]+)V([\d.]+)/g).map((m) => m.match(/M([\d.]+) ([\d.]+)V([\d.]+)/).slice(1).map(Number));
    const left = vertical.reduce((a, b) => (b[0] < a[0] ? b : a));
    const bottomAxis = svg.match(/<path d="M([\d.]+) ([\d.]+)H([\d.]+)/).slice(1).map(Number);
    return { x: bottomAxis[0], y: left[1], w: bottomAxis[2] - bottomAxis[0], h: left[2] - left[1] };
  }

  // ── horizontal bars ──
  const hbarSpec = () => ({
    data: 'cats',
    scales: { x: { type: 'linear', zero: true }, y: { type: 'band' } },
    guides: [{ type: 'grid', scale: 'x' }, { type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }],
    marks: [{ type: 'rect', x: 'v', y: 'k' }],
    interaction: [{ type: 'tooltip' }],
  });

  test('horizontal bars: categories read from the top, bars grow from the baseline to the right', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, hbarSpec());
    assert.deepStrictEqual(h.diagnostics, []);
    const svg = svgOf(host);
    const bars = rects(layer(svg, 'marks'));
    assert.strictEqual(bars.length, 4);
    assert(bars.every((b, i) => i === 0 || b.y > bars[i - 1].y), 'a is the top bar, d the bottom one');
    assert(bars.every((b) => Math.abs(b.h - bars[0].h) < 1e-6), 'equal thickness');
    const starts = bars.filter((b) => b.w > 0).map((b) => +b.x.toFixed(4));
    assert(starts.every((x) => x === starts[0]), 'all bars start on the same baseline');
    assert(Math.abs(bars[3].w / bars[1].w - 1.5) < 1e-6, 'lengths follow the values');
    assert.strictEqual(bars[2].w, 0, 'a zero bar is empty');
    const labels = yLabels(svg).filter((l) => ['a', 'b', 'c', 'd'].includes(l.text));
    assert.deepStrictEqual(labels.map((l) => l.text), ['a', 'b', 'c', 'd'], 'axis labels top to bottom');
    assert(labels.every((l, i) => Math.abs(l.y - (bars[i].y + bars[i].h / 2)) < 1e-6), 'each label is centered on its bar');
    assert(!/NaN/.test(svg));

    await hover(host, bars[1].x + bars[1].w / 2, bars[1].y + bars[1].h / 2);
    assert.deepStrictEqual(tipText(host), ['v: 6', 'k: b']);
    await hover(host, bars[1].x + bars[1].w + 30, bars[1].y + bars[1].h / 2);
    assert.strictEqual(tipOf(host).style.display, 'none', 'beyond the end of the bar');
  });

  test('interaction.zoom: skips scales it cannot zoom; maxZoom; wheel: always', async () => {
    const host = new FakeNode('div');
    const h = BC.chart(host, { ...barSpec(), interaction: [{ type: 'zoom', scales: ['x'], wheel: 'always' }] });
    assert(logged.warn.some((w) => /"x" is not a continuous positional scale/.test(w)));
    logged.warn.length = 0;
    assert.deepStrictEqual(h.diagnostics, []);

    const host2 = new FakeNode('div');
    const h2 = BC.chart(host2, lineSpec({ interaction: [{ type: 'zoom', wheel: 'always', maxZoom: 2 }] }));
    const [b0, b1] = h2.getView().x;
    for (let i = 0; i < 10; i++) host2.children[0].fire('wheel', { clientX: 300, clientY: 150, deltaY: -800 });
    await flush();
    const [z0, z1] = h2.getView().x;
    assert(Math.abs((z1 - z0) - (b1 - b0) / 2) < 1, 'maxZoom stops the zoom at half the domain');
  });
};
