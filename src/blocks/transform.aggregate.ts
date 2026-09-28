(function () {
  const OPS = ['count', 'sum', 'mean', 'min', 'max', 'median', 'distinct'];
  const UNITS = ['year', 'quarter', 'month', 'week', 'day', 'hour'];
  const NEEDS_FIELD = ['sum', 'mean', 'min', 'max', 'median', 'distinct'];
  const pad = (n: number, w = 2) => {
    let s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  };

  interface Key { field: string; unit?: string; as: string }
  interface Measure { op: string; field?: string; as: string }

  function fail(message: string): never {
    throw new Error('transform.aggregate: ' + message);
  }

  function keysOf(spec: BC.TransformSpec): Key[] {
    const raw = spec.groupby === undefined ? [] : spec.groupby;
    if (!Array.isArray(raw)) fail('"groupby" must be a list of field names');
    return (raw as unknown[]).map((k, i) => {
      if (typeof k === 'string') return { field: k, as: k };
      const o = k as { field?: unknown; unit?: unknown; as?: unknown };
      if (!o || typeof o !== 'object' || typeof o.field !== 'string') fail(`groupby[${i}] must be a field name or { field, unit }`);
      if (o.unit !== undefined && (typeof o.unit !== 'string' || UNITS.indexOf(o.unit) < 0)) fail(`groupby[${i}].unit must be one of: ${UNITS.join(', ')}`);
      const unit = o.unit as string | undefined;
      return { field: o.field as string, unit, as: typeof o.as === 'string' && o.as ? o.as : (o.field as string) };
    });
  }

  function measuresOf(spec: BC.TransformSpec): Measure[] {
    const raw = spec.measures === undefined ? [{ op: 'count' }] : spec.measures;
    if (!Array.isArray(raw) || !raw.length) fail('"measures" must be a non-empty list like [{ "op": "sum", "field": "revenue" }]');
    return (raw as unknown[]).map((m, i) => {
      const o = m as { op?: unknown; field?: unknown; as?: unknown };
      if (!o || typeof o !== 'object' || typeof o.op !== 'string' || OPS.indexOf(o.op) < 0) fail(`measures[${i}].op must be one of: ${OPS.join(', ')}`);
      const op = o.op as string;
      if (NEEDS_FIELD.indexOf(op) >= 0 && typeof o.field !== 'string') fail(`measures[${i}]: "${op}" needs a "field"`);
      if (o.field !== undefined && typeof o.field !== 'string') fail(`measures[${i}].field must be a field name`);
      const field = o.field as string | undefined;
      return { op, field, as: typeof o.as === 'string' && o.as ? o.as : field ? `${op}_${field}` : op };
    });
  }

  function namesOf(spec: BC.TransformSpec): string[] {
    const names = [...keysOf(spec).map((k) => k.as), ...measuresOf(spec).map((m) => m.as)];
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup !== undefined) fail(`two output columns are called "${dup}"; give one of them another "as"`);
    return names;
  }

  /** The start of the calendar unit (UTC) a time falls in, as an ISO string; null when it is not a time. */
  function bucket(v: unknown, unit: string): string | null {
    const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v && typeof (v as Date).getTime === 'function' ? (v as Date).getTime() : NaN;
    if (!isFinite(ms)) return null;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    switch (unit) {
      case 'year': return `${pad(y, 4)}-01-01`;
      case 'quarter': return `${pad(y, 4)}-${pad(Math.floor(m / 3) * 3 + 1)}-01`;
      case 'month': return `${pad(y, 4)}-${pad(m + 1)}-01`;
      case 'week': {
        // weeks start on Monday
        const back = (d.getUTCDay() + 6) % 7;
        const s = new Date(Date.UTC(y, m, d.getUTCDate() - back));
        return `${pad(s.getUTCFullYear(), 4)}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
      }
      case 'day': return `${pad(y, 4)}-${pad(m + 1)}-${pad(d.getUTCDate())}`;
      default: return `${pad(y, 4)}-${pad(m + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00:00Z`;
    }
  }

  const isNumber = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

  function measure(op: string, rows: number[], col: BC.Column | undefined): number {
    if (op === 'count') {
      if (!col) return rows.length;
      let n = 0;
      for (const i of rows) if (col[i] != null && !(typeof col[i] === 'number' && isNaN(col[i] as number))) n++;
      return n;
    }
    const c = col as BC.Column;
    if (op === 'distinct') {
      const seen = new Set<unknown>();
      for (const i of rows) if (c[i] != null && !(typeof c[i] === 'number' && isNaN(c[i] as number))) seen.add(c[i]);
      return seen.size;
    }
    const values: number[] = [];
    for (const i of rows) if (isNumber(c[i])) values.push(c[i] as number);
    if (!values.length) return NaN;
    switch (op) {
      case 'sum': return values.reduce((a, b) => a + b, 0);
      case 'mean': return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min': return values.reduce((a, b) => (b < a ? b : a));
      case 'max': return values.reduce((a, b) => (b > a ? b : a));
      default: {
        values.sort((a, b) => a - b);
        const mid = values.length >> 1;
        return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
      }
    }
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'aggregate',
    version: 1,
    replacesColumns: true,
    doc: 'Group-by: one row per distinct combination of the `groupby` fields, with measures computed over the rows of each group (`sum`, `mean`, `min`, `max`, `median`, `count`, `distinct`). A group-by field can be cut into calendar units, `{ "field": "date", "unit": "month" }` (year, quarter, month, week from Monday, day, hour; UTC; the group value is the ISO start of the unit). Missing values are ignored by the measures (`count` without a field counts rows). Groups come in order of first appearance, or sorted by a column with `sort`; a time unit sorts by time unless told otherwise. `limit` keeps the first N groups after sorting (top N).',
    params: {
      groupby: { kind: 'list', doc: 'Fields to group by: names, or { "field", "unit", "as" }. Empty or missing: one group of all rows.' },
      measures: { kind: 'list', default: [{ op: 'count' }], doc: 'What to compute per group: [{ "op": "sum", "field": "revenue", "as": "total" }]. `as` defaults to "<op>_<field>" ("count" for a plain count).' },
      sort: { kind: 'string', doc: 'Output column (a group-by field or a measure `as`) to sort the groups by.' },
      order: { kind: 'enum', values: ['asc', 'desc'], default: 'asc', doc: 'Direction of `sort`.' },
      limit: { kind: 'number', doc: 'Keep only the first N groups (after sorting).' },
    },
    outputs: (spec) => namesOf(spec),
    apply(table, spec) {
      const keys = keysOf(spec);
      const measures = measuresOf(spec);
      const names = namesOf(spec);
      for (const k of keys) if (!table.columns[k.field]) fail(`unknown field "${k.field}"`);
      for (const m of measures) if (m.field && !table.columns[m.field]) fail(`unknown field "${m.field}"`);
      if (spec.sort !== undefined && (typeof spec.sort !== 'string' || names.indexOf(spec.sort) < 0)) fail(`"sort" must be one of the output columns: ${names.join(', ')}`);
      if (spec.limit !== undefined && !(typeof spec.limit === 'number' && spec.limit >= 0 && isFinite(spec.limit))) fail('"limit" must be a number of at least 0');

      // group rows; the key is the list of group values with their types, so 1 and "1" are different groups
      const groups = new Map<string, { values: unknown[]; rows: number[] }>();
      const cols = keys.map((k) => table.columns[k.field]);
      for (let i = 0; i < table.length; i++) {
        const values: unknown[] = [];
        let skip = false;
        for (let k = 0; k < keys.length; k++) {
          let v: unknown = cols[k][i];
          if (keys[k].unit) {
            v = bucket(v, keys[k].unit as string);
            if (v === null) {
              skip = true;
              break;
            }
          } else if (typeof v === 'number' && isNaN(v)) {
            v = null;
          }
          values.push(v);
        }
        if (skip) continue;
        const id = values.map((v) => typeof v + ':' + String(v)).join('␟');
        const g = groups.get(id);
        if (g) g.rows.push(i);
        else groups.set(id, { values, rows: [i] });
      }
      if (!keys.length && !groups.size) groups.set('', { values: [], rows: [] });

      let list = Array.from(groups.values());
      const results = list.map((g) => measures.map((m) => measure(m.op, g.rows, m.field ? table.columns[m.field] : undefined)));
      let order = list.map((_, i) => i);

      const sortName = typeof spec.sort === 'string' ? spec.sort : keys.some((k) => k.unit) ? keys.find((k) => k.unit)!.as : undefined;
      if (sortName !== undefined) {
        const keyAt = names.indexOf(sortName);
        const value = (i: number): unknown => (keyAt < keys.length ? list[i].values[keyAt] : results[i][keyAt - keys.length]);
        const dir = spec.order === 'desc' ? -1 : 1;
        order.sort((a, b) => {
          const x = value(a);
          const y = value(b);
          // missing values go last whichever way it sorts
          const xm = x == null || (typeof x === 'number' && isNaN(x));
          const ym = y == null || (typeof y === 'number' && isNaN(y));
          if (xm || ym) return xm === ym ? a - b : xm ? 1 : -1;
          return ((x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0) * dir || a - b;
        });
      }
      if (typeof spec.limit === 'number') order = order.slice(0, Math.floor(spec.limit));
      list = order.map((i) => list[i]);
      const out = order.map((i) => results[i]);

      const columns: Record<string, BC.Column> = {};
      keys.forEach((k, at) => {
        const values = list.map((g) => g.values[at]);
        columns[k.as] = values.every((v) => v === null || typeof v === 'number') ? Float64Array.from(values.map((v) => (v === null ? NaN : (v as number)))) : values;
      });
      measures.forEach((m, at) => {
        columns[m.as] = Float64Array.from(out.map((r) => r[at]));
      });
      return { length: list.length, columns };
    },
  };

  BC.define(def);
})();
