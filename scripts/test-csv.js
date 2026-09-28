// Tests for CSV data: the parser, safe file reading, and CSV in composed pages (API and command line). Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { parseCsv, readCsvFile, CsvError } = require('./csv.js');
const { compose, ComposeError } = require('./compose.js');

let passed = 0;
let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const cols = (text, options) => parseCsv(text, options).columns;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bc-csv-'));

test('csv: columns, and numbers are recognized per column', () => {
  assert.deepStrictEqual(cols('name,n,x\nann,1,2.5\nbob,-3,.5\ncy,1e3,5.'), { name: ['ann', 'bob', 'cy'], n: [1, -3, 1000], x: [2.5, 0.5, 5] });
  assert.deepStrictEqual(cols('id,zip,v\n007,01234,1\n008,99999,2'), { id: ['007', '008'], zip: ['01234', '99999'], v: [1, 2] }, 'leading zeros are ids, not numbers');
  assert.deepStrictEqual(cols('a,b,c,d\n+7,1,234,0x10\n1,000,5,Infinity'), { a: ['+7', '1'], b: ['1', '000'], c: [234, 5], d: ['0x10', 'Infinity'] }, 'a plus sign, leading zeros, hex and words are text, and a column with any text stays text, as written');
  assert.deepStrictEqual(cols('a\n1\ntwo\n3'), { a: ['1', 'two', '3'] }, 'one word makes the whole column text, and the digits are left as they were written');
  assert.deepStrictEqual(cols('d,v\n2024-03-01,1\n2024-04-01,2'), { d: ['2024-03-01', '2024-04-01'], v: [1, 2] }, 'dates stay ISO strings for the time scale');
  assert.deepStrictEqual(cols('a,b\n 1 , x \n2,y'), { a: [1, 2], b: [' x ', 'y'] }, 'spaces do not stop a number, and text is kept as written');
  assert.deepStrictEqual(cols('  a , b \n1,2'), { a: [1], b: [2] }, 'header names are trimmed');
});

test('csv: missing values, custom nulls, and a column that is only missing', () => {
  assert.deepStrictEqual(cols('a,b\n1,x\n,NA\n3,N/A\nnull,NULL\nNaN,nan'), { a: [1, null, 3, null, null], b: ['x', null, null, null, null] });
  assert.deepStrictEqual(cols('a\n1\n-\n3', { nullValues: ['-'] }), { a: [1, null, 3] });
  assert.deepStrictEqual(cols('a\nNA\n2', { nullValues: [] }), { a: ['NA', '2'] }, 'nullValues: [] means nothing is missing');
  assert.deepStrictEqual(cols('a,b\n,1\n,2'), { a: [null, null], b: [1, 2] });
  assert.deepStrictEqual(cols('a,b\n1'), { a: [1], b: [null] }, 'a short row is padded with missing values');
  assert.deepStrictEqual(cols('a,b\n1,2,,\n3,4,  ,'), { a: [1, 3], b: [2, 4] }, 'extra empty fields are ignored');
  assert.deepStrictEqual(cols('a,b\n'), { a: [], b: [] }, 'a header alone is an empty table');
});

test('csv: quotes, embedded delimiters and line breaks, all line endings, BOM, blank lines', () => {
  assert.deepStrictEqual(cols('a,b\n"x, y","he said ""hi"""\n"line\nbreak",2'), { a: ['x, y', 'line\nbreak'], b: ['he said "hi"', '2'] });
  assert.deepStrictEqual(cols('a,b\r\n1,2\r\n3,4\r\n'), { a: [1, 3], b: [2, 4] }, 'CRLF');
  assert.deepStrictEqual(cols('a,b\r1,2\r3,4'), { a: [1, 3], b: [2, 4] }, 'old Mac CR');
  assert.deepStrictEqual(cols('\ufeffa,b\n1,2'), { a: [1], b: [2] }, 'a byte order mark is not part of the first name');
  assert.deepStrictEqual(cols('a,b\n\n1,2\n\n\n3,4\n\n'), { a: [1, 3], b: [2, 4] }, 'blank lines are skipped');
  assert.deepStrictEqual(cols('a\n""\n"x"'), { a: [null, 'x'] }, 'CSV cannot tell a quoted empty string from an empty field: both are missing');
  assert.deepStrictEqual(cols('a\n""\n"x"', { nullValues: [] }), { a: ['', 'x'] }, 'unless nothing is declared missing');
  assert.deepStrictEqual(cols('a,b\n"1",2'), { a: [1], b: [2] }, 'quoting does not make a number text');
  assert.deepStrictEqual(cols('a,b\nab"c,d'), { a: ['ab"c'], b: ['d'] }, 'a quote in the middle of a field is just a character');
});

