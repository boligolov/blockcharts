(function (BC: BC.Runtime) {
  function fail(message: string): never {
    throw new Error('transform.treemap: ' + message);
  }

  type Check = (block: string, table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) => void;
  /** The fields it reads must exist and the columns it writes must not replace others: lib.columns, listed in
   *  `requires` so it is on the page. */
  const checkColumns = (table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) =>
    ((BC.get('lib.columns') as BC.LibDef).exports.check as Check)('transform.treemap', table, reads, writes, keep);

  /** The shape of plot the cells are laid out for when there is no plot yet: the run the scales take their domains from. */
  const GUESS = 1.6;
  const aspectOf = (spec: BC.TransformSpec) =>
    typeof spec.aspect === 'number' && spec.aspect > 0 && isFinite(spec.aspect) ? spec.aspect : undefined;
  /** The last layout for the shape of a plot, per spec: every redraw at the same size asks for the same one. */
  const laidOut = new WeakMap<BC.TransformSpec, { table: BC.Table; aspect: number; out: BC.Table }>();

  interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  interface Item {
    i: number;
    v: number;
  }

  function names(spec: BC.TransformSpec) {
    const as = Array.isArray(spec.as) ? spec.as : [];
    const pick = (k: number, d: string) => (typeof as[k] === 'string' ? (as[k] as string) : d);
    return {
      x0: pick(0, 'x0'),
      x1: pick(1, 'x1'),
      y0: pick(2, 'y0'),
      y1: pick(3, 'y1'),
      label: typeof spec.labelAs === 'string' ? spec.labelAs : 'label',
    };
  }

  /** The worst aspect ratio of a row of areas laid along a side of length `side` (squarified treemaps, Bruls et al.). */
  function worst(row: number[], side: number): number {
    let sum = 0;
    let max = 0;
    let min = Infinity;
    for (const a of row) {
      sum += a;
      if (a > max) max = a;
      if (a < min) min = a;
    }
    const s2 = side * side;
    const t = sum * sum;
    return Math.max((s2 * max) / t, t / (s2 * min));
  }

  /** Lays items (largest first, areas already scaled to the box) into the box as near-square rectangles. */
  function squarify(items: Item[], box: Box, out: Map<number, Box>): void {
    let rest = items.slice();
    let b = { ...box };
    while (rest.length) {
      const side = Math.min(b.w, b.h);
      if (side <= 0) break;
      const row: Item[] = [rest[0]];
      let k = 1;
      while (
        k < rest.length &&
        worst(
          row.concat(rest[k]).map((it) => it.v),
          side,
        ) <=
          worst(
            row.map((it) => it.v),
            side,
          )
      ) {
        row.push(rest[k]);
        k++;
      }
      rest = rest.slice(k);
      const sum = row.reduce((a, it) => a + it.v, 0);
      if (b.w >= b.h) {
        // a column on the left, as wide as the row's area needs
        const w = rest.length ? sum / b.h : b.w;
        let y = b.y;
        for (const it of row) {
          const h = w > 0 ? it.v / w : 0;
          out.set(it.i, { x: b.x, y, w, h });
          y += h;
        }
        b = { x: b.x + w, y: b.y, w: b.w - w, h: b.h };
      } else {
        // a row along the top
        const h = rest.length ? sum / b.w : b.h;
        let x = b.x;
        for (const it of row) {
          const w = h > 0 ? it.v / h : 0;
          out.set(it.i, { x, y: b.y, w, h });
          x += w;
        }
        b = { x: b.x, y: b.y + h, w: b.w, h: b.h - h };
      }
    }
  }

  /** Items scaled so their areas fill the box, largest first. */
  function scaled(items: Item[], box: Box): Item[] {
    const total = items.reduce((a, it) => a + it.v, 0);
    const k = total > 0 ? (box.w * box.h) / total : 0;
    return items.map((it) => ({ i: it.i, v: it.v * k })).sort((a, b) => b.v - a.v || a.i - b.i);
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'treemap',
    version: 6,
    requires: ['lib.columns'],
    // without a fixed `aspect` it follows the plot, and it can also run without one: the scales may read its first result
    viewDependent: (spec) => aspectOf(spec) === undefined,
    doc: 'A treemap: each row becomes a rectangle whose area is its `field`, laid out as near-square cells (squarified), largest at the top left. With `group`, rows are first gathered into one block per group (an area per region, then per product inside it), and with `subgroup` each block is divided once more (region, country, product). Writes the corners in 0..1 (`x0`, `x1`, `y0`, `y1`, y up) and a `label` with the name of each cell. Draw with mark.rect (x = x0, x2 = x1, y = y1, y2 = y0) on two linear scales with domain [0, 1] and no axes; color by the group; label with mark.text at (x0, y1) with x2 = x1 and y2 = y0, which leaves out a name its cell has no room for. The cells are laid out for the shape of the plot as it is drawn, and anew when the chart changes width, so they stay near square on a phone as on a wide screen.',
    params: {
      field: { kind: 'field', reads: 'number', required: true, doc: 'The size of each cell (positive numbers; others are left out).' },
      group: { kind: 'field', doc: 'Field that gathers cells into blocks, one per distinct value.' },
      subgroup: { kind: 'field', doc: 'Field that gathers the cells of a block into smaller blocks: a third level. Needs `group`.' },
      name: { kind: 'field', doc: "Field with each cell's name, copied to `label` (see `labelMin`)." },
      aspect: {
        kind: 'number',
        doc: 'Width / height of the plot, to lay the cells out once for that shape instead of following the plot: at another size they come out stretched.',
      },
      padding: { kind: 'number', default: 0.004, doc: 'Space between cells, as a share of the plot height.' },
      labelMin: {
        kind: 'number',
        default: 0,
        doc: 'Cells smaller than this share of the whole get no label, even where it would fit. With 0 every named cell has one, and mark.text with x2 / y2 leaves out the ones that do not fit.',
      },
      as: { kind: 'list', doc: 'Names of the four corner columns. Default [x0, x1, y0, y1].' },
      labelAs: { kind: 'string', default: 'label', doc: 'Name of the label column.' },
    },
    outputs(spec) {
      const n = names(spec);
      return [n.x0, n.x1, n.y0, n.y1, n.label];
    },
    apply(table, spec, view) {
      const n = names(spec);
      checkColumns(
        table,
        [
          ['field', spec.field],
          ['group', spec.group],
          ['subgroup', spec.subgroup],
          ['name', spec.name],
        ],
        [
          ['as[0]', n.x0],
          ['as[1]', n.x1],
          ['as[2]', n.y0],
          ['as[3]', n.y1],
          ['labelAs', n.label],
        ],
        [spec.name],
      );
      const values = table.columns[String(spec.field)] || [];
      const groups = typeof spec.group === 'string' ? table.columns[spec.group] : undefined;
      const subgroups = typeof spec.subgroup === 'string' ? table.columns[spec.subgroup] : undefined;
      if (subgroups && !groups) fail('"subgroup" divides the blocks of "group", so it needs "group"');
      const labels = typeof spec.name === 'string' ? table.columns[spec.name] : undefined;
      const given = aspectOf(spec);
      // the plot as it is drawn (a zoom changes the scales, not the plot: the cells are magnified, not laid out anew)
      const shape = view ? view.plot.w / view.plot.h : NaN;
      const follows = given === undefined && shape > 0 && isFinite(shape);
      const aspect = given ?? (follows ? shape : GUESS);
      const kept = follows ? laidOut.get(spec) : undefined;
      if (kept && kept.table === table && kept.aspect === aspect) return kept.out;
      const pad = typeof spec.padding === 'number' && spec.padding >= 0 ? Math.min(0.1, spec.padding) : 0.004;
      const labelMin = typeof spec.labelMin === 'number' ? spec.labelMin : 0;

      const items: Item[] = [];
      let total = 0;
      for (let i = 0; i < table.length; i++) {
        const v = values[i];
        if (typeof v === 'number' && isFinite(v) && v > 0) {
          items.push({ i, v });
          total += v;
        }
      }
      // the layout works in a box as wide as the plot is (height 1), then is divided back into 0..1
      const box: Box = { x: 0, y: 0, w: aspect, h: 1 };
      const cells = new Map<number, Box>();
      /** Lays items into a box, gathered by each of `levels` in turn: a block per value, then the next level inside it. */
      const lay = (list: Item[], into: Box, levels: BC.Column[]): void => {
        if (!levels.length) return squarify(scaled(list, into), into, cells);
        const byGroup = new Map<unknown, Item[]>();
        for (const it of list) {
          const g = levels[0][it.i];
          if (!byGroup.has(g)) byGroup.set(g, []);
          byGroup.get(g)!.push(it);
        }
        const blocks = Array.from(byGroup.values()).map((part, k) => ({ i: k, v: part.reduce((a, it) => a + it.v, 0), part }));
        const blockBoxes = new Map<number, Box>();
        squarify(scaled(blocks, into), into, blockBoxes);
        blocks.forEach((b) => {
          const bb = blockBoxes.get(b.i);
          if (bb) lay(b.part, bb, levels.slice(1));
        });
      };
      lay(items, box, groups ? (subgroups ? [groups, subgroups] : [groups]) : []);

      const x0 = new Float64Array(table.length).fill(NaN);
      const x1 = new Float64Array(table.length).fill(NaN);
      const y0 = new Float64Array(table.length).fill(NaN);
      const y1 = new Float64Array(table.length).fill(NaN);
      const label: (string | null)[] = new Array(table.length).fill(null);
      const half = pad / 2;
      cells.forEach((c, i) => {
        // inset by half the padding on every side, but never past the middle of a thin cell
        const hx = Math.min(half, c.w / 2);
        const hy = Math.min(half, c.h / 2);
        x0[i] = (c.x + hx) / aspect;
        x1[i] = (c.x + c.w - hx) / aspect;
        // y grows upwards on a chart: the top of the box is 1
        y1[i] = 1 - (c.y + hy);
        y0[i] = 1 - (c.y + c.h - hy);
        const v = values[i] as number;
        if (labels && total > 0 && v / total >= labelMin && labels[i] != null) label[i] = String(labels[i]);
      });

      const columns: Record<string, BC.Column> = { ...table.columns };
      columns[n.x0] = x0;
      columns[n.x1] = x1;
      columns[n.y0] = y0;
      columns[n.y1] = y1;
      columns[n.label] = label;
      const out = { length: table.length, columns };
      if (follows) laidOut.set(spec, { table, aspect, out });
      return out;
    },
  };

  BC.define(def);
})((globalThis as any).BC);
