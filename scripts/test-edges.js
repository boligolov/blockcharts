// Tests for input at the edges: times without an offset, broken specs and pages, odd scale domains, transforms whose
// columns collide, a figure that compares a sum with one row. Loaded by test.js.
const assert = require('assert');

module.exports = function ({ test, FakeNode, svgOf, count, logged, flush }) {
  const circles = (host) => [...svgOf(host).matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const texts = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const table = (rows) => {
    const columns = {};
    for (const k of Object.keys(rows[0] || {})) columns[k] = rows.map((r) => r[k]);
    return { length: rows.length, columns };
  };
  const apply = (type, rows, spec) => BC.get(`transform.${type}`).apply(table(rows), { type, ...spec });
  // a time zone far from UTC, so a time read as local time lands on other hours (and often another day)
  const inZone = (zone, fn) => {
    const saved = process.env.TZ;
    process.env.TZ = zone;
    try {
      return fn();
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  };

  // ── times ──

  test('BC.time: a date or a time without an offset is UTC, an offset is honored, nonsense and out-of-range are NaN', () => {
    inZone('Asia/Tokyo', () => {
      assert.strictEqual(new Date('2024-03-01T09:00').getUTCHours(), 0, 'the zone is in effect: the engine reads it as Tokyo time');
      const utc = Date.UTC(2024, 2, 1, 9, 0);
      assert.strictEqual(BC.time('2024-03-01T09:00'), utc);
      assert.strictEqual(BC.time('2024-03-01 09:00'), utc, 'a space, as CSV exports write it');
      assert.strictEqual(BC.time(' 2024-03-01T09:00:00.000 '), utc);
      assert.strictEqual(BC.time('2024-03-01T09:00:00,5'), utc + 500, 'a decimal comma');
      assert.strictEqual(BC.time('2024-03-01T09:00Z'), utc);
      assert.strictEqual(BC.time('2024-03-01T12:00+03:00'), utc);
      assert.strictEqual(BC.time('2024-03-01T12:00+03'), utc);
      assert.strictEqual(BC.time('2024-03-01T12:00+0300'), utc);
      assert.strictEqual(BC.time('2024-03-01'), Date.UTC(2024, 2, 1));
      assert.strictEqual(BC.time(new Date(utc)), utc);
      assert.strictEqual(BC.time(utc), utc);
      for (const bad of ['', 'soon', '2024-13-45T99:99', null, undefined, {}, true, 1e20, NaN, Infinity])
        assert(Number.isNaN(BC.time(bad)), String(bad));
    });
  });

  test('times without an offset: the scale, the bucket, the filter and the label all read the same UTC hour in any zone', () => {
    inZone('America/Los_Angeles', () => {
      BC.data('hours', [
        { t: '2024-03-01T09:00', v: 1 },
        { t: '2024-03-01 21:00', v: 2 },
        { t: '2024-03-02T09:00Z', v: 3 },
      ]);
      const host = new FakeNode('div');
      const h = BC.chart(host, {
        data: 'hours',
        size: [640, 300],
        scales: { x: { type: 'time', domain: ['2024-03-01T00:00Z', '2024-03-03T00:00Z'] }, y: { type: 'linear' } },
        marks: [{ type: 'point', x: 't', y: 'v' }],
      });
      assert.deepStrictEqual(
        h.diagnostics.filter((d) => d.level === 'error'),
        [],
      );
      const xs = circles(host).map((c) => c.x);
      // the three points are 12 hours apart: equal steps, whatever the machine's zone
      assert(Math.abs(xs[1] - xs[0] - (xs[2] - xs[1])) < 0.01, 'equally spaced: ' + xs.join(', '));
      const day = apply(
        'aggregate',
        [
          { t: '2024-03-01T02:00', v: 1 },
          { t: '2024-03-01T23:00', v: 2 },
        ],
        { groupby: [{ field: 't', unit: 'day' }], measures: [{ op: 'sum', field: 'v', as: 'sum' }] },
      );
      assert.strictEqual(day.length, 1, 'both on 1 March, not split by the local midnight');
      assert.strictEqual(Array.from(day.columns.sum)[0], 3);
      const later = apply('filter', [{ t: '2024-03-01T09:00' }, { t: '2024-03-01T10:00' }], {
        field: 't',
        op: '>',
        value: '2024-03-01T09:30Z',
      });
      assert.strictEqual(later.length, 1, 'the filter compares UTC with UTC');
      assert.strictEqual(
        BC.formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })('2024-03-01T09:00'),
        '09:00',
      );
    });
  });

  // ── broken specs and pages ──

  test('chart(): a spec that is not an object is an error in diagnostics, never a TypeError', () => {
    for (const bad of [null, undefined, 5, 'x', []]) {
      const host = new FakeNode('div');
      let h;
      assert.doesNotThrow(() => {
        h = BC.chart(host, bad);
      }, String(bad));
      assert(
        h.diagnostics.some((d) => d.level === 'error'),
        JSON.stringify(bad) + ': ' + JSON.stringify(h.diagnostics),
      );
      h.destroy();
    }
    logged.error.length = 0;
  });

  const page = (specs, elements = {}) => {
    const body = new FakeNode('body');
    body.insertBefore = (c) => {
      c.parentNode = body;
      body.children.push(c);
      return c;
    };
    const nodes = specs.map((s) => ({ textContent: typeof s === 'string' ? s : JSON.stringify(s), parentNode: body }));
    const created = [];
    const doc = {
      createElement: (t) => {
        const n = new FakeNode(t);
        created.push(n);
        return n;
      },
      getElementById: (id) => elements[id] || created.find((n) => n.id === id) || null,
    };
    const scope = { ownerDocument: doc, querySelectorAll: (sel) => (sel === 'script[data-bc-chart]' ? nodes : []) };
    return { scope, body };
  };
  const dots = { data: 'edges', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] };
  BC.data('edges', [
    { a: 1, b: 2 },
    { a: 2, b: 3 },
  ]);

  test('mount(): a null spec, a spec that throws and bad JSON are logged, and the charts after them still draw', () => {
    logged.error.length = 0;
    const { scope } = page(['null', '{oops', { ...dots, marks: [{ type: 'point', x: 'a', y: 'b', r: 'big' }] }, dots]);
    const handles = BC.mount(scope);
    const last = handles[handles.length - 1];
    assert.strictEqual(count(svgOf(last.host), /<circle /g), 2, 'the last chart is drawn');
    assert(logged.error.length >= 1, 'the broken ones are reported');
    logged.error.length = 0;
  });

  test('mount(): two charts with one id each get a place of their own; an id naming a script is not drawn into', () => {
    logged.error.length = 0;
    const script = new FakeNode('script');
    script.tagName = 'SCRIPT';
    const { scope } = page(
      [
        { ...dots, id: 'twin' },
        { ...dots, id: 'twin' },
        { ...dots, id: 'bc-data' },
      ],
      { 'bc-data': script },
    );
    const handles = BC.mount(scope);
    assert.strictEqual(handles.length, 3);
    assert.notStrictEqual(handles[0].host, handles[1].host, 'the second does not wipe out the first');
    assert.strictEqual(count(svgOf(handles[0].host), /<circle /g), 2);
    assert.strictEqual(count(svgOf(handles[1].host), /<circle /g), 2);
    assert.notStrictEqual(handles[2].host, script, 'not drawn into the script');
    assert.strictEqual(script.children.length, 0);
    assert(
      logged.error.some((m) => /"twin" is used by another chart/.test(m)),
      logged.error.join('\n'),
    );
    logged.error.length = 0;
  });

  test('update(): turning "responsive" on later follows the container like a chart that started with it', async () => {
    const observers = [];
    const savedRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    };
    try {
      const host = new FakeNode('div');
      host.clientWidth = 320;
      const fixed = { ...dots, size: [640, 300], responsive: false };
      const h = BC.chart(host, fixed);
      assert(/viewBox="0 0 640 300"/.test(svgOf(host)));
      h.update({ ...fixed, responsive: true });
      assert(/viewBox="0 0 320 300"/.test(svgOf(host)), 'laid out at the container width');
      host.clientWidth = 500;
      for (const o of observers) o.cb();
      await new Promise((r) => setTimeout(r, 40));
      assert(/viewBox="0 0 500 300"/.test(svgOf(host)), 'and follows it when it changes: ' + /viewBox="[^"]+"/.exec(svgOf(host)));
      h.destroy();
    } finally {
      globalThis.ResizeObserver = savedRO;
    }
  });

  test('ctx.series: the split into series is made once per redraw and shared by everyone asking for the same xs', () => {
    let live = null;
    BC.define({
      role: 'interaction',
      type: 'seriesprobe',
      version: 1,
      attach(spec, ctx) {
        live = ctx;
      },
    });
    BC.data('two', [
      { a: 1, b: 1, g: 'x' },
      { a: 2, b: 2, g: 'y' },
      { a: 3, b: 3, g: 'x' },
    ]);
    const host = new FakeNode('div');
    BC.chart(host, {
      data: 'two',
      scales: { x: { type: 'linear' }, y: { type: 'linear' } },
      marks: [{ type: 'line', x: 'a', y: 'b', group: 'g' }],
      interaction: [{ type: 'seriesprobe' }],
    });
    const mark = live.spec.marks[0];
    const xs = live.channel(mark, 'x').mapped;
    const a = live.series(mark, xs);
    assert.strictEqual(live.series(mark, xs), a, 'the same array the second time');
    assert.deepStrictEqual(
      a.map((s) => s.rows),
      [[0, 2], [1]],
    );
  });

  // ── scales ──

  const linear = (spec, sources = [[0, 10]]) =>
    BC.get('scale.linear').create({ type: 'linear', ...spec }, { name: 'x', sources, range: [0, 100], color: () => '#000' });

  test('scale.linear: a domain of two equal numbers or of nonsense is a clear error; a reversed one has ticks', () => {
    for (const bad of [[5, 5], ['a', 1], [0, Infinity], [1], [null, 2]]) {
      assert.throws(() => linear({ domain: bad }), /scale\.linear: the domain must be two different numbers/, JSON.stringify(bad));
    }
    const down = linear({ domain: [10, 0] });
    const ticks = down.ticks(5);
    assert(ticks.length >= 3, 'a reversed domain has ticks: ' + JSON.stringify(ticks));
    assert.strictEqual(down(10), 0);
    assert.strictEqual(down(0), 100);
    for (const t of ticks) assert(Math.abs(t.pos - down(t.value)) < 1e-9);
  });

  test('scale.linear: data of one repeated value, or spanning a huge or tiny range, gives a few ticks and no crash', () => {
    for (const sources of [[[5, 5, 5]], [[1e-300, 2e-300]], [[-1e300, 1e300]], [[0.1, 0.1000000001]]]) {
      const s = linear({}, sources);
      const ticks = s.ticks(5);
      assert(
        ticks.length <= 1000 && ticks.every((t) => isFinite(t.value) && isFinite(t.pos)),
        JSON.stringify(sources) + ': ' + ticks.length,
      );
    }
  });

  test('scale.log: values at the ends of what a number holds give a finite domain and ticks, never a loop without end', () => {
    // run in a child with a time limit: the bug this guards against never returns
    const { spawnSync } = require('child_process');
    const dist = require('path').join(__dirname, '../dist');
    const script = `
      require(${JSON.stringify(dist + '/core.js')});
      for (const f of ['lib.ticks', 'scale.log']) require(${JSON.stringify(dist + '/blocks/')} + f + '.js');
      const out = [];
      const log = (spec, sources) => BC.get('scale.log').create({ type: 'log', ...spec }, { name: 'x', sources, range: [0, 100], color: () => '#000' });
      for (const sources of [[[Number.MAX_VALUE]], [[5e-324]], [[1, 1.7e308]], [[5e-324, 1]], [[5e-324, Number.MAX_VALUE]], [[1e-320, 1e-319]]]) {
        const s = log({}, sources);
        out.push({ domain: s.domain(), ticks: s.ticks(6).map((t) => t.value), pos: s.ticks(6).map((t) => t.pos) });
        s.setDomain([1, Infinity]);
        out.push({ zoomed: s.domain(), ticks: s.ticks(6).length });
      }
      const explicit = log({ domain: [5e-324, Number.MAX_VALUE] }, [[1]]);
      out.push({ domain: explicit.domain(), ticks: explicit.ticks(6).map((t) => t.value) });
      console.log(JSON.stringify(out));
    `;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.strictEqual(r.error, undefined, 'it finished within 5 s');
    assert.strictEqual(r.status, 0, r.stderr);
    for (const c of JSON.parse(r.stdout)) {
      for (const d of [c.domain, c.zoomed].filter(Boolean))
        assert(
          d.every((v) => v > 0 && isFinite(v)),
          'a domain of positive finite numbers: ' + JSON.stringify(c),
        );
      if (Array.isArray(c.ticks)) {
        assert(c.ticks.length >= 1 && c.ticks.length <= 20, JSON.stringify(c));
        assert(c.ticks.every((v) => v > 0 && isFinite(v)) && (c.pos || []).every(isFinite), JSON.stringify(c));
      } else assert(c.ticks >= 1 && c.ticks <= 20, JSON.stringify(c));
    }
  });

  test('scale.sequential and scale.size: a reversed or empty domain gives ticks, not a crash or a thousand of them', () => {
    const ctx = (sources) => ({ name: 'c', sources, range: [], color: () => '#000' });
    const seq = BC.get('scale.sequential').create({ type: 'sequential', domain: [10, 0] }, ctx([]));
    const seqTicks = seq.ticks(5);
    assert(seqTicks.length >= 3 && seqTicks.length < 20, JSON.stringify(seqTicks));
    const flat = BC.get('scale.sequential').create({ type: 'sequential' }, ctx([[3, 3, 3]]));
    assert.doesNotThrow(() => flat.ticks(5));
    const size = BC.get('scale.size').create({ type: 'size', zero: false }, ctx([[7, 7, 7]]));
    const sizeTicks = size.ticks(5);
    assert(sizeTicks.length > 0 && sizeTicks.length <= 50 && sizeTicks.every((t) => t.value > 0), JSON.stringify(sizeTicks));
    // a view set on it (by a zoom, or a legend that follows one) may be empty or run the other way
    size.setDomain([5, 5]);
    assert.deepStrictEqual(size.ticks(5), [], 'a view of one value: no ticks, no exception');
    size.setDomain([20, 0]);
    assert(size.ticks(5).length > 0, 'a reversed view has ticks');
  });

  // ── transforms that write columns ──

  test('transform.waterfall, funnel, treemap: a field that is not in the data is an error that names it', () => {
    const rows = [
      { k: 'a', v: 1, g: 'x' },
      { k: 'b', v: 2, g: 'x' },
    ];
    assert.throws(() => apply('waterfall', rows, { field: 'ghost' }), /transform\.waterfall: unknown field "ghost" in "field"/);
    assert.throws(() => apply('waterfall', rows, { field: 'v', total: 'nope' }), /unknown field "nope" in "total"/);
    assert.throws(() => apply('funnel', rows, { field: 'ghost' }), /transform\.funnel: unknown field "ghost" in "field"/);
    assert.throws(
      () => apply('treemap', rows, { field: 'v', name: 'k', group: 'nope' }),
      /transform\.treemap: unknown field "nope" in "group"/,
    );
  });

  test('transform.waterfall, funnel, treemap: a new column never silently replaces one of the data or another new one', () => {
    const rows = [
      { k: 'a', v: 1, v0: 9, rate: 0.5, label: 'L' },
      { k: 'b', v: 2, v0: 8, rate: 0.4, label: 'M' },
    ];
    assert.throws(
      () => apply('waterfall', rows, { field: 'v' }),
      /"v0" is already a column of the data: give the new one another name with "as\[0\]"/,
    );
    assert.throws(
      () =>
        apply(
          'funnel',
          rows.map(({ v0, ...r }) => r),
          { field: 'v' },
        ),
      /"rate" is already a column of the data: give the new one another name with "rateAs"/,
    );
    assert.throws(
      () => apply('treemap', rows, { field: 'v', name: 'k' }),
      /"label" is already a column of the data: give the new one another name with "labelAs"/,
    );
    assert.throws(
      () => apply('funnel', [{ k: 'a', v: 1 }], { field: 'v', as: ['x', 'x'] }),
      /"as\[0\]" and "as\[1\]" both name the new column "x"/,
    );
    // renamed, it works; and the field it stands for may be written over (a waterfall's amount, a funnel's value)
    assert.doesNotThrow(() => apply('waterfall', rows, { field: 'v', as: ['from', 'to'] }));
    assert.doesNotThrow(() =>
      apply(
        'funnel',
        rows.map(({ v0, ...r }) => r),
        { field: 'v', rateAs: 'share' },
      ),
    );
    assert.doesNotThrow(() => apply('treemap', rows, { field: 'v', name: 'k', labelAs: 'caption' }));
  });

  // ── guide.kpi ──

  test('guide.kpi: compare "previous" or "first" with a sum is refused with the way out; with "against" it is fine', () => {
    BC.data('kpi-edge', [
      { v: 10, t: 12 },
      { v: 20, t: 25 },
    ]);
    const tile = (g) => ({ data: 'kpi-edge', size: [300, 120], marks: [], guides: [{ type: 'kpi', field: 'v', ...g }] });
    const host = new FakeNode('div');
    const h = BC.chart(host, tile({ aggregate: 'sum', compare: 'previous' }));
    assert(
      h.diagnostics.some(
        (d) => d.level === 'error' && /compare "previous" compares one row with another.*give "against" a field/.test(d.message),
      ),
      JSON.stringify(h.diagnostics),
    );
    const ok = new FakeNode('div');
    const h2 = BC.chart(ok, tile({ aggregate: 'sum', compare: 'previous', against: 't' }));
    assert.deepStrictEqual(
      h2.diagnostics.filter((d) => d.level === 'error'),
      [],
    );
    assert(
      texts(svgOf(ok)).some((t) => /▼/.test(t)),
      '30 against 37: down',
    );
    const last = new FakeNode('div');
    assert.deepStrictEqual(
      BC.chart(last, tile({ compare: 'first' })).diagnostics.filter((d) => d.level === 'error'),
      [],
    );
    logged.error.length = 0;
  });

  // ── what a spec may not fetch ──

  test('a color in a spec is a color: url(…) in a fill, a stroke or a range is an error, so a report never fetches anything', () => {
    BC.data('paint', [
      { k: 'a', v: 1, o: 1, h: 2, l: 0, c: 2 },
      { k: 'b', v: 2, o: 2, h: 3, l: 1, c: 1 },
    ]);
    const chart = (extra) => ({
      data: 'paint',
      scales: { x: { type: 'band' }, y: { type: 'linear' }, color: { type: 'color' } },
      marks: [{ type: 'rect', x: 'k', y: 'v' }],
      ...extra,
    });
    const errors = (spec) => BC.validate(spec).filter((d) => d.level === 'error');
    const good = [
      '#4e79a7',
      '#abc',
      '#4e79a7cc',
      'rgb(78 121 167 / 50%)',
      'rgba(1, 2, 3, .5)',
      'hsl(200deg 50% 50%)',
      'oklch(70% 0.1 250)',
      'steelblue',
      'transparent',
      'currentColor',
      'var(--bc-c0)',
      'var(--brand, #fff)',
    ];
    const bad = [
      'url(http://127.0.0.1:9/leak)',
      'url(#gradient)',
      'red;background-image:url(http://127.0.0.1:9/leak)',
      'var(--x, url(http://127.0.0.1:9/leak))',
      'rgb(1 2 url(x))',
      'expression(alert(1))',
      '#12345',
      '',
      5,
    ];
    for (const c of good) {
      assert.deepStrictEqual(errors(chart({ marks: [{ type: 'rect', x: 'k', y: 'v', fill: c }] })), [], c);
      assert.deepStrictEqual(errors(chart({ scales: { ...chart().scales, color: { type: 'color', range: [c] } } })), [], c);
    }
    for (const c of bad) {
      const fill = errors(chart({ marks: [{ type: 'rect', x: 'k', y: 'v', fill: c }] }));
      assert.strictEqual(fill.length, 1, String(c));
      assert.strictEqual(fill[0].path, 'marks[0].fill');
      assert.match(fill[0].message, /fill of mark\.rect must be a color/);
      const range = errors(chart({ scales: { ...chart().scales, color: { type: 'color', range: ['#4e79a7', c] } } }));
      assert.strictEqual(range.length, 1, String(c));
      assert.strictEqual(range[0].path, 'scales.color.range[1]');
      assert.match(range[0].message, /is not a color/);
    }
    // every mark parameter that paints is checked: the stroke of a line, the candles of a candlestick
    const leak = 'url(http://127.0.0.1:9/leak)';
    const lines = errors(
      chart({ scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'k', y: 'v', stroke: leak }] }),
    );
    assert.deepStrictEqual(
      lines.map((d) => d.path),
      ['marks[0].stroke'],
    );
    const candles = errors(
      chart({
        scales: { x: { type: 'band' }, y: { type: 'linear' } },
        marks: [{ type: 'candlestick', x: 'k', open: 'o', high: 'h', low: 'l', close: 'c', up: leak, down: leak }],
      }),
    );
    assert.deepStrictEqual(candles.map((d) => d.path).sort(), ['marks[0].down', 'marks[0].up']);
    // a scale of positions has no colors to check: its range is pixels
    assert.deepStrictEqual(errors(chart({ scales: { ...chart().scales, y: { type: 'linear', range: [200, 0] } } })), []);
    // and a chart with a bad color is not drawn with it
    const host = new FakeNode('div');
    const h = BC.chart(host, chart({ marks: [{ type: 'rect', x: 'k', y: 'v', fill: leak }] }));
    assert(h.diagnostics.some((d) => d.path === 'marks[0].fill'));
    assert(!/url\(/.test(svgOf(host)), 'nothing is drawn with the url');
    logged.error.length = 0;
  });

  // ── names every object has ──

  test('a name every object has ("constructor", "toString", "__proto__") is not taken for a scale, a format or a column', () => {
    BC.data('names', [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ]);
    const base = { data: 'names', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'k', y: 'v' }] };
    const errors = (spec) => BC.validate(spec).filter((d) => d.level === 'error');
    const undeclared = [
      [{ ...base, marks: [{ type: 'rect', x: 'k', y: { field: 'v', scale: 'constructor' } }] }, 'marks[0].y'],
      [{ ...base, guides: [{ type: 'axis', scale: 'toString' }] }, 'guides[0].scale'],
      [{ ...base, guides: [{ type: 'legend', scale: 'hasOwnProperty' }] }, 'guides[0].scale'],
      [{ ...base, view: { constructor: [0, 1] } }, 'view.constructor'],
      [{ ...base, transforms: [{ type: 'stack', field: 'v', follows: 'valueOf' }] }, 'transforms[0].follows'],
    ];
    for (const [spec, path] of undeclared) {
      const found = errors(spec);
      assert(
        found.some((d) => d.path === path && /not declared|name of a declared scale/.test(d.message)),
        JSON.stringify(found),
      );
    }
    // a scale may be called so, when it is declared
    const host = new FakeNode('div');
    const h = BC.chart(host, {
      ...base,
      scales: { constructor: { type: 'band', range: 'width' }, y: { type: 'linear' } },
      marks: [{ type: 'rect', x: { field: 'k', scale: 'constructor' }, y: 'v' }],
      guides: [{ type: 'axis', scale: 'constructor' }],
    });
    assert.deepStrictEqual(h.diagnostics, []);
    assert.strictEqual(count(svgOf(host), /<rect x="[\d.-]+" y="[\d.-]+" width="[\d.]+" height="[\d.]+"/g), 2, 'both bars drawn');
    logged.warn.length = 0;
    h.setView('toString', [0, 1]); // not a scale of this chart: said so, and nothing happens
    assert(
      logged.warn.some((w) => /setView: unknown scale "toString"/.test(w)),
      JSON.stringify(logged.warn),
    );
    assert.deepStrictEqual(Object.keys(h.getView()).sort(), ['constructor', 'y']);

    for (const name of ['constructor', 'toString', '__proto__']) assert.throws(() => BC.formatter(name), /unknown format/, name);

    // a column named "__proto__" would become the prototype of the columns, so it is refused, in every form of data
    for (const input of [JSON.parse('[{"__proto__": 1, "a": 2}]'), JSON.parse('{"columns": {"__proto__": [1], "a": [2]}}')])
      assert.throws(() => BC.data('proto', input), /BC\.data: a column cannot be named "__proto__"; rename it/);
    // and a column named "constructor" is a column like any other
    BC.data('ctor', [{ constructor: 'x', v: 1 }]);
    assert.deepStrictEqual(
      BC.validate({
        data: 'ctor',
        scales: { x: { type: 'band' }, y: { type: 'linear' } },
        marks: [{ type: 'rect', x: 'constructor', y: 'v' }],
      }),
      [],
    );

    // a new column of a transform: "constructor" is a name like any other, "__proto__" is refused with its parameter
    const steps = [
      { k: 'a', v: 1 },
      { k: 'b', v: -2 },
    ];
    assert.deepStrictEqual(apply('waterfall', steps, { field: 'v', kindAs: 'constructor' }).columns.constructor, ['increase', 'decrease']);
    assert.throws(
      () => apply('waterfall', steps, { field: 'v', kindAs: '__proto__' }),
      /a column cannot be named "__proto__": give "kindAs" another name/,
    );
    logged.error.length = 0;
  });
};
