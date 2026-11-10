(function () {
  const OPS = ['cumsum', 'sum', 'mean', 'min', 'max', 'diff', 'pctChange', 'total', 'share', 'rank'];
  const WINDOWED = ['sum', 'mean', 'min', 'max'];

  function fail(message: string): never {
    throw new Error('transform.window: ' + message);
  }

  function opOf(spec: BC.TransformSpec): string {
    if (typeof spec.op !== 'string' || OPS.indexOf(spec.op) < 0) fail(`"op" must be one of: ${OPS.join(', ')}`);
    return spec.op;
  }

  function nameOf(spec: BC.TransformSpec): string {
    if (typeof spec.field !== 'string' || !spec.field) fail('"field" must be the name of a numeric field');
    if (spec.as !== undefined && (typeof spec.as !== 'string' || !spec.as)) fail('"as" must be a column name');
    return typeof spec.as === 'string' ? spec.as : `${opOf(spec)}_${spec.field}`;
  }

  const isNumber = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
  const missing = (v: unknown) => v == null || (typeof v === 'number' && isNaN(v));

  /** A sort value that compares: numbers and dates as numbers, strings as strings (ISO dates sort right), null if missing. */
  function sortKey(v: unknown): number | string | null {
    if (missing(v)) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (v && typeof (v as Date).getTime === 'function') {
      const ms = (v as Date).getTime();
      return isFinite(ms) ? ms : null;
    }
    return String(v);
  }

  /** One value per position of `vals` from the window of positions [lo(k), hi(k)], both ends only ever moving right:
   *  a running sum and count for sum / mean, monotone deques for min / max, so the whole series costs O(n). */
  function slide(vals: number[], op: string, lo: (k: number) => number, hi: (k: number) => number): number[] {
    const n = vals.length;
    const out = new Array<number>(n);
    let sum = 0;
    let count = 0;
    const dq: number[] = []; // positions whose values are monotone: increasing for min, decreasing for max
    let head = 0;
    let added = 0; // positions [0, added) have entered the window
    let removed = 0; // positions [0, removed) have left it
    const better = op === 'min' ? (a: number, b: number) => a <= b : (a: number, b: number) => a >= b;
    for (let k = 0; k < n; k++) {
      const a = lo(k);
      const b = hi(k);
      for (; added <= b; added++) {
        const v = vals[added];
        if (!isFinite(v)) continue;
        sum += v;
        count++;
        while (dq.length > head && better(v, vals[dq[dq.length - 1]])) dq.pop();
        dq.push(added);
      }
      for (; removed < a; removed++) {
        const v = vals[removed];
        if (!isFinite(v)) continue;
        sum -= v;
        count--;
        if (dq.length > head && dq[head] === removed) head++;
      }
      if (!count) out[k] = NaN;
      else if (op === 'sum') out[k] = sum;
      else if (op === 'mean') out[k] = sum / count;
      else out[k] = vals[dq[head]];
    }
    return out;
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'window',
    version: 5,
    doc: 'A value per row computed from the rows before it (and around it) in the same series: `cumsum` a running total; `sum`, `mean`, `min`, `max` over a moving window of `size` rows (a 7-day moving average is `mean` with size 7 on daily rows); `diff` and `pctChange` the change from the previous row (pctChange is a fraction: 0.1 = +10%); `total` the sum of the whole group on every row of it (a line of totals over stacked bars) and `share` each row as a part of that sum (0.25 = 25%), so rows are not collapsed as by aggregate; `rank` the place of each row in its group by `field`, 1 for the largest (`order` "asc": for the smallest), ties sharing a place (1, 2, 2, 4): rank by year with group = the year, and a line per item over the years is a bump chart. Rows are taken in the order of `sort` (a date or number field; data order without it), separately for every value of `group`. Adds one column (`as`, default "<op>_<field>") and keeps every row in place. Missing values are skipped by the running total and the window and get NaN themselves; a window that does not have `size` rows yet (the start of a series) is NaN unless `partial` is true.',
    params: {
      field: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field to compute from.' },
      op: {
        kind: 'enum',
        values: OPS,
        required: true,
        doc: 'cumsum | sum | mean | min | max | diff | pctChange | total | share | rank. total, share and rank look at the whole group, so they need no sort; a row with no value still gets the total, and no rank.',
      },
      order: {
        kind: 'enum',
        values: ['desc', 'asc'],
        default: 'desc',
        doc: 'For rank: "desc" gives place 1 to the largest value (sales), "asc" to the smallest (a time, a cost).',
      },
      size: { kind: 'number', doc: 'Rows in the window of sum, mean, min, max (required for them).' },
      align: {
        kind: 'enum',
        values: ['trailing', 'center'],
        default: 'trailing',
        doc: '"trailing": the row and the size - 1 rows before it. "center": the row in the middle of its window.',
      },
      partial: {
        kind: 'boolean',
        default: false,
        doc: 'Compute windows cut short by the start or end of a series from the rows they have.',
      },
      sort: { kind: 'field', doc: 'Field that orders the rows (the x of the chart). Rows without it get NaN.' },
      group: {
        kind: 'field',
        doc: 'Field that splits the rows into series, each computed on its own; a missing value is a series of its own.',
      },
      as: { kind: 'string', doc: 'Name of the new column.' },
    },
    outputs: (spec) => [nameOf(spec)],
    apply(table, spec) {
      const op = opOf(spec);
      const as = nameOf(spec);
      const values = Object.prototype.hasOwnProperty.call(table.columns, spec.field as string)
        ? table.columns[spec.field as string]
        : undefined;
      if (!values) fail(`unknown field "${spec.field}" in "field"`);
      const sortCol =
        typeof spec.sort === 'string'
          ? Object.prototype.hasOwnProperty.call(table.columns, spec.sort)
            ? table.columns[spec.sort]
            : undefined
          : undefined;
      if (spec.sort !== undefined && !sortCol) fail(`unknown field "${spec.sort}" in "sort"`);
      const groupCol =
        typeof spec.group === 'string'
          ? Object.prototype.hasOwnProperty.call(table.columns, spec.group)
            ? table.columns[spec.group]
            : undefined
          : undefined;
      if (spec.group !== undefined && !groupCol) fail(`unknown field "${spec.group}" in "group"`);
      // a column of the data written over changes what every other mark reads from it
      if (Object.prototype.hasOwnProperty.call(table.columns, as))
        fail(`"${as}" is already a column of the data: give the new one another name with "as"`);
      const windowed = WINDOWED.indexOf(op) >= 0;
      if (windowed) {
        if (!(typeof spec.size === 'number' && spec.size >= 1 && Math.floor(spec.size) === spec.size))
          fail(`"${op}" needs "size": a whole number of rows, at least 1`);
      } else if (spec.size !== undefined) {
        fail(`"size" applies to sum, mean, min and max, not to "${op}"`);
      }
      if (spec.align !== undefined && spec.align !== 'trailing' && spec.align !== 'center') fail('"align" must be "trailing" or "center"');
      if (spec.order !== undefined) {
        if (op !== 'rank') fail(`"order" applies to rank, not to "${op}"`);
        if (spec.order !== 'asc' && spec.order !== 'desc') fail('"order" must be "desc" (1 = the largest) or "asc" (1 = the smallest)');
      }
      const size = windowed ? (spec.size as number) : 1;
      const partial = spec.partial === true;
      const before = spec.align === 'center' ? Math.floor(size / 2) : size - 1;
      const after = size - 1 - before;

      const n = table.length;
      const out = new Float64Array(n).fill(NaN);
      // series in first-appearance order; NaN and null are one missing group, kept apart from the rest
      const series = new Map<unknown, number[]>();
      const keys = sortCol ? new Array<number | string | null>(n) : null;
      for (let i = 0; i < n; i++) {
        if (keys) {
          keys[i] = sortKey(sortCol![i]);
          if (keys[i] === null) continue;
        }
        const g = groupCol ? (missing(groupCol[i]) ? null : groupCol[i]) : 0;
        const rows = series.get(g);
        if (rows) rows.push(i);
        else series.set(g, [i]);
      }

      series.forEach((rows) => {
        if (keys) {
          rows.sort((a, b) => {
            const x = keys[a] as number | string;
            const y = keys[b] as number | string;
            // numbers before strings when a field mixes them; ties keep data order
            if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
            return x < y ? -1 : x > y ? 1 : a - b;
          });
        }
        const vals = rows.map((i) => (isNumber(values[i]) ? (values[i] as number) : NaN));
        const m = rows.length;
        if (op === 'rank') {
          const ks: number[] = [];
          for (let k = 0; k < m; k++) if (isFinite(vals[k])) ks.push(k);
          const sign = spec.order === 'asc' ? 1 : -1;
          ks.sort((a, b) => sign * (vals[a] - vals[b]) || a - b);
          // competition ranking: a tie shares the better place and the next place is skipped
          for (let j = 0; j < ks.length; j++) {
            const same = j > 0 && vals[ks[j]] === vals[ks[j - 1]];
            out[rows[ks[j]]] = same ? out[rows[ks[j - 1]]] : j + 1;
          }
        } else if (op === 'total' || op === 'share') {
          let sum = 0;
          let any = false;
          for (let k = 0; k < m; k++) {
            if (!isFinite(vals[k])) continue;
            sum += vals[k];
            any = true;
          }
          for (let k = 0; k < m; k++) {
            if (op === 'total') out[rows[k]] = any ? sum : NaN;
            // a share of nothing, or of a sum of zero, is no share
            else if (isFinite(vals[k]) && sum !== 0) out[rows[k]] = vals[k] / sum;
          }
        } else if (op === 'cumsum') {
          let total = 0;
          for (let k = 0; k < m; k++) {
            if (!isFinite(vals[k])) continue;
            total += vals[k];
            out[rows[k]] = total;
          }
        } else if (op === 'diff' || op === 'pctChange') {
          for (let k = 1; k < m; k++) {
            const prev = vals[k - 1];
            const d = vals[k] - prev;
            out[rows[k]] = op === 'diff' ? d : prev ? d / Math.abs(prev) : NaN;
          }
        } else {
          const res = slide(
            vals,
            op,
            (k) => Math.max(0, k - before),
            (k) => Math.min(m - 1, k + after),
          );
          for (let k = 0; k < m; k++) {
            if (!isFinite(vals[k])) continue;
            if (!partial && (k - before < 0 || k + after > m - 1)) continue;
            out[rows[k]] = res[k];
          }
        }
      });

      return { length: n, columns: { ...table.columns, [as]: out } };
    },
  };

  BC.define(def);
})();
