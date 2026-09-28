// Mechanical page composer: JSON in, one standalone HTML file out. No model is involved in the gluing.
//   1. BC.needs(spec) says which blocks each chart uses (the core is the single source of that mapping);
//   2. the manifest turns them into the union of closures;
//   3. exactly those blocks are loaded and every spec is validated against the real data before anything is written;
//   4. core + blocks + data + specs are inlined in a fixed order, so the same input gives byte-identical output.
//
// compose({ data, charts, title?, css?, before?, after?, include?, distDir?, allowErrors? }) -> { html, blocks, bytes, diagnostics, unusedData }
//   data    { name: rows | { columns } | { csv: "text" } | { csvFile: "file.csv" } }   the data lake. CSV: the first row names the
//           columns; numbers are recognized per column, "", NA, null... are missing values; optional delimiter, nullValues and
//           types ({ col: "string" }). csvFile is relative to `baseDir` and must stay inside it.
//   charts  [ spec | { spec, title?, note?, noteHtml? } ]
//   before / after  raw trusted HTML placed before the charts / after the scripts (page chrome, custom scripts)
//   include extra block names to inline for hand-written scripts (`after`) that call BC.chart themselves
//   css     extra stylesheet text, placed after the default one
//   defaultCss  false = do not include the default stylesheet (typography, light/dark colors for the chart theme variables)
//   dryRun  true (default): every chart is built once in a sandbox with a fake DOM before anything is written, so problems that
//           only show up when a chart is drawn (a bad color, a failing transform) stop the page like a spec error, and
//           warnings (unsorted data left alone by decimate, an interaction that cannot work) are reported; false = skip
//   baseDir folder that csvFile paths are relative to (the command line uses the folder of the page json)
//   compress 'auto' (default) | true | false. Datasets are stored as base64(gzip(JSON)) when that is worth it ('auto': big and
//           at least 25% smaller), always (true) or never (false). Already-encoded datasets are passed through untouched.
//
// Specs must be plain JSON: a function in one (a tooltip `content`, say) would be silently dropped by JSON.stringify, so it is
// refused; register it in a script (`after`) with BC.defineFn(name, fn) and put the name in the spec.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { byRoleThenName } = require('./build-manifest.js');
const { El, createDocument, FakePath2D } = require('./fake-dom.js');
const { parseCsv, readCsvFile, CsvError } = require('./csv.js');

class ComposeError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = 'ComposeError';
    this.diagnostics = diagnostics || [];
  }
}

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON that is safe inside <script type="application/json">: nothing in the data can close the tag or open a comment. */
const jsonForScript = (v) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const plain = (v) => JSON.parse(JSON.stringify(v));

// Readable without any styling by the caller, and the chart colors follow the reader's light/dark setting.
const DEFAULT_CSS = [
  ':root{--bg:#fff;--fg:#1c1917;--muted:#78716c;--bc-text:#44403c;--bc-axis:#a8a29e;--bc-grid:#eeeceb;--bc-tooltip-bg:#fff;',
  '--bc-c0:#4e79a7;--bc-c1:#f28e2b;--bc-c2:#e15759;--bc-c3:#76b7b2;--bc-c4:#59a14f;--bc-c5:#edc948;--bc-c6:#b07aa1;--bc-c7:#ff9da7}',
  '@media (prefers-color-scheme:dark){:root{--bg:#141312;--fg:#f5f5f4;--muted:#a8a29e;--bc-text:#d6d3d1;--bc-axis:#78716c;--bc-grid:#2a2826;--bc-tooltip-bg:#292725;',
  '--bc-c0:#7aa6d6;--bc-c1:#ffb066;--bc-c2:#ff7f80;--bc-c3:#8fd3ce;--bc-c4:#7ec672;--bc-c5:#f5d76e;--bc-c6:#d0a0c6;--bc-c7:#ffb3bc}}',
  '*{box-sizing:border-box}',
  'body{margin:0 auto;max-width:760px;padding:24px 16px 48px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
  '.bc-section{margin:0 0 32px}.bc-section h2{font-size:16px;margin:0 0 4px}.bc-section p{margin:0 0 12px;color:var(--muted);font-size:13px}',
  '.bc-chart{user-select:none}.bc-legend-item{user-select:none}.bc-legend-filter .bc-legend-item{cursor:pointer}',
  '@media print{body{max-width:none}}',
].join('\n');

const COMPRESS_MIN_CHARS = 2048;
const COMPRESS_MIN_GAIN = 0.75;

const isEncoded = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.encoding === 'string';

