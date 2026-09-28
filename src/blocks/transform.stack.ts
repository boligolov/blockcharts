(function () {
  function outputNames(spec: BC.TransformSpec): [string, string] {
    const field = typeof spec.field === 'string' ? spec.field : 'value';
    const as = spec.as;
    if (as === undefined) return [field + '0', field + '1'];
    if (Array.isArray(as) && as.length === 2 && typeof as[0] === 'string' && typeof as[1] === 'string' && as[0] !== as[1]) return [as[0], as[1]];
    throw new Error('transform.stack: "as" must be two different column names, e.g. ["y0", "y1"]');
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'stack',
    version: 1,
    doc: 'Stacks the values of `field` on top of each other within every value of `by` (the category axis). Adds two columns, the start and the end of each row\'s segment (`as`, default `<field>0` and `<field>1`). Series are stacked in order of first appearance of `group`; negatives stack downward from 0 separately from positives; missing values contribute nothing and get NaN. Use the columns as y2 and y of a rect or area.',
    params: {
      field: { kind: 'field', required: true, doc: 'Numeric field to stack.' },
      by: { kind: 'field', required: true, doc: 'Field whose values are the stacks (the x of a stacked bar).' },
      group: { kind: 'field', doc: 'Field that tells the series apart. Without it rows stack in data order.' },
      as: { kind: 'list', doc: 'Names of the two new columns: [start, end].' },
      normalize: { kind: 'boolean', default: false, doc: 'Scale every stack to 0..1 (100% stacked).' },
    },
    outputs: (spec) => outputNames(spec),
    apply(table, spec) {
      const field = spec.field as string;
      const by = spec.by as string;
      const values = table.columns[field];
      const keys = table.columns[by];
      if (!values) throw new Error(`transform.stack: unknown field "${field}"`);
      if (!keys) throw new Error(`transform.stack: unknown field "${by}"`);
      const groups = typeof spec.group === 'string' ? table.columns[spec.group] : undefined;
      if (typeof spec.group === 'string' && !groups) throw new Error(`transform.stack: unknown field "${spec.group}"`);
      const [as0, as1] = outputNames(spec);
      const n = table.length;

      // series order = first appearance in the data, the same for every stack
      const rank = new Map<unknown, number>();
      if (groups) {
        for (let i = 0; i < n; i++) if (!rank.has(groups[i])) rank.set(groups[i], rank.size);
      }
      const stacks = new Map<unknown, number[]>();
      for (let i = 0; i < n; i++) {
        const stack = stacks.get(keys[i]);
        if (stack) stack.push(i);
        else stacks.set(keys[i], [i]);
      }

      const start = new Float64Array(n);
      const end = new Float64Array(n);
      stacks.forEach((rows) => {
        if (groups) rows.sort((a, b) => (rank.get(groups[a]) as number) - (rank.get(groups[b]) as number) || a - b);
        let up = 0;
        let down = 0;
        for (const i of rows) {
          const v = values[i];
          if (typeof v !== 'number' || !isFinite(v)) {
            start[i] = NaN;
            end[i] = NaN;
          } else if (v >= 0) {
            start[i] = up;
            up += v;
            end[i] = up;
          } else {
            start[i] = down;
            down += v;
            end[i] = down;
          }
        }
        if (spec.normalize === true) {
          const total = up - down;
          if (total > 0) {
            for (const i of rows) {
              start[i] /= total;
              end[i] /= total;
            }
          }
        }
      });

      return { length: n, columns: { ...table.columns, [as0]: start, [as1]: end } };
    },
  };

  BC.define(def);
})();
