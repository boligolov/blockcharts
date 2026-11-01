// Mechanical page composer: JSON in, one standalone HTML file out. No model is involved in the gluing.
//   1. BC.needs(spec) says which blocks each chart uses (the core is the single source of that mapping);
//   2. the manifest turns them into the union of closures;
//   3. exactly those blocks are loaded and every spec is validated against the real data before anything is written;
//   4. core + blocks + data + specs are inlined in a fixed order, so the same input gives byte-identical output.
//
// compose({ data, charts, title?, subtitle?, layout?, css?, before?, after?, include?, distDir?, allowErrors? }) -> { html, blocks, bytes, diagnostics, unusedData, compressed, core }
//   core is the file of the core the page carries: a lean one without BC.validate / BC.needs (the composer has run them),
//   and without the data decoder when no dataset is encoded; the full core when the page has errors to show.
//   data    { name: rows | { columns } | { csv: "text" } | { csvFile: "file.csv" } }   the data lake. CSV: the first row names the
//           columns; numbers are recognized per column, "", NA, null... are missing values; optional delimiter, nullValues and
//           types ({ col: "string" }). csvFile is relative to `baseDir` and must stay inside it.
//   charts  [ spec | { spec, title?, note?, noteHtml?, span?, minWidth? } | { section, note? } ]   each chart sits in a card; span =
//           how many grid columns it takes; minWidth = the px below which the chart keeps its width and its card scrolls sideways.
//           { section } is a heading over the whole width that starts a group of cards
//           { spec, facet: { field, columns?, values?, free? } } draws the chart once per value of a field of the dataset, in one
//           card, on shared axes: every scale without a domain of its own gets the union of the panels, except those named in
//           free; a legend of categories is drawn once above the panels
//   lang    the language of the page ("ko", "ja", "zh-CN"): <html lang>, the font for that language, and the language numbers
//           and dates are written in. A { section } or a chart entry can take a lang of its own; a section's lasts until the next
//   title / subtitle  the page heading (and the <title>) and one line under it
//   layout  { columns: 1..12 } a dashboard grid: charts fill it left to right, a card takes `span` columns (default: the full row);
//           on a narrow screen every card takes the full width
//   before / after  raw trusted HTML placed before the charts / after the scripts (page chrome, custom scripts)
//   include extra block names to inline for hand-written scripts (`after`) that call BC.chart themselves
//   css     extra stylesheet text, placed after the default one
//   defaultCss  false = do not include the default stylesheet (typography, light/dark colors for the chart theme variables)
//   dryRun  true (default): every chart is built once in a sandbox with a fake DOM before anything is written, so problems that
//           only show up when a chart is drawn (a bad color, a failing transform) stop the page like a spec error, and
//           warnings (unsorted data left alone by decimate, an interaction that cannot work) are reported; false = skip
//   drawTimeout  ms one chart may take in that trial run (default 10000); past it the chart is a spec error, not a hang
//   baseDir folder that csvFile paths are relative to (the command line uses the folder of the page json)
//   compress 'auto' (default) | true | false. Datasets are stored as base64(gzip(JSON)) when that is worth it ('auto': big,
//           at least 25% smaller, and saving more than the decoder the page then carries), always (true) or never (false).
//           Already-encoded datasets are passed through untouched.
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
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const plain = (v) => JSON.parse(JSON.stringify(v));

