// For data pipelines: turns columns into a blockcharts dataset whose numeric columns are stored as raw little-endian
// values (base64, gzipped by default), which is far smaller than JSON text for long series.
//   encodeColumns({ t: [..], v: [..], name: [..] }, { dtypes?: { v: 'float32' }, gzip? }) -> { columns: { t: {dtype, encoding, data}, name: [..] } }
// dtypes per column: 'auto' (default: the smallest integer type that holds every value, else float64: never lossy),
// or one of float32 (halves the size, keeps ~7 digits), float64, int8/16/32, uint8/16/32. Non-numeric columns stay as they are.
// A missing value (null) needs a float type: it is stored as NaN.
const zlib = require('zlib');

const SIZES = { float32: 4, float64: 8, int8: 1, int16: 2, int32: 4, uint8: 1, uint16: 2, uint32: 4 };
const RANGES = { int8: [-128, 127], int16: [-32768, 32767], int32: [-2147483648, 2147483647], uint8: [0, 255], uint16: [0, 65535], uint32: [0, 4294967295] };
const WRITERS = { float32: 'writeFloatLE', float64: 'writeDoubleLE', int8: 'writeInt8', int16: 'writeInt16LE', int32: 'writeInt32LE', uint8: 'writeUInt8', uint16: 'writeUInt16LE', uint32: 'writeUInt32LE' };
const AUTO_ORDER = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32'];

const isNumeric = (values) => values.length > 0 && values.every((v) => v === null || v === undefined || typeof v === 'number');

function autoDtype(values) {
  let ints = true;
  for (const v of values) {
    if (v === null || v === undefined || !Number.isInteger(v)) { ints = false; break; }
  }
  if (!ints) return 'float64';
  for (const t of AUTO_ORDER) if (values.every((v) => v >= RANGES[t][0] && v <= RANGES[t][1])) return t;
  return 'float64';
}

function encodeColumns(columns, options) {
  const o = options || {};
  const dtypes = o.dtypes || {};
  const gzip = o.gzip === undefined ? true : o.gzip;
  if (!columns || typeof columns !== 'object' || Array.isArray(columns)) throw new Error('encodeColumns: columns must be an object of name to array');
  const names = Object.keys(columns);
  for (const k of Object.keys(dtypes)) if (!(k in columns)) throw new Error(`encodeColumns: dtypes names an unknown column "${k}"`);
  const length = names.length ? columns[names[0]].length : 0;
  const out = {};
  for (const k of names) {
    const values = Array.from(columns[k]);
    if (values.length !== length) throw new Error(`encodeColumns: column "${k}" has ${values.length} values, expected ${length}`);
    if (!isNumeric(values)) {
      if (dtypes[k] && dtypes[k] !== 'auto') throw new Error(`encodeColumns: column "${k}" is not numeric, cannot store it as ${dtypes[k]}`);
      out[k] = values;
      continue;
    }
    let dtype = dtypes[k] === undefined || dtypes[k] === 'auto' ? autoDtype(values) : dtypes[k];
    if (!SIZES[dtype]) throw new Error(`encodeColumns: column "${k}": unknown dtype "${dtype}" (use ${Object.keys(SIZES).join(', ')} or auto)`);
    const range = RANGES[dtype];
    values.forEach((v, i) => {
      if (v === null || v === undefined) {
        if (range) throw new Error(`encodeColumns: column "${k}" has a missing value at ${i}, which ${dtype} cannot hold; use float32 or float64`);
      } else if (range && (!Number.isInteger(v) || v < range[0] || v > range[1])) {
        throw new Error(`encodeColumns: column "${k}": ${v} at ${i} does not fit ${dtype}`);
      }
    });
    if (dtype === 'float32') {
      const i = values.findIndex((v) => typeof v === 'number' && Number.isFinite(v) && !Number.isFinite(Math.fround(v)));
      if (i >= 0) throw new Error(`encodeColumns: column "${k}": ${values[i]} at ${i} is too large for float32`);
    }
    const size = SIZES[dtype];
    const buf = Buffer.alloc(values.length * size);
    values.forEach((v, i) => buf[WRITERS[dtype]](v === null || v === undefined ? NaN : v, i * size));
    out[k] = { dtype, encoding: gzip ? 'gzip+base64' : 'base64', data: (gzip ? zlib.gzipSync(buf, { level: 9 }) : buf).toString('base64') };
  }
  return { columns: out };
}

module.exports = { encodeColumns };