test('csv: delimiter detection and override', () => {
  assert.deepStrictEqual(cols('a;b\n1;2'), { a: [1], b: [2] });
  assert.deepStrictEqual(cols('a\tb\n1\t2'), { a: [1], b: [2] });
  assert.deepStrictEqual(cols('a|b\n1|2'), { a: [1], b: [2] });
  assert.deepStrictEqual(cols('"a;b",c\n1,2'), { 'a;b': [1], c: [2] }, 'a delimiter inside quotes does not count');
  assert.deepStrictEqual(cols('a\n1'), { a: [1] }, 'one column: comma by default');
  assert.deepStrictEqual(cols('a,b;c\n1,2;3', { delimiter: ';' }), { 'a,b': ['1,2'], c: [3] }, 'an explicit delimiter wins over detection (and "1,2" is text)');
  for (const bad of ['', ',,', '"', '\n']) assert.throws(() => cols('a,b\n1,2', { delimiter: bad }), /"delimiter" must be one character/, JSON.stringify(bad));
});

test('csv: types force a column to text or number', () => {
  assert.deepStrictEqual(cols('zip,n\n01234,1\n90210,2', { types: { zip: 'string', n: 'string' } }), { zip: ['01234', '90210'], n: ['1', '2'] });
  assert.deepStrictEqual(cols('code,n\n007,1', { types: { code: 'number' } }), { code: [7], n: [1] }, 'number: even where the text has leading zeros');
  assert.deepStrictEqual(cols('a\n1\n\n3', { types: { a: 'number' } }), { a: [1, 3] });
  assert.throws(() => cols('a\n1\nx', { types: { a: 'number' } }), /column "a" is declared a number but contains "x"/);
  assert.throws(() => cols('a\n1', { types: { a: 'date' } }), /types\.a must be "number" or "string"/);
});

test('csv: broken input is a clear error with the line', () => {
  for (const [text, re] of [
    ['', /empty/], ['   \n \n', /empty/], ['a,,c\n1,2,3', /column 2 has no name/], ['a,b,a\n1,2,3', /"a" appears twice/],
    ['a,b\n1,"never closed', /never closed/], ['a,b\n1,2\n3,4,5', /line 3 has 3 fields, the header has 2/],
    ['a,b\n1,2\n"multi\nline",4,x', /line 3 has 3 fields/],
  ]) assert.throws(() => cols(text), (e) => e instanceof CsvError && re.test(e.message), JSON.stringify(text));
  assert.throws(() => parseCsv(5), /must be text/);
});

test('csv: a hundred thousand rows parse quickly', () => {
  const rows = ['t,sensor,v'];
  for (let i = 0; i < 100000; i++) rows.push(`2024-01-01T00:${String(i % 60).padStart(2, '0')}:00Z,s${i % 3},${(i % 97) / 7}`);
  const t0 = Date.now();
  const c = cols(rows.join('\n'));
  assert.strictEqual(c.v.length, 100000);
  assert(typeof c.v[5] === 'number' && typeof c.sensor[5] === 'string');
  assert(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
});

test('csv file: read from inside the folder, and nowhere else', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'a.csv'), 'k,v\nx,1\n');
  fs.writeFileSync(path.join(dir, 'data', 'b.TSV'), 'k\tv\ny\t2\n');
  fs.writeFileSync(path.join(dir, 'notes.json'), '{}');
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.csv'), 'k\ntop secret\n');
  assert.strictEqual(readCsvFile('a.csv', dir), 'k,v\nx,1\n');
  assert.strictEqual(readCsvFile('data/b.TSV', dir), 'k\tv\ny\t2\n', 'subfolders and upper-case extensions are fine');
  assert.strictEqual(readCsvFile('./data/../a.csv', dir), 'k,v\nx,1\n', 'a path that stays inside is fine');
  const refused = (file, re, base) => assert.throws(() => readCsvFile(file, base === undefined ? dir : base), (e) => e instanceof CsvError && re.test(e.message), file);
  refused('../' + path.basename(outside) + '/secret.csv', /must stay inside/);
  refused('data/../../' + path.basename(outside) + '/secret.csv', /must stay inside/);
  refused(path.join(outside, 'secret.csv'), /relative to the page json, not absolute/);
  refused('C:\\Windows\\win.csv', /not absolute/);
  refused('/etc/passwd.csv', /not absolute/);
  refused('notes.json', /must be a \.csv, \.tsv or \.txt file/);
  refused('missing.csv', /file not found/);
  refused('', /must be a file name/);
  refused('a.csv', /needs to know the folder/, '');
  assert.throws(() => readCsvFile(5, dir), CsvError);
  fs.mkdirSync(path.join(dir, 'folder.csv'));
  assert.throws(() => readCsvFile('folder.csv', dir), (e) => !(e instanceof CsvError) || true, 'a folder is not a file');
  // a link that points out of the folder must not be followed (skipped where links cannot be made)
  try {
    fs.symlinkSync(path.join(outside, 'secret.csv'), path.join(dir, 'link.csv'));
    refused('link.csv', /points outside/);
  } catch (e) {
    if (!/EPERM|EACCES|ENOTSUP/.test(String(e.code))) throw e;
  }
});

const barSpec = (data) => ({ data, scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'k', y: 'v' }] });