/** Path of the first thing in a spec that JSON cannot carry (or would silently change), or null. */
function findUnserializable(value, path, ancestors) {
  const t = typeof value;
  if (t === 'function') return { path, why: 'is a function; a JSON spec cannot carry code. Register it with BC.defineFn(name, fn) in a script and put the name here' };
  if (t === 'symbol' || t === 'bigint') return { path, why: `is a ${t}, which JSON cannot represent` };
  if (t === 'number' && !Number.isFinite(value)) return { path, why: `is ${value}, which JSON turns into null` };
  if (!value || t !== 'object') return null;
  if (ancestors.includes(value)) return { path, why: 'is a circular reference' };
  const next = ancestors.concat([value]);
  const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
  for (const k of keys) {
    const hit = findUnserializable(value[k], Array.isArray(value) ? `${path}[${k}]` : `${path}.${k}`, next);
    if (hit) return hit;
  }
  return null;
}

/** CSV forms become plain columns; everything else is left for the rest of the pipeline. */
function resolveDataset(name, input, baseDir) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (typeof input.csv !== 'string' && typeof input.csvFile !== 'string')) return input;
  try {
    if (typeof input.csv === 'string' && typeof input.csvFile === 'string') throw new CsvError('give either "csv" or "csvFile", not both');
    const text = typeof input.csv === 'string' ? input.csv : readCsvFile(input.csvFile, baseDir);
    return parseCsv(text, { delimiter: input.delimiter, nullValues: input.nullValues, types: input.types });
  } catch (e) {
    if (e instanceof CsvError) throw new ComposeError(`data "${name}": ${e.message}`);
    if (e && e.code === 'ENOENT') throw new ComposeError(`data "${name}": file not found`);
    throw e;
  }
}

/** The plain rows/columns behind a dataset, decoding it the way the page will, so specs can be checked against it. */
// binary columns: { dtype, encoding, data } as a value in `columns` (see BC.BinaryColumn); read like the browser reads them
const DTYPES = { float32: 4, float64: 8, int8: 1, int16: 2, int32: 4, uint8: 1, uint16: 2, uint32: 4 };
const READERS = { float32: 'readFloatLE', float64: 'readDoubleLE', int8: 'readInt8', int16: 'readInt16LE', int32: 'readInt32LE', uint8: 'readUInt8', uint16: 'readUInt16LE', uint32: 'readUInt32LE' };
const isBinaryColumn = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.dtype === 'string';
const hasBinaryColumns = (input) => !!input && typeof input === 'object' && !Array.isArray(input) && !!input.columns && typeof input.columns === 'object' && Object.values(input.columns).some(isBinaryColumn);

function decodeBinaryColumns(name, input) {
  if (!hasBinaryColumns(input)) return input;
  const columns = {};
  for (const [k, v] of Object.entries(input.columns)) {
    if (!isBinaryColumn(v)) { columns[k] = v; continue; }
    const fail = (why) => new ComposeError(`data "${name}": column "${k}": ${why}`);
    if (!DTYPES[v.dtype]) throw fail(`unknown dtype "${v.dtype}" (use ${Object.keys(DTYPES).join(', ')})`);
    if (v.encoding !== 'base64' && v.encoding !== 'gzip+base64') throw fail(`unknown encoding "${v.encoding}" (use "base64" or "gzip+base64")`);
    if (typeof v.data !== 'string') throw fail('a binary column needs a "data" string');
    let bytes;
    try {
      bytes = Buffer.from(v.data.replace(/\s+/g, ''), 'base64');
      if (v.encoding === 'gzip+base64') bytes = zlib.gunzipSync(bytes);
    } catch (e) {
      throw fail(e.message);
    }
    const size = DTYPES[v.dtype];
    if (bytes.length % size) throw fail(`${bytes.length} bytes is not a whole number of ${v.dtype} values`);
    const out = new Array(bytes.length / size);
    for (let i = 0; i < out.length; i++) out[i] = bytes[READERS[v.dtype]](i * size);
    columns[k] = out;
  }
  return { columns };
}

function plainDataset(name, input) {
  if (!isEncoded(input)) return decodeBinaryColumns(name, input);
  let bytes;
  try {
    if (typeof input.data !== 'string') throw new Error('an encoded dataset needs a "data" string');
    if (input.encoding !== 'base64' && input.encoding !== 'gzip+base64') throw new Error(`unknown encoding "${input.encoding}"`);
    bytes = Buffer.from(input.data.replace(/\s+/g, ''), 'base64');
    if (input.encoding === 'gzip+base64') bytes = zlib.gunzipSync(bytes);
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (isEncoded(json)) throw new Error('an encoded dataset cannot contain another one');
    return decodeBinaryColumns(name, json);
  } catch (e) {
    if (e instanceof ComposeError) throw e;
    throw new ComposeError(`data "${name}": ${e.message}`);
  }
}

