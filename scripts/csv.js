// CSV to a dataset, for the composer: `{ "csv": "a,b\n1,2" }` in a page, or `{ "csvFile": "sales.csv" }` next to page.json.
const fs = require('fs');
const path = require('path');

const MAX_CSV_BYTES = 64 * 1024 * 1024;
const DELIMITERS = [',', ';', '\t', '|'];
const DEFAULT_NULLS = ['', 'NA', 'N/A', 'null', 'NULL', 'NaN', 'nan'];
// Plain decimal numbers, optionally with an exponent. "007" and "+7" are not numbers here: they are ids and codes.
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$|^-?\.\d+$|^-?(?:0|[1-9]\d*)\.$/;

// What `types: { col: "number" }` accepts: any decimal number, also with leading zeros or a plus sign.
const LOOSE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

class CsvError extends Error {}

/** Delimiter of the first line: the candidate that occurs most outside quotes (ties: comma). */
function detectDelimiter(text) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c) + 1);
  }
  let best = ',';
  for (const d of DELIMITERS) if (counts.get(d) > counts.get(best)) best = d;
  return best;
}

/** RFC 4180 records: quoted fields may hold delimiters, quotes ("") and line breaks. Blank lines are skipped. */
function parseRecords(text, delimiter) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let started = false; // has anything been read in this record (a quoted empty string counts)
  let line = 1; // the line being read
  let recordLine = 1; // the line the current record started on, for error messages
  const begin = () => { if (!started) { started = true; recordLine = line; } };
  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => {
    endField();
    if (started || record.length > 1 || record[0] !== '') records.push({ fields: record, line: recordLine });
    record = [];
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') { begin(); quoted = true; continue; }
    if (c === delimiter) { begin(); endField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      continue;
    }
    begin();
    field += c;
  }
  if (quoted) throw new CsvError('a quoted field is never closed (a " without its partner)');
  if (started || field !== '' || record.length) endRecord();
  return records;
}

/**
 * @param {string} text
 * @param {{ delimiter?: string, nullValues?: string[], types?: Record<string, 'number'|'string'> }} [options]
 * @returns {{ columns: Record<string, unknown[]> }}
 */
function parseCsv(text, options) {
  const opts = options || {};
  if (typeof text !== 'string') throw new CsvError('the CSV must be text');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new CsvError('the CSV is empty');
  const delimiter = opts.delimiter === undefined ? detectDelimiter(text) : opts.delimiter;
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') throw new CsvError('"delimiter" must be one character, such as "," or ";"');
  const nulls = new Set(opts.nullValues === undefined ? DEFAULT_NULLS : opts.nullValues);
  const records = parseRecords(text, delimiter);
  const header = records[0].fields.map((h) => h.trim());
  header.forEach((h, i) => {
    if (!h) throw new CsvError(`column ${i + 1} has no name in the header row`);
    if (header.indexOf(h) !== i) throw new CsvError(`the column name "${h}" appears twice in the header row`);
  });
  const raw = header.map(() => []);
  for (let r = 1; r < records.length; r++) {
    const { fields, line } = records[r];
    if (fields.length > header.length && fields.slice(header.length).some((f) => f.trim() !== '')) {
      throw new CsvError(`row on line ${line} has ${fields.length} fields, the header has ${header.length}`);
    }
    for (let c = 0; c < header.length; c++) raw[c].push(c < fields.length ? fields[c] : '');
  }

  const columns = {};
  header.forEach((name, c) => {
    const forced = opts.types && opts.types[name];
    if (opts.types && forced !== undefined && forced !== 'number' && forced !== 'string') throw new CsvError(`types.${name} must be "number" or "string"`);
    const cells = raw[c].map((v) => (nulls.has(v.trim()) || nulls.has(v) ? null : v));
    const present = cells.filter((v) => v !== null);
    const allNumbers = present.length > 0 && present.every((v) => NUMBER.test(v.trim()));
    if (forced === 'number') {
      const bad = present.find((v) => !LOOSE_NUMBER.test(v.trim()));
      if (bad !== undefined) throw new CsvError(`column "${name}" is declared a number but contains "${bad}"`);
    }
    const asNumber = forced === 'number' || (forced === undefined && allNumbers);
    columns[name] = cells.map((v) => (v === null ? null : asNumber ? Number(v.trim()) : v));
  });
  return { columns };
}

/**
 * Reads a CSV file that has to sit inside `baseDir` (no absolute paths, no "..", no links pointing out of it).
 * @returns {string} its text
 */
function readCsvFile(file, baseDir) {
  if (typeof file !== 'string' || !file) throw new CsvError('"csvFile" must be a file name');
  if (!baseDir) throw new CsvError('"csvFile" needs to know the folder it is relative to (the composer option "baseDir"; the command line uses the folder of the page json)');
  if (path.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) throw new CsvError(`"csvFile" must be relative to the page json, not absolute: ${file}`);
  const root = fs.realpathSync(path.resolve(baseDir));
  const target = path.resolve(root, file);
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  if (!inside(target)) throw new CsvError(`"csvFile" must stay inside the folder of the page json: ${file}`);
  if (!/\.(csv|tsv|txt)$/i.test(target)) throw new CsvError(`"csvFile" must be a .csv, .tsv or .txt file: ${file}`);
  if (!fs.existsSync(target)) throw new CsvError(`file not found: ${file}`);
  const real = fs.realpathSync(target);
  if (!inside(real)) throw new CsvError(`"csvFile" points outside the folder of the page json: ${file}`);
  const size = fs.statSync(real).size;
  if (size > MAX_CSV_BYTES) throw new CsvError(`${file} is ${(size / 1048576).toFixed(0)} MB; the limit is ${MAX_CSV_BYTES / 1048576} MB`);
  return fs.readFileSync(real, 'utf8');
}

module.exports = { parseCsv, readCsvFile, CsvError, MAX_CSV_BYTES, DEFAULT_NULLS };
