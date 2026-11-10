(function () {
  function fail(message: string): never {
    throw new Error('transform.marimekko: ' + message);
  }

  function names(spec: BC.TransformSpec) {
    const as = Array.isArray(spec.as) ? spec.as : [];
    const pick = (k: number, d: string) => (typeof as[k] === 'string' ? (as[k] as string) : d);
    return {
      x0: pick(0, 'x0'),
      x1: pick(1, 'x1'),
      y0: pick(2, 'y0'),
      y1: pick(3, 'y1'),
      share: typeof spec.shareAs === 'string' ? spec.shareAs : 'share',
      label: typeof spec.labelAs === 'string' ? spec.labelAs : 'label',
    };
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'marimekko',
    version: 3,
    doc: 'A Marimekko (mosaic) chart: one column per `category`, as wide as its share of the whole; within it each row takes a height in proportion to `field`. It writes the corners (x0, x1, y0, y1) in 0..1 for a rect on two linear scales with the domain [0, 1], `share` (the part of its column a row takes, 0..1), and `label` (the name of the category on the tallest cell of its column, the one with room for it, for a mark.text). Columns and cells keep the order of the data. Rows without a positive value are left out.',
    params: {
      field: { kind: 'field', reads: 'number', required: true, doc: 'The size of each cell (positive numbers; others are left out).' },
      category: { kind: 'field', required: true, doc: 'The field that makes the columns.' },
      gap: { kind: 'number', default: 0.003, doc: 'Space between the columns, as a share of the width.' },
      as: { kind: 'list', doc: 'Names of the four corner columns. Default [x0, x1, y0, y1].' },
      shareAs: { kind: 'string', default: 'share', doc: 'Name of the share column.' },
      labelAs: { kind: 'string', default: 'label', doc: 'Name of the label column.' },
    },
    outputs(spec) {
      const n = names(spec);
      return [n.x0, n.x1, n.y0, n.y1, n.share, n.label];
    },
    apply(table, spec) {
      const n = names(spec);
      const has = (f: string) => Object.prototype.hasOwnProperty.call(table.columns, f);
      for (const param of ['field', 'category']) {
        const f = spec[param];
        if (typeof f !== 'string' || !has(f)) fail(`unknown field "${String(f)}" in "${param}"`);
      }
      const made = [n.x0, n.x1, n.y0, n.y1, n.share, n.label];
      if (new Set(made).size < made.length) fail('the new columns must have different names');
      for (const name of made) if (has(name)) fail(`"${name}" is already a column of the data: give the new one another name`);

      const values = table.columns[spec.field as string];
      const categories = table.columns[spec.category as string];
      const groups = new Map<unknown, { rows: number[]; sum: number }>();
      let total = 0;
      for (let i = 0; i < table.length; i++) {
        const v = values[i];
        const c = categories[i];
        if (typeof v !== 'number' || !isFinite(v) || v <= 0 || c === null || c === undefined || c === '') continue;
        if (!groups.has(c)) groups.set(c, { rows: [], sum: 0 });
        const g = groups.get(c)!;
        g.rows.push(i);
        g.sum += v;
        total += v;
      }

      const x0 = new Float64Array(table.length).fill(NaN);
      const x1 = new Float64Array(table.length).fill(NaN);
      const y0 = new Float64Array(table.length).fill(NaN);
      const y1 = new Float64Array(table.length).fill(NaN);
      const share = new Float64Array(table.length).fill(NaN);
      const label: (string | null)[] = new Array(table.length).fill(null);
      const pad = (typeof spec.gap === 'number' && spec.gap >= 0 ? Math.min(0.05, spec.gap) : 0.003) / 2;
      let left = 0;
      groups.forEach((g, c) => {
        const width = g.sum / total;
        // never past the middle of a thin column
        const inset = Math.min(pad, width / 4);
        let y = 1;
        for (const i of g.rows) {
          const part = (values[i] as number) / g.sum;
          x0[i] = left + inset;
          x1[i] = left + width - inset;
          y1[i] = y;
          y0[i] = y - part;
          share[i] = part;
          y -= part;
        }
        label[g.rows.reduce((a, b) => ((values[b] as number) > (values[a] as number) ? b : a))] = String(c);
        left += width;
      });

      const columns: Record<string, BC.Column> = { ...table.columns };
      columns[n.x0] = x0;
      columns[n.x1] = x1;
      columns[n.y0] = y0;
      columns[n.y1] = y1;
      columns[n.share] = share;
      columns[n.label] = label;
      return { length: table.length, columns };
    },
  };

  BC.define(def);
})();