// Readable without any styling by the caller, and the chart colors follow the reader's light/dark setting. The look of a
// business dashboard: a quiet grey page, white cards, one strong blue among calm colors, the reader's own UI font (no web
// font: a report loads nothing), figures that line up. Every color is a variable, so a company palette is a few lines of css.
const DEFAULT_CSS = [
  ':root{--bg:#f4f5f7;--card:#fff;--fg:#0f172a;--muted:#64748b;--line:#e4e7ec;',
  '--bc-text:#1e293b;--bc-label:#64748b;--bc-axis:#cbd2dc;--bc-grid:#edf0f4;--bc-tooltip-bg:#fff;--bc-kpi:#0f172a;--bc-good:#11a05a;--bc-bad:#e5484d;',
  '--bc-c0:#3a6fe4;--bc-c1:#16a39d;--bc-c2:#f29b38;--bc-c3:#e0527a;--bc-c4:#8a6be8;--bc-c5:#5d718f;--bc-c6:#2e9e62;--bc-c7:#ea7b4f;--bc-c8:#8c6d46;--bc-c9:#a3ad3a;--bc-c10:#1f7a9c;--bc-c11:#b0479a;',
  '--bc-on-c0:#fff;--bc-on-c1:#111;--bc-on-c2:#111;--bc-on-c3:#111;--bc-on-c4:#111;--bc-on-c5:#fff;--bc-on-c6:#111;--bc-on-c7:#111;--bc-on-c8:#fff;--bc-on-c9:#111;--bc-on-c10:#fff;--bc-on-c11:#fff}',
  '@media (prefers-color-scheme:dark){:root{--bg:#0c1016;--card:#141a22;--fg:#e8edf4;--muted:#8a96a8;--line:#232b36;',
  '--bc-text:#d9e0ea;--bc-label:#8a96a8;--bc-axis:#3a4452;--bc-grid:#212a35;--bc-tooltip-bg:#1b2330;--bc-kpi:#f3f6fa;--bc-good:#3dc57f;--bc-bad:#ff6b6f;',
  '--bc-c0:#6f98f4;--bc-c1:#3cc7c0;--bc-c2:#f6b25e;--bc-c3:#f27b9b;--bc-c4:#a88ff3;--bc-c5:#8fa2bd;--bc-c6:#55c68b;--bc-c7:#f69a73;--bc-c8:#c4a57a;--bc-c9:#c6d05e;--bc-c10:#58b4d6;--bc-c11:#dc7cc6;',
  '--bc-on-c0:#111;--bc-on-c1:#111;--bc-on-c2:#111;--bc-on-c3:#111;--bc-on-c4:#111;--bc-on-c5:#111;--bc-on-c6:#111;--bc-on-c7:#111;--bc-on-c8:#111;--bc-on-c9:#111;--bc-on-c10:#111;--bc-on-c11:#111}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}',
  ':lang(ja){font-family:Inter,"Hiragino Sans","Yu Gothic UI","Yu Gothic",Meiryo,"Noto Sans CJK JP",sans-serif}',
  ':lang(ko){font-family:Inter,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans CJK KR",sans-serif}',
  ':lang(zh){font-family:Inter,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif}',
  ':lang(zh-Hant),:lang(zh-TW),:lang(zh-HK){font-family:Inter,"PingFang TC","Microsoft JhengHei","Noto Sans CJK TC",sans-serif}',
  '.bc-page{max-width:880px;margin:0 auto;padding:32px 20px 56px}.bc-page.bc-wide{max-width:1240px}',
  '.bc-header{margin:0 0 20px}.bc-header h1{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:0 0 4px}.bc-header p{margin:0;color:var(--muted)}',
  '.bc-grid{display:grid;grid-template-columns:repeat(var(--bc-cols,1),minmax(0,1fr));gap:16px}',
  '.bc-section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px 14px;min-width:0;box-shadow:0 1px 2px rgba(16,24,40,.04)}',
  '.bc-section h2,.bc-section h3{font-size:14px;font-weight:600;margin:0 0 2px}.bc-section p{margin:0 0 10px;color:var(--muted);font-size:13px}',
  '.bc-group{grid-column:1/-1;margin:16px 0 -4px}.bc-group:first-child{margin-top:0}.bc-group h2{font-size:18px;line-height:1.3;letter-spacing:-.01em;font-weight:650;margin:0}.bc-group p{margin:2px 0 0;color:var(--muted)}',
  '.bc-facets{display:grid;grid-template-columns:repeat(var(--bc-facet-cols,2),minmax(0,1fr));gap:12px 16px}.bc-facet{min-width:0}.bc-section h4{font-size:12px;font-weight:600;margin:0 0 2px}',
  '.bc-facet-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin:0 0 8px}.bc-facet-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}.bc-facet-legend button{all:unset;cursor:pointer}.bc-facet-legend button:focus-visible{outline:2px solid currentColor;outline-offset:2px}.bc-facet-legend [aria-pressed=false]{opacity:.4}',
  '@media (max-width:720px){.bc-facets{grid-template-columns:repeat(min(var(--bc-facet-cols,2),2),minmax(0,1fr))}}@media (max-width:480px){.bc-facets{grid-template-columns:minmax(0,1fr)}}',
  '.bc-scroll{overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}',
  '.bc-chart{user-select:none}.bc-chart text{font-variant-numeric:tabular-nums}.bc-legend-item{user-select:none}.bc-legend-filter .bc-legend-item{cursor:pointer}',
  '@media (max-width:720px){.bc-grid{grid-template-columns:1fr}.bc-grid>.bc-section{grid-column:auto!important}.bc-page{padding:20px 12px 40px}}',
  '@media print{body{background:#fff}.bc-page,.bc-page.bc-wide{max-width:none;padding:0}.bc-section{box-shadow:none;break-inside:avoid}.bc-group{break-after:avoid}.bc-scroll{overflow:visible}}',
].join('\n');