function encodeDataset(input, mode) {
  if (isEncoded(input) || hasBinaryColumns(input) || mode === false) return { value: input, encoded: false };
  const json = JSON.stringify(input);
  if (mode !== true && json.length < COMPRESS_MIN_CHARS) return { value: input, encoded: false };
  const b64 = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
  if (mode !== true && b64.length > json.length * COMPRESS_MIN_GAIN) return { value: input, encoded: false };
  return { value: { encoding: 'gzip+base64', data: b64 }, encoded: true };
}

/** One <style> for all the CSS given; `</style` inside it cannot end the tag early. */
function styleTag(parts) {
  const css = parts.filter(Boolean).join('\n');
  return css ? `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>` : '';
}

function compose(opts) {
  const options = opts || {};
  // next to manifest.json (a packaged skill) or in the repo's dist folder
  const distDir = path.resolve(options.distDir || (fs.existsSync(path.join(__dirname, 'manifest.json')) ? __dirname : fs.existsSync(path.join(__dirname, '../dist/min/manifest.json')) ? path.join(__dirname, '../dist/min') : path.join(__dirname, '../dist')));
  const manifestFile = path.join(distDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new ComposeError(`${manifestFile} not found: run the build and scripts/build-manifest.js first`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const read = (rel) => fs.readFileSync(path.join(distDir, rel), 'utf8');

  const given = options.data || {};
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new ComposeError('data must be an object of named datasets');
  const data = {};
  for (const name of Object.keys(given)) data[name] = resolveDataset(name, given[name], options.baseDir);
  if (!Array.isArray(options.charts) || !options.charts.length) throw new ComposeError('charts must be a non-empty array');
  const compress = options.compress === undefined ? 'auto' : options.compress;
  if (compress !== 'auto' && compress !== true && compress !== false) throw new ComposeError('compress must be "auto", true or false');
  const charts = options.charts.map((c, i) => {
    const entry = c && c.spec ? c : { spec: c };
    if (!entry.spec || typeof entry.spec !== 'object') throw new ComposeError(`charts[${i}] is not a chart spec`);
    const bad = findUnserializable(entry.spec, `charts[${i}]`, []);
    if (bad) throw new ComposeError(`${bad.path} ${bad.why}`);
    return entry;
  });

  // a sandbox with only the core: it answers BC.needs and, once the blocks are in, BC.validate
  // what the core and blocks say to the console while charts are tried out is collected, not lost
  const captured = [];
  const say = (level) => (...a) => captured.push({ level, text: a.map(String).join(' ') });
  const sandbox = { console: { warn: say('warn'), error: say('error'), log() {} } };
  vm.createContext(sandbox);
  vm.runInContext(read(manifest.core.file), sandbox, { filename: 'core.js', timeout: 2000 });
  const BC = sandbox.BC;
  if (!BC) throw new ComposeError('core.js did not define BC');

  // 1 + 2: needs -> closure union
  const wanted = new Set();
  for (const name of options.include || []) wanted.add(name);
  for (const { spec } of charts) for (const name of Array.from(BC.needs(spec))) wanted.add(name);
  const missing = Array.from(wanted).filter((n) => !manifest.blocks[n]).sort();
  if (missing.length) {
    throw new ComposeError(`no such block${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Available: ${Object.keys(manifest.blocks).join(', ')}`);
  }
  const used = new Set();
  for (const name of wanted) for (const n of manifest.blocks[name].closure) used.add(n);
  const blockNames = Array.from(used).sort(byRoleThenName);

  // 3: load exactly those blocks, then check every spec against the real data
  for (const name of blockNames) vm.runInContext(read(manifest.blocks[name].file), sandbox, { filename: name, timeout: 2000 });
  for (const name of Object.keys(data)) {
    try {
      BC.data(name, plainDataset(name, data[name]));
    } catch (e) {
      if (e instanceof ComposeError) throw e;
      throw new ComposeError(`data "${name}": ${e.message}`);
    }
  }
  const diagnostics = [];
  charts.forEach(({ spec }, i) => {
    for (const d of plain(Array.from(BC.validate(spec)))) diagnostics.push({ ...d, chart: i, path: `charts[${i}].${d.path}`.replace(/\.$/, '') });
  });
  // 3b: build every chart once, the way a page would, in a sandbox with a fake DOM
  if (options.dryRun !== false) {
    sandbox.document = createDocument();
    sandbox.getComputedStyle = () => ({ position: 'static' });
    sandbox.setTimeout = () => 0;
    sandbox.Path2D = FakePath2D;
    const known = new Set(diagnostics.map((d) => `${d.chart}|${d.level}|${d.path}|${d.message}`));
    charts.forEach(({ spec }, i) => {
      // a chart that already failed validation has nothing more to say
      if (diagnostics.some((d) => d.chart === i && d.level === 'error')) return;
      const mark = captured.length;
      let found = [];
      try {
        const handle = BC.chart(new El('div', sandbox.document), spec);
        found = plain(Array.from(handle.diagnostics));
        handle.destroy();
      } catch (e) {
        found = [{ level: 'error', path: '', message: e.message }];
      }
      const said = new Set(found.map((d) => `[blockcharts] ${d.path || '(spec)'}: ${d.message}`));
      for (const c of captured.slice(mark)) {
        // the core logs each diagnostic too; only what is not already a diagnostic is new
        if (!said.has(c.text)) found.push({ level: c.level === 'error' ? 'error' : 'warn', path: '', message: c.text.replace(/^\[blockcharts\] /, '') });
      }
      for (const d of found) {
        const item = { ...d, chart: i, path: `charts[${i}].${d.path}`.replace(/\.$/, '') };
        const key = `${i}|${item.level}|${item.path}|${item.message}`;
        // validation already said this one (the chart repeats its own validation)
        if (known.has(key) || known.has(`${i}|${d.level}|${d.path ? 'charts[' + i + '].' + d.path : ''}|${d.message}`)) continue;
        known.add(key);
        diagnostics.push(item);
      }
    });
  }

  const errors = diagnostics.filter((d) => d.level === 'error');
  if (errors.length && !options.allowErrors) {
    throw new ComposeError(`${errors.length} spec error(s):\n - ` + errors.map((d) => `${d.path}: ${d.message}`).join('\n - '), diagnostics);
  }

  // 4: assemble
  const usedDatasets = new Set(charts.map((c) => c.spec.data));
  const unusedData = Object.keys(data).filter((n) => !usedDatasets.has(n));
  const stored = {};
  const compressed = [];
  for (const name of Object.keys(data)) {
    const r = encodeDataset(data[name], compress);
    stored[name] = r.value;
    if (r.encoded) compressed.push(name);
  }
  const script = (code) => `<script>\n${code}\n</script>`;
  const scripts = [read(manifest.core.file)].concat(blockNames.map((n) => read(manifest.blocks[n].file)));
  const bytes = scripts.reduce((n, s) => n + Buffer.byteLength(s), 0);

  const section = ({ spec, title, note, noteHtml }) => {
    const tag = `<script type="application/json" data-bc-chart>${jsonForScript(spec)}</script>`;
    if (!title && !note && !noteHtml) return tag;
    return `<section class="bc-section">${title ? `<h2>${escapeText(title)}</h2>` : ''}${note ? `<p>${escapeText(note)}</p>` : ''}${noteHtml ? `<p>${noteHtml}</p>` : ''}\n${tag}</section>`;
  };

  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeText(options.title || 'Charts')}</title>`,
    styleTag([options.defaultCss === false ? '' : DEFAULT_CSS, options.css ? String(options.css) : '']),
    '</head><body>',
    options.before || '',
    charts.map(section).join('\n'),
    scripts.map(script).join('\n'),
    `<script type="application/json" id="bc-data">${jsonForScript(stored)}</script>`,
    options.after || '',
    '</body></html>',
    '',
  ].filter((s) => s !== '').join('\n');

  return { html, blocks: blockNames, bytes, diagnostics, unusedData, compressed };
}

module.exports = { compose, ComposeError, jsonForScript, escapeText, resolveDataset, DEFAULT_CSS };

// CLI: node scripts/compose.js page.json out.html
//   page.json = { "title": "...", "data": { ... }, "charts": [ ... ] }
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node scripts/compose.js <page.json> <out.html>');
    process.exit(2);
  }
  try {
    const page = JSON.parse(fs.readFileSync(input, 'utf8'));
    const r = compose({ ...page, baseDir: path.dirname(path.resolve(input)) });
    fs.writeFileSync(output, r.html);
    console.log(`${output}: ${(r.html.length / 1024).toFixed(1)} KB, ${r.blocks.length} blocks (${r.blocks.join(', ')})`);
    for (const d of r.diagnostics) console.warn(`${d.level} ${d.path}: ${d.message}`);
    if (r.unusedData.length) console.warn(`unused datasets: ${r.unusedData.join(', ')}`);
    if (r.compressed.length) console.log(`compressed datasets: ${r.compressed.join(', ')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