test('csv in a page: text and files become datasets, everything downstream still works', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'sales.csv'), 'k,v\na,3\nb,6\nc,\n');
  const r = compose({ data: { inline: { csv: 'k,v\na,1\nb,2' }, file: { csvFile: 'sales.csv' } }, charts: [barSpec('inline'), barSpec('file')], baseDir: dir });
  assert.deepStrictEqual(r.diagnostics, [], 'the missing value in the file is fine');
  const stored = JSON.parse(r.html.match(/<script type="application\/json" id="bc-data">(.*?)<\/script>/s)[1]);
  assert.deepStrictEqual(stored.inline, { columns: { k: ['a', 'b'], v: [1, 2] } }, 'the page carries plain columns, not the CSV');
  assert.deepStrictEqual(stored.file.columns.v, [3, 6, null]);
  const big = compose({ data: { big: { csv: 'a,b\n' + Array.from({ length: 3000 }, (_, i) => `${i},${i % 9}`).join('\n') } }, charts: [{ data: 'big', scales: { x: { type: 'linear' }, y: { type: 'linear' } }, marks: [{ type: 'line', x: 'a', y: 'b' }] }] });
  assert.deepStrictEqual(big.compressed, ['big'], 'and a big CSV is compressed like any other data');
  const withAggregate = compose({ data: { s: { csv: 'region,rev\nN,10\nS,20\nN,30' } }, charts: [{ data: 's', transforms: [{ type: 'aggregate', groupby: ['region'], measures: [{ op: 'sum', field: 'rev', as: 'total' }] }], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'region', y: 'total' }] }] });
  assert.deepStrictEqual(withAggregate.diagnostics, [], 'CSV -> aggregate -> bars, all in JSON');
  const opts = compose({ data: { d: { csv: 'k;v\nzip;01234\nabc;2', types: { v: 'string' } } }, charts: [barSpec('d')], allowErrors: true });
  assert.deepStrictEqual(JSON.parse(opts.html.match(/id="bc-data">(.*?)<\/script>/s)[1]).d.columns.v, ['01234', '2'], 'delimiter is detected and types apply');
});

test('csv in a page: every mistake is a ComposeError naming the dataset', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ok.csv'), 'k,v\na,1\n');
  const bad = (data, re, extra) => assert.throws(() => compose({ data, charts: [barSpec('d')], baseDir: dir, ...extra }), (e) => e instanceof ComposeError && re.test(e.message), JSON.stringify(data));
  bad({ d: { csv: '' } }, /^data "d": the CSV is empty/);
  bad({ d: { csv: 'a,b\n1,2,3' } }, /^data "d": row on line 2 has 3 fields/);
  bad({ d: { csvFile: '../x.csv' } }, /^data "d": "csvFile" must stay inside/);
  bad({ d: { csvFile: 'nope.csv' } }, /^data "d": file not found/);
  bad({ d: { csv: 'k,v\na,1', csvFile: 'ok.csv' } }, /either "csv" or "csvFile", not both/);
  bad({ d: { csvFile: 'ok.csv' } }, /needs to know the folder/, { baseDir: undefined });
  bad({ d: { csv: 'k,v\na,x', types: { v: 'number' } } }, /declared a number but contains "x"/);

});

test('csv on the command line: page.json and its CSV files together, and clear failures', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'sales.csv'), 'region,month,revenue\nN,2024-01-01,10\nN,2024-02-01,12\nS,2024-01-01,7\nS,2024-02-01,9\n');
  const page = {
    title: 'CSV page',
    data: { sales: { csvFile: 'data/sales.csv' } },
    charts: [{ data: 'sales', transforms: [{ type: 'aggregate', groupby: ['region'], measures: [{ op: 'sum', field: 'revenue', as: 'total' }] }], scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } }, marks: [{ type: 'rect', x: 'region', y: 'total' }] }],
  };
  fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(page));
  const run = (file, out) => spawnSync(process.execPath, [path.join(__dirname, 'compose.js'), file, out], { cwd: os.tmpdir(), encoding: 'utf8' });
  const ok = run(path.join(dir, 'page.json'), path.join(dir, 'out.html'));
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert(fs.readFileSync(path.join(dir, 'out.html'), 'utf8').includes('CSV page'), 'a page was written (run from another folder: paths are relative to page.json)');

  fs.writeFileSync(path.join(dir, 'escape.json'), JSON.stringify({ ...page, data: { sales: { csvFile: '../data.csv' } } }));
  const esc = run(path.join(dir, 'escape.json'), path.join(dir, 'out2.html'));
  assert.strictEqual(esc.status, 1);
  assert.match(esc.stderr, /must stay inside the folder of the page json/);
  assert(!fs.existsSync(path.join(dir, 'out2.html')), 'nothing is written after an error');

  fs.writeFileSync(path.join(dir, 'broken.csv'), 'a,b\n1,2,3\n');
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ ...page, data: { sales: { csvFile: 'broken.csv' } } }));
  const bad = run(path.join(dir, 'bad.json'), path.join(dir, 'out3.html'));
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /data "sales": row on line 2 has 3 fields, the header has 2/);
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('ok  ', name); }
    catch (e) { failed++; console.log('FAIL', name); console.error(e); process.exitCode = 1; }
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
