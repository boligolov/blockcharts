(function () {
  function fail(message: string): never {
    throw new Error('transform.waterfall: ' + message);
  }

  /** The fields it reads must exist, and the columns it writes must not replace one of the data's own (except those in
   *  `keep`, which the new column stands for) nor each other: a silent overwrite changes what another mark reads. */
  function checkColumns(table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]): void {
    const has = (f: string) => Object.prototype.hasOwnProperty.call(table.columns, f);
    for (const [param, f] of reads)
      if (f !== undefined && (typeof f !== 'string' || !has(f))) fail(`unknown field "${String(f)}" in "${param}"`);
    const seen: Record<string, string> = {};
    for (const [param, name] of writes) {
      if (seen[name]) fail(`"${seen[name]}" and "${param}" both name the new column "${name}"`);
      seen[name] = param;
      if (has(name) && keep.indexOf(name) < 0)
        fail(`"${name}" is already a column of the data: give the new one another name with "${param}"`);
    }
  }

  /** The columns the transform writes: where each bar starts and ends, and what kind of step it is. */
  function names(spec: BC.TransformSpec): { start: string; end: string; kind: string; amount: string; top: string } {
    const field = String(spec.field);
    const as = Array.isArray(spec.as) ? spec.as : [];
    return {
      start: typeof as[0] === 'string' ? as[0] : field + '0',
      end: typeof as[1] === 'string' ? as[1] : field + '1',
      kind: typeof spec.kindAs === 'string' ? spec.kindAs : 'step',
      amount: typeof spec.amountAs === 'string' ? spec.amountAs : 'amount',
      top: typeof spec.topAs === 'string' ? spec.topAs : 'top',
    };
  }

  const truthy = (v: unknown) => v === true || v === 1 || v === 'true' || v === 'yes' || v === 'total';

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'waterfall',
    version: 2,
    doc: 'A waterfall (bridge) chart: how a starting value becomes an ending one through gains and losses. In row order, each row adds its `field` to a running total; the transform writes where each bar starts and ends (`<field>0`, `<field>1`), its kind (`step`: "increase", "decrease" or "total"), what it stands for (`amount`: the change, or the total) and its upper end (`top`, for a label above it). Rows marked by the `total` field are subtotals: their bar goes from 0 to the running total, and their own value is ignored. Draw with mark.rect (y = `<field>1`, y2 = `<field>0` on a band x), colored by `step` through a color scale.',
    params: {
      field: { kind: 'field', required: true, doc: 'The change each row makes (negative for a loss).' },
      total: {
        kind: 'field',
        doc: 'Field that marks subtotal rows (true, 1, "yes" or "total"): their bar shows the running total so far.',
      },
      start: { kind: 'number', default: 0, doc: 'Where the running total begins.' },
      as: { kind: 'list', doc: 'Names of the start and end columns. Default [<field>0, <field>1].' },
      kindAs: { kind: 'string', default: 'step', doc: 'Name of the column that says "increase", "decrease" or "total".' },
      amountAs: {
        kind: 'string',
        default: 'amount',
        doc: 'Name of the column with what each bar stands for: the change of a step, the running total of a subtotal. Label bars with it.',
      },
      topAs: { kind: 'string', default: 'top', doc: 'Name of the column with the upper end of each bar, where a label above it goes.' },
    },
    outputs(spec) {
      const n = names(spec);
      return [n.start, n.end, n.kind, n.amount, n.top];
    },
    apply(table, spec) {
      const n = names(spec);
      checkColumns(
        table,
        [
          ['field', spec.field],
          ['total', spec.total],
        ],
        [
          ['as[0]', n.start],
          ['as[1]', n.end],
          ['kindAs', n.kind],
          ['amountAs', n.amount],
          ['topAs', n.top],
        ],
        [spec.field],
      );
      const values = table.columns[String(spec.field)] || [];
      const totals = typeof spec.total === 'string' ? table.columns[spec.total] : undefined;
      const start = new Float64Array(table.length);
      const end = new Float64Array(table.length);
      const kind: (string | null)[] = new Array(table.length);
      const amount = new Float64Array(table.length);
      let running = typeof spec.start === 'number' && isFinite(spec.start) ? spec.start : 0;
      for (let i = 0; i < table.length; i++) {
        if (totals && truthy(totals[i])) {
          start[i] = 0;
          end[i] = running;
          kind[i] = 'total';
          amount[i] = running;
          continue;
        }
        const v = values[i];
        if (typeof v !== 'number' || !isFinite(v)) {
          // a gap changes nothing and draws nothing
          start[i] = NaN;
          end[i] = NaN;
          kind[i] = null;
          amount[i] = NaN;
          continue;
        }
        start[i] = running;
        running += v;
        end[i] = running;
        kind[i] = v < 0 ? 'decrease' : 'increase';
        amount[i] = v;
      }
      const columns: Record<string, BC.Column> = { ...table.columns };
      columns[n.start] = start;
      columns[n.end] = end;
      columns[n.kind] = kind;
      columns[n.amount] = amount;
      const top = new Float64Array(table.length);
      for (let i = 0; i < table.length; i++) top[i] = Math.max(start[i], end[i]);
      columns[n.top] = top;
      return { length: table.length, columns };
    },
  };

  BC.define(def);
})();
