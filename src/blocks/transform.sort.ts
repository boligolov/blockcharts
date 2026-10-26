(function () {
  function fail(message: string): never {
    throw new Error('transform.sort: ' + message);
  }

  const missing = (v: unknown) => v == null || (typeof v === 'number' && isNaN(v));

  /** A sort value: numbers and dates as numbers, strings as strings (ISO dates sort right), null if missing. */
  function sortKey(v: unknown): number | string | null {
    if (missing(v)) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (v && typeof (v as Date).getTime === 'function') {
      const ms = (v as Date).getTime();
      return isFinite(ms) ? ms : null;
    }
    return String(v);
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'sort',
    version: 1,
    doc: 'Puts the rows in the order of `field` (`order` "asc" or "desc"), and with `limit` keeps only the first N: the top 10 products is `field` revenue, `order` "desc", `limit` 10. With `group` the order and the limit apply within each group (the top 3 per region), and the groups follow each other in order of first appearance. A band scale lists its categories in row order, so this also orders the bars. Missing values go last either way; numbers come before text when a field mixes them; ties keep data order. Columns stay as they are.',
    params: {
      field: { kind: 'field', required: true, doc: 'Field to sort by.' },
      order: { kind: 'enum', values: ['asc', 'desc'], default: 'asc', doc: 'Direction.' },
      limit: { kind: 'number', doc: 'Keep only the first N rows (of each group with `group`).' },
      group: { kind: 'field', doc: 'Field that splits the rows: each group sorted and limited on its own.' },
    },
    outputs: () => [],
    apply(table, spec) {
      if (typeof spec.field !== 'string' || !spec.field) fail('"field" must be the name of a field');
      const has = (f: string) => Object.prototype.hasOwnProperty.call(table.columns, f);
      if (!has(spec.field)) fail(`unknown field "${spec.field}"`);
      if (spec.group !== undefined && (typeof spec.group !== 'string' || !has(spec.group))) fail(`unknown field "${spec.group}"`);
      if (spec.order !== undefined && spec.order !== 'asc' && spec.order !== 'desc') fail('"order" must be "asc" or "desc"');
      if (spec.limit !== undefined && !(typeof spec.limit === 'number' && spec.limit >= 0 && Math.floor(spec.limit) === spec.limit)) fail('"limit" must be a whole number of rows, at least 0');
      const dir = spec.order === 'desc' ? -1 : 1;
      const col = table.columns[spec.field];
      const groupCol = typeof spec.group === 'string' ? table.columns[spec.group] : undefined;
      const keys = Array.from({ length: table.length }, (_, i) => sortKey(col[i]));

      // groups in first-appearance order; NaN and null are one missing group
      const groups = new Map<unknown, number[]>();
      for (let i = 0; i < table.length; i++) {
        const g = groupCol ? (missing(groupCol[i]) ? null : groupCol[i]) : 0;
        const rows = groups.get(g);
        if (rows) rows.push(i);
        else groups.set(g, [i]);
      }
      const rows: number[] = [];
      groups.forEach((list) => {
        list.sort((a, b) => {
          const x = keys[a];
          const y = keys[b];
          // missing last whichever way; numbers before strings when a field mixes them; ties keep data order
          if (x === null || y === null) return x === y ? a - b : x === null ? 1 : -1;
          if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
          return (x < y ? -1 : x > y ? 1 : 0) * dir || a - b;
        });
        const kept = typeof spec.limit === 'number' ? list.slice(0, spec.limit) : list;
        for (const i of kept) rows.push(i);
      });

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