const COMPRESS_MIN_CHARS = 2048;
const COMPRESS_MIN_GAIN = 0.75;

const isEncoded = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.encoding === 'string';

/** Path of the first thing in a spec that JSON cannot carry (or would silently change), or null. */
function findUnserializable(value, path, ancestors) {
  const t = typeof value;
  if (t === 'function')
    return {
      path,
      why: 'is a function; a JSON spec cannot carry code. Register it with BC.defineFn(name, fn) in a script and put the name here',
    };
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
  if (!input || typeof input !== 'object' || Array.isArray(input) || (typeof input.csv !== 'string' && typeof input.csvFile !== 'string'))
    return input;
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
const READERS = {
  float32: 'readFloatLE',
  float64: 'readDoubleLE',
  int8: 'readInt8',
  int16: 'readInt16LE',
  int32: 'readInt32LE',
  uint8: 'readUInt8',
  uint16: 'readUInt16LE',
  uint32: 'readUInt32LE',
};
const isBinaryColumn = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.dtype === 'string';
const hasBinaryColumns = (input) =>
  !!input &&
  typeof input === 'object' &&
  !Array.isArray(input) &&
  !!input.columns &&
  typeof input.columns === 'object' &&
  Object.values(input.columns).some(isBinaryColumn);

// The page decodes with the browser's atob() and a size limit (fromBase64, gunzip and MAX_DECODED_BYTES in src/core.ts).
// Node is more forgiving — Buffer.from takes base64url and skips characters it does not know, gunzip has no limit — so data
// read here the Node way could pass and still fail in the browser. It is read the browser's way.
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const tooLarge = () => new Error(`the decoded data is larger than ${MAX_DECODED_BYTES / 1024 / 1024} MB, refusing to unpack it`);

function fromBase64(text) {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('the data is not valid base64');
  return Buffer.from(clean, 'base64');
}

/** `budget.left`: what is left of the dataset's MAX_DECODED_BYTES. */
function gunzip(bytes, budget) {
  try {
    return zlib.gunzipSync(bytes, { maxOutputLength: Math.max(1, budget.left) });
  } catch (e) {
    if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) throw tooLarge();
    throw new Error('the data is not valid gzip');
  }
}

function decodeBinaryColumns(name, input, budget = { left: MAX_DECODED_BYTES }) {
  if (!hasBinaryColumns(input)) return input;
  const columns = {};
  for (const [k, v] of Object.entries(input.columns)) {
    if (!isBinaryColumn(v)) {
      columns[k] = v;
      continue;
    }
    const fail = (why) => new ComposeError(`data "${name}": column "${k}": ${why}`);
    if (!DTYPES[v.dtype]) throw fail(`unknown dtype "${v.dtype}" (use ${Object.keys(DTYPES).join(', ')})`);
    if (v.encoding !== 'base64' && v.encoding !== 'gzip+base64')
      throw fail(`unknown encoding "${v.encoding}" (use "base64" or "gzip+base64")`);
    if (typeof v.data !== 'string') throw fail('a binary column needs a "data" string');
    let bytes;
    try {
      bytes = fromBase64(v.data);
      if (v.encoding === 'gzip+base64') bytes = gunzip(bytes, budget);
    } catch (e) {
      throw fail(e.message);
    }
    const size = DTYPES[v.dtype];
    if (bytes.length % size) throw fail(`${bytes.length} bytes is not a whole number of ${v.dtype} values`);
    budget.left -= (bytes.length / size) * 8;
    if (budget.left < 0) throw new ComposeError(`data "${name}": ${tooLarge().message}`);
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
    const budget = { left: MAX_DECODED_BYTES };
    bytes = fromBase64(input.data);
    if (input.encoding === 'gzip+base64') bytes = gunzip(bytes, budget);
    // the JSON and the binary columns inside it share one limit
    budget.left -= bytes.length;
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (isEncoded(json)) throw new Error('an encoded dataset cannot contain another one');
    return decodeBinaryColumns(name, json, budget);
  } catch (e) {
    if (e instanceof ComposeError) throw e;
    throw new ComposeError(`data "${name}": ${e.message}`);
  }
}

