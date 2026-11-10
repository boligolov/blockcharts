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
  const begin = () => {
    if (!started) {
      started = true;
      recordLine = line;
    }
  };
  const endField = () => {
    record.push(field);
    field = '';
  };
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
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') {
      begin();
      quoted = true;
      continue;
    }
    if (c === delimiter) {
      begin();
      endField();
      continue;
    }
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
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r')
    throw new CsvError('"delimiter" must be one character, such as "," or ";"');
  if (opts.nullValues !== undefined && (!Array.isArray(opts.nullValues) || opts.nullValues.some((v) => typeof v !== 'string')))
    throw new CsvError('"nullValues" must be a list of texts, like ["n/a", "-"]');
  if (opts.types !== undefined && (!opts.types || typeof opts.types !== 'object' || Array.isArray(opts.types)))
    throw new CsvError('"types" must be an object like { "zip": "string" }');
  const nulls = new Set(opts.nullValues === undefined ? DEFAULT_NULLS : opts.nullValues);
  const records = parseRecords(text, delimiter);
  const header = records[0].fields.map((h) => h.trim());
  header.forEach((h, i) => {
    if (!h) throw new CsvError(`column ${i + 1} has no name in the header row`);
    if (header.indexOf(h) !== i) throw new CsvError(`the column name "${h}" appears twice in the header row`);
  });
  for (const name of Object.keys(opts.types || {}))
    if (!header.includes(name))
      throw new CsvError(`"types" names "${name}", which is not a column; the header has ${header.map((h) => `"${h}"`).join(', ')}`);
  const raw = header.map(() => []);
  for (let r = 1; r < records.length; r++) {
    const { fields, line } = records[r];
    if (fields.length > header.length && fields.slice(header.length).some((f) => f.trim() !== '')) {
      throw new CsvError(`row on line ${line} has ${fields.length} fields, the header has ${header.length}`);
    }
    for (let c = 0; c < header.length; c++) raw[c].push(c < fields.length ? fields[c] : '');
  }

  const columns = {};
  const warnings = [];
  header.forEach((name, c) => {
    if (name === '__proto__') throw new CsvError('a column cannot be named "__proto__"; rename it in the header');
    const forced = opts.types && Object.prototype.hasOwnProperty.call(opts.types, name) ? opts.types[name] : undefined;
    if (opts.types && forced !== undefined && forced !== 'number' && forced !== 'string')
      throw new CsvError(`types.${name} must be "number" or "string"`);
    const cells = raw[c].map((v) => (nulls.has(v.trim()) || nulls.has(v) ? null : v));
    const present = cells.filter((v) => v !== null);
    // "1e400" is written like a number and is Infinity, which JSON turns into null: not a number here
    const isNumber = (v) => NUMBER.test(v.trim()) && isFinite(Number(v.trim()));
    const allNumbers = present.length > 0 && present.every(isNumber);
    if (forced === 'number') {
      const bad = present.find((v) => !LOOSE_NUMBER.test(v.trim()) || !isFinite(Number(v.trim())));
      if (bad !== undefined) throw new CsvError(`column "${name}" is declared a number but contains "${bad}"`);
    }
    // a whole number past 2^53 is not kept exactly: ids of 19 digits would turn into one another
    const inexact =
      forced === undefined && allNumbers
        ? present.find((v) => /^-?\d+$/.test(v.trim()) && !Number.isSafeInteger(Number(v.trim())))
        : undefined;
    if (inexact !== undefined)
      warnings.push({
        column: name,
        message:
          `column "${name}" is read as text: ${inexact.trim()} is a whole number too large to keep exactly (above 9007199254740991), ` +
          `and as numbers such values would turn into one another. Ids are text; if the column is an amount, "types": { "${name}": "number" } reads it as numbers, rounded`,
      });
    const asNumber = forced === 'number' || (forced === undefined && allNumbers && inexact === undefined);
    columns[name] = cells.map((v) => (v === null ? null : asNumber ? Number(v.trim()) : v));
    // a column of numbers but for a few cells ("n/a", "$1,750", "1,5") is text, and a chart of it draws nothing: say which
    if (forced === undefined && !allNumbers) {
      const odd = present.filter((v) => !isNumber(v));
      if (odd.length * 2 < present.length) {
        const shown = Array.from(new Set(odd.map((v) => v.trim())))
          .slice(0, 3)
          .map((v) => JSON.stringify(v.length > 24 ? v.slice(0, 24) + '…' : v));
        warnings.push({
          column: name,
          message:
            `column "${name}" is read as text, because ${odd.length} of its ${present.length} values ${odd.length === 1 ? 'is not a plain number' : 'are not plain numbers'}: ${shown.join(', ')}. ` +
            `A value that means "no value" goes in "nullValues"; a number is written without a currency sign or thousands separators, with a dot for decimals; ` +
            `if the column is text, "types": { "${name}": "string" } says so`,
        });
      }
    }
  });
  return { columns, warnings };
}

