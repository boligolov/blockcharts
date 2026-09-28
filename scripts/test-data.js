// Tests for encoded datasets (base64 / gzip+base64), BC.ready and charts that wait for their data. Loaded by test.js.
const zlib = require('zlib');
const assert = require('assert');
const { encodeColumns } = require('./encode-columns.js');

module.exports = function ({ test, FakeNode, svgOf, count, logged, flush }) {
  const enc = (value, encoding) => {
    const raw = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    return { encoding, data: (encoding === 'gzip+base64' ? zlib.gzipSync(raw) : raw).toString('base64') };
  };
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ a: i, b: i * 2 }));
  const spec = (data) => ({ data, scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }] });
  const circles = (host) => count(svgOf(host), /<circle /g);

  test('encoded data: base64 and gzip+base64, rows and columns, are usable after BC.ready()', async () => {
    BC.data('enc-b64', enc(rows(5), 'base64'));
    BC.data('enc-gz', enc(rows(7), 'gzip+base64'));
    BC.data('enc-cols', enc({ columns: { a: [1, 2, 3], b: [4, 5, 6] } }, 'gzip+base64'));
    await BC.ready();
    for (const [name, n] of [['enc-b64', 5], ['enc-gz', 7], ['enc-cols', 3]]) {
      const host = new FakeNode('div');
      const h = BC.chart(host, spec(name));
      assert.deepStrictEqual(h.diagnostics, [], name);
      assert.strictEqual(circles(host), n, name);
    }
  });

  test('encoded data: a chart shows a placeholder while it waits, then builds itself', async () => {
    BC.data('slow', enc(rows(6), 'gzip+base64'));
    const host = new FakeNode('div');
    const h = BC.chart(host, spec('slow'));
    assert.strictEqual(host.children.length, 1);
    assert.strictEqual(host.children[0].attrs.class, 'bc-loading', 'a loading placeholder, not an error');
    assert(BC.validate(spec('slow')).some((d) => /still being decoded \(await BC\.ready\(\)\)/.test(d.message)), 'validate says why');
    await h.ready;
    assert.strictEqual(host.children[0].tag, 'svg');
    assert.strictEqual(circles(host), 6);
    assert.deepStrictEqual(h.diagnostics, []);
    assert.deepStrictEqual(BC.validate(spec('slow')), []);
  });

  test('encoded data: UTF-8 survives, and so does base64 wrapped over several lines', async () => {
    BC.data('utf', enc([{ k: 'Регион Север', v: 3 }, { k: '東京', v: 5 }, { k: 'naïve ☃', v: 4 }], 'gzip+base64'));
    const wrapped = enc(rows(4), 'gzip+base64');
    wrapped.data = wrapped.data.replace(/(.{20})/g, '$1\r\n  ');
    BC.data('wrapped', wrapped);
    await BC.ready();
    const host = new FakeNode('div');
    const h = BC.chart(host, { data: 'utf', scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, guides: [{ type: 'axis', scale: 'x' }], marks: [{ type: 'rect', x: 'k', y: 'v' }] });
    assert.deepStrictEqual(h.diagnostics, []);
    for (const label of ['Регион Север', '東京', 'naïve ☃']) assert(svgOf(host).includes(`>${label}<`), label);
    const w = new FakeNode('div');
    BC.chart(w, spec('wrapped'));
    assert.strictEqual(circles(w), 4);
  });

  const bad = [
    ['not base64 at all', { encoding: 'gzip+base64', data: '***not base64***' }, /not valid base64/],
    ['base64 length that cannot exist', { encoding: 'base64', data: 'A' }, /not valid base64/],
    ['base64 that is not gzip', { encoding: 'gzip+base64', data: Buffer.from('hello, this is plain text').toString('base64') }, /not valid gzip/],
    ['a gzip stream that was cut off', { encoding: 'gzip+base64', data: zlib.gzipSync(Buffer.from(JSON.stringify(rows(200)))).subarray(0, 40).toString('base64') }, /not valid gzip/],
    ['gzip of something that is not JSON', enc('this is { not json', 'gzip+base64'), /not UTF-8 JSON/],
    ['gzip of invalid UTF-8', { encoding: 'gzip+base64', data: zlib.gzipSync(Buffer.from([0xff, 0xfe, 0xfd])).toString('base64') }, /not UTF-8 JSON/],
    ['an unknown encoding', { encoding: 'rot13', data: 'abc' }, /unknown encoding "rot13"/],
    ['no data string', { encoding: 'base64' }, /needs a "data" string/],
    ['an encoded dataset inside an encoded dataset', enc(enc(rows(2), 'base64'), 'gzip+base64'), /cannot contain another encoded dataset/],
    ['JSON that is not a dataset', enc(5, 'gzip+base64'), /array of rows or \{ columns \}/],
    ['rows that are not objects', enc([{ a: 1 }, null], 'base64'), /row 1 is not an object/],
    ['columns of different length', enc({ columns: { a: [1, 2], b: [1] } }, 'base64'), /column "b" has 1 values, expected 2/],
  ];
  for (const [what, input, message] of bad) {
    test(`encoded data: ${what} is a clear, per-dataset failure`, async () => {
      logged.error.length = 0;
      assert.doesNotThrow(() => BC.data('broken', input), 'BC.data itself does not throw for encoded input');
      const host = new FakeNode('div');
      const h = BC.chart(host, spec('broken'));
      await h.ready;
      await BC.ready();
      assert.strictEqual(host.children[0].attrs.class, 'bc-error', 'an error box in place of the chart');
      assert(message.test(host.children[0].text), host.children[0].text);
      assert(/could not be loaded/.test(host.children[0].text));
      assert(logged.error.some((l) => message.test(l)), 'and it is in the console');
      assert(h.diagnostics.some((d) => d.level === 'error' && d.path === 'data'));
      logged.error.length = 0;
    });
  }

  test('encoded data: a small gzip cannot unpack into memory without limit', async () => {
    logged.error.length = 0;
    const bomb = zlib.gzipSync(Buffer.alloc(65 * 1024 * 1024), { level: 9 });
    assert(bomb.length < 200 * 1024, 'the bomb is tiny on the wire');
    BC.data('bomb', { encoding: 'gzip+base64', data: bomb.toString('base64') });
    const host = new FakeNode('div');
    const h = BC.chart(host, spec('bomb'));
    await h.ready;
    assert(/larger than 64 MB, refusing to unpack it/.test(host.children[0].text), host.children[0].text);
    logged.error.length = 0;
  });

  test('encoded data: a failing dataset does not affect an unrelated one, and ready() always settles', async () => {
    logged.error.length = 0;
    BC.data('will-fail', { encoding: 'gzip+base64', data: '!!!' });
    BC.data('fine', rows(3));
    await BC.ready();
    const host = new FakeNode('div');
    BC.chart(host, spec('fine'));
    assert.strictEqual(circles(host), 3, 'other datasets are unaffected');
    await assert.doesNotReject(BC.ready(), 'nothing pending: resolves at once');
    logged.error.length = 0;
  });

  test('encoded data: the last BC.data() for a name wins, whatever order the decodes finish in', async () => {
    BC.data('race', enc(rows(9), 'gzip+base64'));
    BC.data('race', rows(2));
    await BC.ready();
    let host = new FakeNode('div');
    BC.chart(host, spec('race'));
    assert.strictEqual(circles(host), 2, 'plain data set after an encoded one is not overwritten by the late decode');

    BC.data('race', rows(2));
    BC.data('race', enc(rows(4), 'gzip+base64'));
    await BC.ready();
    host = new FakeNode('div');
    BC.chart(host, spec('race'));
    assert.strictEqual(circles(host), 4, 'encoded data set after plain data replaces it');

    logged.error.length = 0;
    BC.data('race', { encoding: 'gzip+base64', data: '!!!' });
    BC.data('race', enc(rows(5), 'gzip+base64'));
    await BC.ready();
    assert.strictEqual(logged.error.length, 0, 'the superseded decode does not report');
    host = new FakeNode('div');
    BC.chart(host, spec('race'));
    assert.strictEqual(circles(host), 5);

    BC.data('recover', { encoding: 'gzip+base64', data: '!!!' });
    await BC.ready();
    assert(BC.validate(spec('recover')).some((d) => /could not be loaded/.test(d.message)));
    BC.data('recover', rows(3));
    assert.deepStrictEqual(BC.validate(spec('recover')), [], 'a good dataset clears the failure');
    logged.error.length = 0;
  });

  test('encoded data: update() and destroy() while waiting behave', async () => {
    BC.data('wait', enc(rows(6), 'gzip+base64'));
    const host = new FakeNode('div');
    const h = BC.chart(host, spec('wait'));
    h.update({ ...spec('wait'), marks: [{ type: 'point', x: 'a', y: 'b', r: 7 }] });
    await h.ready;
    await flush();
    assert.strictEqual(circles(host), 6, 'built exactly once, with the latest spec');
    assert(svgOf(host).includes('r="7"'));

    BC.data('wait2', enc(rows(6), 'gzip+base64'));
    const host2 = new FakeNode('div');
    const h2 = BC.chart(host2, spec('wait2'));
    h2.destroy();
    await h2.ready;
    await BC.ready();
    await flush();
    assert.strictEqual(host2.children.length, 0, 'a destroyed chart never appears');
    h2.update(spec('wait2'));
    assert.strictEqual(host2.children.length, 0, 'and cannot be revived');
  });

  test('encoded data: mount() reads encoded datasets from #bc-data and the charts wait for them', async () => {
    const dataNode = { textContent: JSON.stringify({ mounted: enc(rows(8), 'gzip+base64') }) };
    const chartNode = { textContent: JSON.stringify(spec('mounted')), parentNode: null };
    const body = new FakeNode('body');
    body.insertBefore = (c, ref) => { c.parentNode = body; body.children.push(c); return c; };
    chartNode.parentNode = body;
    const scope = {
      ownerDocument: { createElement: (t) => new FakeNode(t), getElementById: () => null },
      querySelectorAll: (sel) => (sel === 'script#bc-data' ? [dataNode] : sel === 'script[data-bc-chart]' ? [chartNode] : []),
    };
    const [h] = BC.mount(scope);
    assert.strictEqual(h.host.children[0].attrs.class, 'bc-loading');
    await h.ready;
    assert.strictEqual(circles(h.host), 8);
  });

  // ── binary columns ──
  const line = (data) => ({ data, scales: { x: { type: 'linear' }, y: { type: 'linear' } }, guides: [{ type: 'axis', scale: 'x' }, { type: 'axis', scale: 'y' }], marks: [{ type: 'point', x: 'a', y: 'b' }] });
  const same = async (name, binary, plain) => {
    BC.data(name + '-bin', binary);
    BC.data(name + '-plain', plain);
    await BC.ready();
    const a = new FakeNode('div'), b = new FakeNode('div');
    const ha = BC.chart(a, line(name + '-bin')), hb = BC.chart(b, line(name + '-plain'));
    assert.deepStrictEqual(ha.diagnostics, [], name);
    assert.deepStrictEqual(hb.diagnostics, [], name);
    assert(circles(a) > 0);
    assert.strictEqual(svgOf(a), svgOf(b), name + ': the binary column draws exactly what the JSON one does');
  };

  test('binary columns: every dtype reads back as the numbers that went in', async () => {
    const cols = {
      a: Array.from({ length: 40 }, (_, i) => i),
      b: Array.from({ length: 40 }, (_, i) => Math.sin(i) * 1000 + 0.5),
    };
    await same('f64', encodeColumns(cols, { dtypes: { a: 'float64', b: 'float64' } }), { columns: cols });
    await same('auto', encodeColumns(cols), { columns: cols });
    await same('f64-plain-base64', encodeColumns(cols, { gzip: false }), { columns: cols });
    const f32 = { a: cols.a, b: cols.b.map(Math.fround) };
    await same('f32', encodeColumns(cols, { dtypes: { b: 'float32' } }), { columns: f32 });
    for (const [dtype, values] of [['int8', [-128, -1, 0, 1, 127]], ['int16', [-32768, 5, 32767, 0, 1]], ['int32', [-2147483648, 7, 2147483647, 0, 1]], ['uint8', [0, 1, 200, 255, 3]], ['uint16', [0, 65535, 300, 2, 9]], ['uint32', [0, 4294967295, 70000, 5, 1]]]) {
      const c = { a: [1, 2, 3, 4, 5], b: values };
      const e = encodeColumns(c, { dtypes: { b: dtype } });
      assert.strictEqual(e.columns.b.dtype, dtype);
      await same(dtype, e, { columns: c });
    }
  });

  test('binary columns: auto picks the smallest integer type, and float64 whenever it would lose something', () => {
    const t = (values) => encodeColumns({ v: values }).columns.v.dtype;
    assert.strictEqual(t([0, 1, 255]), 'uint8');
    assert.strictEqual(t([-1, 5]), 'int8');
    assert.strictEqual(t([0, 256]), 'uint16');
    assert.strictEqual(t([-129, 5]), 'int16');
    assert.strictEqual(t([0, 70000]), 'uint32');
    assert.strictEqual(t([-70000, 0]), 'int32');
    assert.strictEqual(t([0, 5000000000]), 'float64', 'beyond 32 bits');
    assert.strictEqual(t([0.5, 1]), 'float64');
    assert.strictEqual(t([1, null]), 'float64', 'a missing value needs NaN');
    assert.strictEqual(encodeColumns({ v: [1, 2, 3], s: ['a', 'b', 'c'] }).columns.s.join(), 'a,b,c', 'text stays text');
    const values = Array.from({ length: 5000 }, (_, i) => (i * 37) % 200);
    assert(JSON.stringify(encodeColumns({ v: values })).length < JSON.stringify({ columns: { v: values } }).length / 4, 'much smaller than the JSON text');
  });

  test('binary columns: the encoder refuses what it cannot store faithfully', () => {
    assert.throws(() => encodeColumns({ v: [1, null] }, { dtypes: { v: 'int8' } }), /column "v" has a missing value at 1, which int8 cannot hold/);
    assert.throws(() => encodeColumns({ v: [1, 300] }, { dtypes: { v: 'uint8' } }), /300 at 1 does not fit uint8/);
    assert.throws(() => encodeColumns({ v: [1.5] }, { dtypes: { v: 'int16' } }), /1\.5 at 0 does not fit int16/);
    assert.throws(() => encodeColumns({ v: [1e300] }, { dtypes: { v: 'float32' } }), /too large for float32/);
    assert.throws(() => encodeColumns({ v: ['a'] }, { dtypes: { v: 'float64' } }), /not numeric/);
    assert.throws(() => encodeColumns({ v: [1] }, { dtypes: { v: 'float16' } }), /unknown dtype "float16"/);
    assert.throws(() => encodeColumns({ v: [1] }, { dtypes: { w: 'float64' } }), /unknown column "w"/);
    assert.throws(() => encodeColumns({ a: [1, 2], b: [1] }), /column "b" has 1 values, expected 2/);
    assert.throws(() => encodeColumns([1]), /object of name to array/);
    assert.deepStrictEqual(encodeColumns({}), { columns: {} });
  });

  test('binary columns: missing values are NaN and the row is skipped, as with JSON null; strings and numbers can mix', async () => {
    const cols = { a: [1, 2, 3, 4], b: [5, null, 7, 8], label: ['w', 'x', 'y', 'z'] };
    await same('gaps', encodeColumns(cols), { columns: cols });
    BC.data('gaps-bin', encodeColumns(cols));
    await BC.ready();
    const host = new FakeNode('div');
    BC.chart(host, { data: 'gaps-bin', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'point', x: 'a', y: 'b' }, { type: 'text', x: 'a', y: 'b', text: 'label' }] });
    assert.strictEqual(circles(host), 3);
  });

  test('binary columns: inside an encoded dataset too, and a chart waits for them like for any encoded data', async () => {
    const cols = { a: [1, 2, 3, 4, 5, 6], b: [2, 4, 6, 8, 10, 12] };
    BC.data('nested', enc(encodeColumns(cols), 'gzip+base64'));
    const host = new FakeNode('div');
    const h = BC.chart(host, line('nested'));
    assert.strictEqual(host.children[0].attrs.class, 'bc-loading');
    await h.ready;
    assert.strictEqual(circles(host), 6);
    await same('nested-eq', enc(encodeColumns(cols), 'base64'), { columns: cols });
  });

  test('binary columns: a bad column is a clear, per-dataset failure that names the column', async () => {
    const good = encodeColumns({ a: [1, 2, 3], b: [1, 2, 3] }).columns;
    const b64 = (bytes) => Buffer.from(bytes).toString('base64');
    const bad = [
      ['an unknown dtype', { a: good.a, b: { dtype: 'float16', encoding: 'base64', data: '' } }, /column "b": unknown dtype "float16"/],
      ['an unknown encoding', { a: good.a, b: { dtype: 'float64', encoding: 'rot13', data: '' } }, /column "b": unknown encoding "rot13"/],
      ['no data string', { a: good.a, b: { dtype: 'float64', encoding: 'base64' } }, /column "b": a binary column needs a "data" string/],
      ['not base64', { a: good.a, b: { dtype: 'float64', encoding: 'base64', data: '***' } }, /column "b": the data is not valid base64/],
      ['not gzip', { a: good.a, b: { dtype: 'float64', encoding: 'gzip+base64', data: b64('plain text!') } }, /column "b": the data is not valid gzip/],
      ['a byte count that is not a whole number of values', { a: good.a, b: { dtype: 'float64', encoding: 'base64', data: b64([1, 2, 3, 4, 5, 6, 7, 8, 9]) } }, /column "b": 9 bytes is not a whole number of float64 values/],
      ['a column of another length', { a: good.a, b: encodeColumns({ b: [1, 2] }).columns.b }, /column "b" has 2 values, expected 3/],
    ];
    for (const [what, columns, message] of bad) {
      logged.error.length = 0;
      assert.doesNotThrow(() => BC.data('bad-bin', { columns }), what);
      const host = new FakeNode('div');
      const h = BC.chart(host, line('bad-bin'));
      await h.ready;
      await BC.ready();
      assert.strictEqual(host.children[0].attrs.class, 'bc-error', what);
      assert(message.test(host.children[0].text), what + ': ' + host.children[0].text);
      assert(logged.error.some((e) => message.test(e)), what + ' reaches the console');
    }
    logged.error.length = 0;
  });

  test('binary columns: too much decoded data is refused, not unpacked', async () => {
    // 9 columns of 8 MB each is over the 64 MB budget, though every one of them is tiny once gzipped
    const zeros = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024)).toString('base64');
    const columns = {};
    for (let i = 0; i < 9; i++) columns['c' + i] = { dtype: 'float64', encoding: 'gzip+base64', data: zeros };
    logged.error.length = 0;
    BC.data('bomb', { columns });
    await BC.ready();
    const host = new FakeNode('div');
    const h = BC.chart(host, line('bomb'));
    await h.ready;
    assert(/larger than 64 MB/.test(host.children[0].text), host.children[0].text);
    logged.error.length = 0;
  });
};