/** Whether the core has to decode a stored dataset: the same tests as isEncoded / hasBinaryColumns in src/core.ts. */
function needsDecoding(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.encoding === 'string') return true;
  const cols = v.columns;
  return (
    !!cols &&
    typeof cols === 'object' &&
    Object.keys(cols).some((k) => {
      const c = cols[k];
      return !!c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Float64Array) && typeof c.dtype === 'string';
    })
  );
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

const MAX_PANELS = 36;

const facetSpec = (spec, field, value, at) => {
  const transforms = (spec.transforms || []).slice();
  transforms.splice(at, 0, { type: 'filter', field, value });
  return { ...spec, transforms };
};

/** The values of a facet, checked; what is faceted on may be a column of the dataset or one a transform made. */
function facetValues(entry, i, found) {
  const { facet } = entry;
  const fail = (why) => new ComposeError(`charts[${i}].facet: ${why}`);
  if (facet.values !== undefined && !Array.isArray(facet.values)) throw fail('"values" must be a list');
  const values = facet.values || found;
  for (const v of values) {
    if (typeof v !== 'string' && typeof v !== 'number') throw fail('a value must be text or a number');
    if (!found.includes(v)) throw fail(`${JSON.stringify(v)} is not a value of "${facet.field}"`);
  }
  if (!values.length) throw fail(`"${facet.field}" has no values`);
  if (values.length > MAX_PANELS)
    throw fail(`${values.length} panels are too many to compare (at most ${MAX_PANELS}); pick some with "values"`);
  return values;
}

const distinct = (column) => Array.from(new Set(Array.from(column).filter((v) => v !== null && v !== undefined && v !== '')));

/** The panels of a chart with a `facet`: its spec, once per value of the field, each keeping only that value's rows. The filter
 *  comes first, so what the other transforms compute (a stack, a total) is computed within the panel. A field a transform makes
 *  has no values until the blocks are loaded: for now there is one panel, which tells the composer which blocks it needs, and
 *  transformFacet replaces it. */
function facetPanels(entry, i, data) {
  const { spec, facet } = entry;
  const fail = (why) => new ComposeError(`charts[${i}].facet: ${why}`);
  if (!facet || typeof facet !== 'object' || Array.isArray(facet)) throw fail('must be an object: { "field": "region" }');
  for (const k of Object.keys(facet))
    if (!['field', 'columns', 'values', 'free'].includes(k)) throw fail(`"${k}" is not known (field, columns, values, free)`);
  if (typeof facet.field !== 'string' || !facet.field) throw fail('"field" must name a column of the dataset');
  if (entry.minWidth !== undefined) throw fail('panels reflow by themselves, so it does not go with minWidth');
  if (spec.id !== undefined) throw fail('one spec makes many charts, so it cannot have an "id"');
  if (facet.columns !== undefined && (!Number.isInteger(facet.columns) || facet.columns < 1 || facet.columns > 6))
    throw fail('"columns" must be a whole number from 1 to 6');
  if (facet.free !== undefined && (!Array.isArray(facet.free) || facet.free.some((n) => typeof n !== 'string')))
    throw fail('"free" must be a list of scale names');
  if (typeof spec.data !== 'string' || !data[spec.data]) throw fail(`the chart's dataset "${String(spec.data)}" is not in data`);
  const set = plainDataset(spec.data, data[spec.data]);
  const column = Array.isArray(set) ? set.map((r) => r[facet.field]) : set.columns && set.columns[facet.field];
  if (!column || (Array.isArray(set) && column.every((v) => v === undefined))) {
    if (!(spec.transforms || []).length) throw fail(`"${facet.field}" is not a column of "${spec.data}"`);
    entry.madeField = true;
    return [{ label: '', spec: facetSpec(spec, facet.field, '', spec.transforms.length) }];
  }
  return facetValues(entry, i, distinct(column)).map((v) => ({ label: String(v), spec: facetSpec(spec, facet.field, v, 0) }));
}

