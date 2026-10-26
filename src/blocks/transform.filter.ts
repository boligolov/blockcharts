(function () {
  const OPS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'notIn', 'valid'];
  const ISO = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

  function fail(message: string): never {
    throw new Error('transform.filter: ' + message);
  }

  const missing = (v: unknown) => v == null || v === '' || (typeof v === 'number' && isNaN(v)) || (v instanceof Date && isNaN(v.getTime()));

  /** What a value is compared as: a number, a date (a Date or an ISO date string, as ms), or text; null if missing. */
  function comparable(v: unknown): { kind: 'number' | 'date' | 'text'; at: number | string } | null {
    if (missing(v)) return null;
    if (typeof v === 'number') return { kind: 'number', at: v };
    if (v instanceof Date) return { kind: 'date', at: v.getTime() };
    if (typeof v === 'string' && ISO.test(v)) {
      const ms = Date.parse(v.length === 7 ? v + '-01' : v);
      if (isFinite(ms)) return { kind: 'date', at: ms };
    }
    return typeof v === 'string' ? { kind: 'text', at: v } : null;
  }

  /** A key for equality: a Date equals the same time, "2024-01-01" the Date of that day; 1 is not "1". */
  function identity(v: unknown): string {
    const c = comparable(v);
    return c ? c.kind + ':' + c.at : typeof v + ':' + String(v);
  }

  function testOf(spec: BC.TransformSpec): (v: unknown) => boolean {
    const op = spec.op === undefined ? '==' : spec.op;
    if (typeof op !== 'string' || OPS.indexOf(op) < 0) fail(`"op" must be one of: ${OPS.join(', ')}`);
    if (op === 'valid') {
      if (spec.value !== undefined) fail('"valid" keeps the rows that have a value: it takes no "value"');
      return (v) => !missing(v);
    }
    if (op === 'in' || op === 'notIn') {
      if (!Array.isArray(spec.value)) fail(`"${op}" needs "value": a list of values`);
      const set = new Set((spec.value as unknown[]).map(identity));
      return op === 'in' ? (v) => !missing(v) && set.has(identity(v)) : (v) => !missing(v) && !set.has(identity(v));
    }
    const target = spec.value;
    if (typeof target !== 'number' && typeof target !== 'string' && typeof target !== 'boolean') fail(`"${op}" needs "value": a number, a string or a date`);
    if (typeof target === 'number' && !isFinite(target)) fail('"value" must be a finite number');
    if (target === '') fail('"value" is empty: to keep the rows that have a value, use "op": "valid"');
    if (op === '==' || op === '!=') {
      const want = identity(target);
      return op === '==' ? (v) => !missing(v) && identity(v) === want : (v) => !missing(v) && identity(v) !== want;
    }
    if (typeof target === 'boolean') fail(`"${op}" compares numbers, dates or text, not true / false`);
    const t = comparable(target)!;
    const less = op === '<' ? (x: number | string) => x < t.at : op === '<=' ? (x: number | string) => x <= t.at : op === '>' ? (x: number | string) => x > t.at : (x: number | string) => x >= t.at;
    // a number compares with numbers, a date with dates, text with text; a row of another kind never passes
    return (v) => {
      const x = comparable(v);
      return x !== null && x.kind === t.kind && less(x.at);
    };
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'filter',
    version: 1,
    doc: 'Keeps the rows whose `field` passes a test and drops the others: `==`, `!=`, `<`, `<=`, `>`, `>=` against `value` (a number, a string, or a date as "2024-03-01"), `in` / `notIn` a list of values, `valid` (the field has a value). Numbers compare with numbers, dates with dates (a Date or an ISO date string), text with text; a missing value never passes. Several filters in a row all apply. Rows keep their order; columns stay as they are.',
    params: {
      field: { kind: 'field', required: true, doc: 'Field to test.' },
      op: { kind: 'enum', values: OPS, default: '==', doc: '== | != | < | <= | > | >= | in | notIn | valid.' },
      value: { kind: 'any', doc: 'What to compare with; a list for in / notIn; none for valid.' },
    },
    outputs: () => [],
    apply(table, spec) {
      if (typeof spec.field !== 'string' || !spec.field) fail('"field" must be the name of a field');
      if (!Object.prototype.hasOwnProperty.call(table.columns, spec.field)) fail(`unknown field "${spec.field}"`);
      const pass = testOf(spec);
      const col = table.columns[spec.field];
      const rows: number[] = [];
      for (let i = 0; i < table.length; i++) if (pass(col[i])) rows.push(i);
      const columns: Record<string, BC.Column> = {};
      for (const name of Object.keys(table.columns)) {
        const c = table.columns[name];
        columns[name] = ArrayBuffer.isView(c) ? Float64Array.from(rows, (i) => c[i] as number) : rows.map((i) => c[i]);
      }
      return { length: rows.length, columns };
    },
  };

  BC.define(def);
})();