/** Is `p` the folder `root` or inside it? By path.relative, so a root that ends in a separator (C:\ or /) works too. */
function within(root, p) {
  const rel = path.relative(root, p); // "" for the folder itself; absolute for another drive
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * The text of a CSV file: UTF-8, with or without a byte order mark, or UTF-16 with one. Anything else is an error that
 * says how to save the file, where it used to be text with "�" in place of every accent.
 */
function decodeCsv(bytes, file) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2, bytes.length - (bytes.length % 2)).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2)))
      .swap16()
      .toString('utf16le');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    throw new CsvError(`${file} is an Excel workbook (or another zip file), not a CSV: in Excel, save it as "CSV UTF-8 (Comma delimited)"`);
  if (bytes.subarray(0, 4096).includes(0))
    throw new CsvError(`${file} looks like UTF-16 without a byte order mark: save it as "CSV UTF-8", or as UTF-8 in your editor`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    // the line of the first byte that is not UTF-8, as Windows-1252 would show it (what Excel's plain "CSV" is)
    const loose = bytes.toString('utf8');
    const line = loose.slice(0, Math.max(0, loose.indexOf('\ufffd'))).split('\n').length;
    let legacy;
    try {
      legacy = new TextDecoder('windows-1252').decode(bytes);
    } catch (e2) {
      legacy = bytes.toString('latin1'); // a Node without its full ICU knows only Latin-1
    }
    const shown = legacy.split('\n')[line - 1].replace(/\r$/, '').slice(0, 60);
    throw new CsvError(
      `${file} is not UTF-8 (line ${line}: ${JSON.stringify(shown)}): it was saved in an older encoding, such as Windows-1252, which Excel writes for "CSV (Comma delimited)". ` +
        'Save it as "CSV UTF-8 (Comma delimited)", or convert it to UTF-8',
    );
  }
}

/**
 * Reads a CSV file that has to sit inside `baseDir` (no absolute paths, no "..", no links pointing out of it).
 * @returns {string} its text
 */
function readCsvFile(file, baseDir) {
  if (typeof file !== 'string' || !file) throw new CsvError('"csvFile" must be a file name');
  if (!baseDir)
    throw new CsvError(
      '"csvFile" needs to know the folder it is relative to (the composer option "baseDir"; the command line uses the folder of the page json)',
    );
  if (path.isAbsolute(file) || /^[a-zA-Z]:/.test(file))
    throw new CsvError(`"csvFile" must be relative to the page json, not absolute: ${file}`);
  const root = fs.realpathSync(path.resolve(baseDir));
  const target = path.resolve(root, file);
  const inside = (p) => within(root, p);
  if (!inside(target)) throw new CsvError(`"csvFile" must stay inside the folder of the page json: ${file}`);
  if (!/\.(csv|tsv|txt)$/i.test(target)) throw new CsvError(`"csvFile" must be a .csv, .tsv or .txt file: ${file}`);
  if (!fs.existsSync(target)) throw new CsvError(`file not found: ${file}`);
  const real = fs.realpathSync(target);
  if (!inside(real)) throw new CsvError(`"csvFile" points outside the folder of the page json: ${file}`);
  const size = fs.statSync(real).size;
  if (size > MAX_CSV_BYTES) throw new CsvError(`${file} is ${(size / 1048576).toFixed(0)} MB; the limit is ${MAX_CSV_BYTES / 1048576} MB`);
  return decodeCsv(fs.readFileSync(real), file);
}

module.exports = { parseCsv, readCsvFile, decodeCsv, within, CsvError, MAX_CSV_BYTES, DEFAULT_NULLS };
