(function (BC: BC.Runtime) {
  function outputNames(spec: BC.TransformSpec): [string, string] {
    const field = typeof spec.field === 'string' ? spec.field : 'value';
    const as = spec.as;
    if (as === undefined) return [field + '0', field + '1'];
    if (Array.isArray(as) && as.length === 2 && typeof as[0] === 'string' && typeof as[1] === 'string' && as[0] !== as[1])
      return [as[0], as[1]];
    throw new Error('transform.stack: "as" must be two different column names, e.g. ["y0", "y1"]');
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'stack',
    version: 5,
    viewDependent: (spec) => typeof spec.follows === 'string',
    doc: "Stacks the values of `field` on top of each other within every value of `by` (the category axis). Adds two columns, the start and the end of each row's segment (`as`, default `<field>0` and `<field>1`). Series are stacked in order of first appearance of `group`; negatives stack downward from 0 separately from positives; missing values contribute nothing and get NaN. Use the columns as y2 and y of a rect or area. `center` puts the middle of every stack on 0, so the layers flow around a center line: a streamgraph (draw it with mark.area, y = end, y2 = start, curve smooth, and no y axis, since only the thickness of a layer means anything). With `follows` the stack is rebuilt when a legend filter hides a series, so the rest close up and a 100% stack adds up to 100% again.",
    params: {
      field: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field to stack.' },
      by: { kind: 'field', required: true, doc: 'Field whose values are the stacks (the x of a stacked bar).' },
      group: { kind: 'field', doc: 'Field that tells the series apart. Without it rows stack in data order.' },
      as: { kind: 'list', doc: 'Names of the two new columns: [start, end].' },
      normalize: { kind: 'boolean', default: false, doc: 'Scale every stack to 0..1 (100% stacked).' },
      center: {
        kind: 'boolean',
        default: false,
        doc: 'Put the middle of every stack on 0 (a streamgraph). With normalize the stacks run from -0.5 to 0.5.',
      },
      follows: {
        kind: 'scale',
        doc: 'The color scale of `group`: series it does not show (a legend filter hid them) are left out of the stack. Without it they leave a gap, and a 100% stack keeps counting them.',
      },
    },
    outputs: (spec) => outputNames(spec),
    apply(table, spec, ctx) {
      const field = spec.field as string;
      const by = spec.by as string;
      const values = Object.prototype.hasOwnProperty.call(table.columns, field) ? table.columns[field] : undefined;
      const keys = Object.prototype.hasOwnProperty.call(table.columns, by) ? table.columns[by] : undefined;
      if (!values) throw new Error(`transform.stack: unknown field "${field}" in "field"`);
      if (!keys) throw new Error(`transform.stack: unknown field "${by}" in "by"`);
      const groups =
        typeof spec.group === 'string'
          ? Object.prototype.hasOwnProperty.call(table.columns, spec.group)
            ? table.columns[spec.group]
            : undefined
          : undefined;
      if (typeof spec.group === 'string' && !groups) throw new Error(`transform.stack: unknown field "${spec.group}" in "group"`);
      const [as0, as1] = outputNames(spec);
      // a column of the data written over changes what every other mark reads from it
      for (const name of [as0, as1])
        if (Object.prototype.hasOwnProperty.call(table.columns, name))
          throw new Error(`transform.stack: "${name}" is already a column of the data: give the new one another name with "as"`);
      const n = table.length;
      if (typeof spec.follows === 'string' && !groups) throw new Error('transform.stack: "follows" needs "group"');
      // before the scales exist (their domains are read from this table), everything is shown
      const follow = ctx && typeof spec.follows === 'string' ? ctx.scales[spec.follows] : undefined;
      const shown = follow ? new Set(follow.domain() as unknown[]) : null;

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
          if (typeof v !== 'number' || !isFinite(v) || (shown && !shown.has((groups as BC.Column)[i]))) {
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
            up /= total;
            down /= total;
          }
        }
        if (spec.center === true) {
          // the whole stack, from the bottom of its negatives to the top of its positives, is moved so its middle is 0
          const mid = (up + down) / 2;
          for (const i of rows) {
            start[i] -= mid;
            end[i] -= mid;
          }
        }
      });

      return { length: n, columns: { ...table.columns, [as0]: start, [as1]: end } };
    },
  };

  BC.define(def);
})((globalThis as any).BC);