/** Facets on a field a transform makes: the panels filter right after that transform, so what comes later is per panel. */
function transformFacet(entry, BC) {
  const { spec, facet, index: i } = entry;
  const fail = (why) => new ComposeError(`charts[${i}].facet: ${why}`);
  const at = spec.transforms.findIndex((ts) => {
    const def = BC.get(`transform.${ts.type}`);
    try {
      return def && def.outputs && Array.from(def.outputs(ts)).includes(facet.field);
    } catch (e) {
      return false; // a transform that cannot name its columns is reported by the validation
    }
  });
  if (at < 0) throw fail(`"${facet.field}" is not a column of "${spec.data}", and no transform of the chart makes it`);
  let table = BC.table(spec.data);
  for (const ts of spec.transforms.slice(0, at + 1)) {
    const def = BC.get(`transform.${ts.type}`);
    if (def.viewDependent === true) throw fail(`it cannot come after transform.${ts.type}, which depends on the zoom`);
    try {
      table = def.apply(table, ts);
    } catch (e) {
      throw fail(e.message);
    }
  }
  const values = facetValues(entry, i, distinct(table.columns[facet.field]));
  return values.map((v) => ({ label: String(v), spec: facetSpec(spec, facet.field, v, at + 1) }));
}

function compose(opts) {
  const options = opts || {};
  // next to manifest.json (a packaged skill) or in the repo's dist folder
  const distDir = path.resolve(
    options.distDir ||
      (fs.existsSync(path.join(__dirname, 'manifest.json'))
        ? __dirname
        : fs.existsSync(path.join(__dirname, '../dist/min/manifest.json'))
          ? path.join(__dirname, '../dist/min')
          : path.join(__dirname, '../dist')),
  );
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
  const layout = options.layout;
  if (layout !== undefined && (!layout || typeof layout !== 'object' || Array.isArray(layout)))
    throw new ComposeError('layout must be an object: { "columns": 4 }');
  const columns = layout && layout.columns !== undefined ? layout.columns : 1;
  if (!Number.isInteger(columns) || columns < 1 || columns > 12)
    throw new ComposeError('layout.columns must be a whole number from 1 to 12');
  const ids = new Map();
  const validLang = (v, where) => {
    if (v !== undefined && (typeof v !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)))
      throw new ComposeError(`${where} must be a language tag like "ko" or "zh-CN"`);
    return v;
  };
  const pageLang = validLang(options.lang, 'lang');
  let groupLang = pageLang;
  const entries = options.charts.map((c, i) => {
    if (c && c.section !== undefined) {
      if (typeof c.section !== 'string' || !c.section.trim())
        throw new ComposeError(`charts[${i}].section must be the text of the heading`);
      if (c.spec !== undefined) throw new ComposeError(`charts[${i}] has both "section" and "spec": a section is a heading of its own`);
      if (c.note !== undefined && typeof c.note !== 'string') throw new ComposeError(`charts[${i}].note must be text`);
      const stray = Object.keys(c).filter((k) => k !== 'section' && k !== 'note' && k !== 'lang');
      if (stray.length) throw new ComposeError(`charts[${i}]: a section takes "section", "note" and "lang", not "${stray.join('", "')}"`);
      groupLang = validLang(c.lang, `charts[${i}].lang`) || pageLang;
      return { ...c, lang: groupLang };
    }
    const entry = c && c.spec ? { ...c, index: i } : { spec: c, index: i };
    entry.lang = validLang(entry.lang, `charts[${i}].lang`) || groupLang;
    if (entry.lang && entry.spec && typeof entry.spec === 'object' && entry.spec.locale === undefined)
      entry.spec = { ...entry.spec, locale: entry.lang };
    if (entry.minWidth !== undefined && (!Number.isFinite(entry.minWidth) || entry.minWidth <= 0 || entry.minWidth > 4000))
      throw new ComposeError(`charts[${i}].minWidth must be a width in px, from 1 to 4000`);
    if (entry.facet !== undefined && entry.spec && typeof entry.spec === 'object') entry.panels = facetPanels(entry, i, data);
    if (entry.span !== undefined && (!Number.isInteger(entry.span) || entry.span < 1 || entry.span > columns)) {
      throw new ComposeError(`charts[${i}].span must be a whole number from 1 to ${columns} (layout.columns)`);
    }
    if (!entry.spec || typeof entry.spec !== 'object') throw new ComposeError(`charts[${i}] is not a chart spec`);
    const bad = findUnserializable(entry.spec, `charts[${i}]`, []);
    if (bad) throw new ComposeError(`${bad.path} ${bad.why}`);
    // the id is the element the chart is drawn in: two charts with one id would draw into one, the second wiping out the first
    const id = entry.spec.id;
    if (id !== undefined) {
      if (typeof id !== 'string' || !/^[A-Za-z][\w-]*$/.test(id))
        throw new ComposeError(`charts[${i}].id must be a name of letters, digits, "-" and "_", starting with a letter`);
      if (id === 'bc-data') throw new ComposeError(`charts[${i}].id "bc-data" is the id of the page's data; choose another`);
      if (ids.has(id))
        throw new ComposeError(`charts[${i}].id "${id}" is also the id of charts[${ids.get(id)}]; every chart needs its own`);
      ids.set(id, i);
    }
    return entry;
  });
  const facets = entries.filter((e) => e.panels);
  // from here on a panel is a chart like any other, and its errors are reported at the entry it came from
  const panelled = () =>
    entries
      .filter((e) => e.section === undefined)
      .flatMap((e) => (e.panels ? e.panels.map((p) => ({ ...e, spec: p.spec, panel: p })) : [e]));
  let charts = panelled();
  if (!charts.length) throw new ComposeError('charts must have at least one chart, not only sections');

  // a sandbox with only the core: it answers BC.needs and, once the blocks are in, BC.validate
  // what the core and blocks say to the console while charts are tried out is collected, not lost
  const captured = [];
  const say =
    (level) =>
    (...a) =>
      captured.push({ level, text: a.map(String).join(' ') });
  const sandbox = { console: { warn: say('warn'), error: say('error'), log() {} } };
  vm.createContext(sandbox);
  vm.runInContext(read(manifest.core.file), sandbox, { filename: 'core.js', timeout: 2000 });
  const BC = sandbox.BC;
  if (!BC) throw new ComposeError('core.js did not define BC');

  // 1 + 2: needs -> closure union
  const wanted = new Set();
  for (const name of options.include || []) wanted.add(name);
  for (const { spec } of charts) for (const name of Array.from(BC.needs(spec))) wanted.add(name);
  const missing = Array.from(wanted)
    .filter((n) => !manifest.blocks[n])
    .sort();
  if (missing.length) {
    throw new ComposeError(
      `no such block${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Available: ${Object.keys(manifest.blocks).join(', ')}`,
    );
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
  for (const entry of facets) if (entry.madeField) entry.panels = transformFacet(entry, BC);
  charts = panelled();
  const diagnostics = [];
  charts.forEach(({ spec, index: i }) => {
    for (const d of plain(Array.from(BC.validate(spec))))
      diagnostics.push({ ...d, chart: i, path: `charts[${i}].${d.path}`.replace(/\.$/, '') });
  });
  const drawTimeout = typeof options.drawTimeout === 'number' && options.drawTimeout > 0 ? options.drawTimeout : 10000;
  sandbox.document = createDocument();
  sandbox.getComputedStyle = () => ({ position: 'static' });
  sandbox.setTimeout = () => 0;
  sandbox.Path2D = FakePath2D;

  // the panels of a facet share their scales: each is drawn once to see what it needs, and all of them get the union
  for (const entry of facets) {
    if (diagnostics.some((d) => d.chart === entry.index && d.level === 'error')) continue;
    const views = [];
    for (const panel of entry.panels) {
      try {
        sandbox.__bcView = () => {
          const handle = BC.chart(new El('div', sandbox.document), panel.spec);
          views.push(plain(handle.getView()));
          handle.destroy();
        };
        vm.runInContext('__bcView()', sandbox, { timeout: drawTimeout });
      } catch (e) {
        views.push({}); // the trial run below reports it
      } finally {
        delete sandbox.__bcView;
      }
    }
    captured.length = 0; // the empty panels of this look are not news; the trial run says what is
    const free = entry.facet.free || [];
    const scales = { ...(entry.spec.scales || {}) };
    for (const name of Object.keys(scales)) {
      const s = scales[name];
      if (free.includes(name) || s.domain !== undefined) continue;
      const seen = views.map((v) => v[name]).filter(Array.isArray);
      if (!seen.length) continue;
      if (s.type === 'band' || s.type === 'color') scales[name] = { ...s, domain: Array.from(new Set(seen.flat())) };
      else if (['linear', 'log', 'time', 'sequential'].includes(s.type)) {
        const ends = seen.flat().map(Number);
        scales[name] = { ...s, domain: [Math.min(...ends), Math.max(...ends)] };
        if (s.type === 'linear' || s.type === 'log') scales[name].nice = false; // each panel was already rounded
      }
    }
    // a legend of categories says the same in every panel: it goes above them, once
    const legendOf = (entry.spec.guides || []).find((g) => g.type === 'legend' && scales[g.scale] && scales[g.scale].type === 'color');
    if (legendOf) {
      if ((entry.spec.interaction || []).some((x) => x.type === 'legend-filter')) entry.legendId = `bc-facet-legend-${entry.index}`;
      const s = scales[legendOf.scale];
      const range = Array.isArray(s.range) && s.range.length ? s.range : null;
      entry.legend = (s.domain || []).map((v, k) => ({ label: String(v), color: range ? range[k % range.length] : BC.color(k) }));
    }
    for (const panel of entry.panels) {
      const guides = (entry.spec.guides || []).filter((g) => !legendOf || g !== legendOf);
      // the panels filter together from the legend above them; a shared scale is not refitted, or they would stop being comparable
      const interaction = entry.spec.interaction
        ? entry.spec.interaction.map((x) =>
            legendOf && x.type === 'legend-filter'
              ? {
                  ...x,
                  scale: legendOf.scale,
                  legend: entry.legendId,
                  ...(x.fit ? { fit: x.fit.filter((n) => free.includes(n)) } : {}),
                }
              : x,
          )
        : undefined;
      Object.assign(panel.spec, { scales, guides }, interaction ? { interaction } : {});
    }
  }

  // 3b: build every chart once, the way a page would, in a sandbox with a fake DOM
  if (options.dryRun !== false) {
    const known = new Set(diagnostics.map((d) => `${d.chart}|${d.level}|${d.path}|${d.message}`));
    charts.forEach(({ spec, index: i }) => {
      // a chart that already failed validation has nothing more to say
      if (diagnostics.some((d) => d.chart === i && d.level === 'error')) return;
      const mark = captured.length;
      let found = [];
      try {
        // run inside the sandbox, under its timeout: a block stuck in a loop on this data stops the build with an error
        // instead of hanging the composer (and the agent waiting for it) forever
        sandbox.__bcTrial = () => {
          const handle = BC.chart(new El('div', sandbox.document), spec);
          found = plain(Array.from(handle.diagnostics));
          handle.destroy();
        };
        vm.runInContext('__bcTrial()', sandbox, { timeout: drawTimeout });
      } catch (e) {
        const stuck = e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
        found = [
          {
            level: 'error',
            path: '',
            message: stuck ? `did not finish drawing in ${drawTimeout / 1000} s: a block is stuck on this data or spec` : e.message,
          },
        ];
      } finally {
        delete sandbox.__bcTrial;
      }
      const said = new Set(found.map((d) => `[blockcharts] ${d.path || '(spec)'}: ${d.message}`));
      for (const c of captured.slice(mark)) {
        // the core logs each diagnostic too; only what is not already a diagnostic is new
        if (!said.has(c.text))
          found.push({ level: c.level === 'error' ? 'error' : 'warn', path: '', message: c.text.replace(/^\[blockcharts\] /, '') });
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
    throw new ComposeError(
      `${errors.length} spec error(s):\n - ` + errors.map((d) => `${d.path}: ${d.message}`).join('\n - '),
      diagnostics,
    );
  }

  // 4: assemble
  const usedDatasets = new Set(charts.map((c) => c.spec.data));
  const unusedData = Object.keys(data).filter((n) => !usedDatasets.has(n));
  const stored = {};
  let compressed = [];
  let saved = 0;
  // a page's own script can read any dataset, so with `after` they all stay
  const carried = Object.keys(data).filter((n) => usedDatasets.has(n) || options.after);
  for (const name of carried) {
    const r = encodeDataset(data[name], compress);
    stored[name] = r.value;
    if (r.encoded) {
      compressed.push(name);
      saved += JSON.stringify(data[name]).length - JSON.stringify(r.value).length;
    }
  }
  // the core the page carries: every chart has been checked above, so the page needs no BC.validate, and it needs the
  // decoder only for encoded data (CORE_VARIANTS in minify.js). A page composed with errors keeps the full core, which
  // shows them on the page; so does one composed from a dist/ without the variants.
  const variants = manifest.core.variants || {};
  // 'auto' compresses only when that saves more than the decoder it brings along (nothing else here needs it)
  const decoderBytes = variants.composed && variants['composed-plain'] ? variants.composed.bytes - variants['composed-plain'].bytes : 0;
  if (compress === 'auto' && compressed.length && saved <= decoderBytes && !carried.some((n) => needsDecoding(data[n]))) {
    for (const name of compressed) stored[name] = data[name];
    compressed = [];
  }
  const script = (code) => `<script>\n${code}\n</script>`;
  const lean = errors.length ? undefined : variants[Object.values(stored).some(needsDecoding) ? 'composed' : 'composed-plain'];
  const core = lean ? lean.file : manifest.core.file;
  const scripts = [read(core)].concat(blockNames.map((n) => read(manifest.blocks[n].file)));
  const bytes = scripts.reduce((n, s) => n + Buffer.byteLength(s), 0);

  // every chart is a card in the grid; a card spans `span` columns (the whole row by default)
  // under section headings a card's title is one level down
  const titleTag = entries.length > charts.length ? 'h3' : 'h2';
  const langAttr = (lang) => (lang && lang !== pageLang ? ` lang="${lang}"` : '');
  const chartTag = (spec) => `<script type="application/json" data-bc-chart>${jsonForScript(spec)}</script>`;
  const facetTag = ({ panels, facet, legend, legendId }) => {
    const swatch = (l) => `<i style="background:${escapeText(l.color)}"></i>${escapeText(l.label)}`;
    const item = (l, k) =>
      legendId
        ? `<button type="button" data-bc-legend-index="${k}" aria-pressed="true">${swatch(l)}</button>`
        : `<span>${swatch(l)}</span>`;
    const keys = legend ? `<div class="bc-facet-legend"${legendId ? ` id="${legendId}"` : ''}>${legend.map(item).join('')}</div>` : '';
    const cells = panels.map((p) => `<div class="bc-facet"><h4>${escapeText(p.label)}</h4>${chartTag(p.spec)}</div>`).join('');
    return `${keys}<div class="bc-facets" style="--bc-facet-cols:${facet.columns || Math.min(panels.length, 3)}">${cells}</div>`;
  };
  const section = ({ spec, title, note, noteHtml, span, minWidth, lang, panels, facet, legend, legendId }) => {
    const script = panels ? facetTag({ panels, facet, legend, legendId }) : chartTag(spec);
    const tag = minWidth ? `<div class="bc-scroll"><div style="min-width:${minWidth}px">${script}</div></div>` : script;
    const width = columns > 1 ? ` style="grid-column:span ${span || columns}"` : '';
    return `<section class="bc-section"${langAttr(lang)}${width}>${title ? `<${titleTag}>${escapeText(title)}</${titleTag}>` : ''}${note ? `<p>${escapeText(note)}</p>` : ''}${noteHtml ? `<p>${noteHtml}</p>` : ''}\n${tag}</section>`;
  };
  const heading = ({ section: text, note, lang }) =>
    `<div class="bc-group"${langAttr(lang)}><h2>${escapeText(text)}</h2>${note ? `<p>${escapeText(note)}</p>` : ''}</div>`;
  const header =
    options.title || options.subtitle
      ? `<header class="bc-header">${options.title ? `<h1>${escapeText(options.title)}</h1>` : ''}${options.subtitle ? `<p>${escapeText(options.subtitle)}</p>` : ''}</header>`
      : '';

  const html = [
    '<!doctype html>',
    `<html lang="${pageLang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeText(options.title || 'Charts')}</title>`,
    styleTag([options.defaultCss === false ? '' : DEFAULT_CSS, options.css ? String(options.css) : '']),
    '</head><body>',
    `<main class="bc-page${columns > 1 ? ' bc-wide' : ''}">`,
    header,
    options.before || '',
    `<div class="bc-grid"${columns > 1 ? ` style="--bc-cols:${columns}"` : ''}>`,
    entries.map((e) => (e.section === undefined ? section(e) : heading(e))).join('\n'),
    '</div></main>',
    scripts.map(script).join('\n'),
    `<script type="application/json" id="bc-data">${jsonForScript(stored)}</script>`,
    options.after || '',
    '</body></html>',
    '',
  ]
    .filter((s) => s !== '')
    .join('\n');

  return { html, blocks: blockNames, bytes, diagnostics, unusedData, compressed, core };
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
    if (r.unusedData.length) console.warn(`unused datasets, left out of the page: ${r.unusedData.join(', ')}`);
    if (r.compressed.length) console.log(`compressed datasets: ${r.compressed.join(', ')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
