(function () {
  interface Box { x: number; y: number; w: number; h: number }
  interface Item { i: number; v: number }

  function names(spec: BC.TransformSpec) {
    const as = Array.isArray(spec.as) ? spec.as : [];
    const pick = (k: number, d: string) => (typeof as[k] === 'string' ? (as[k] as string) : d);
    return { x0: pick(0, 'x0'), x1: pick(1, 'x1'), y0: pick(2, 'y0'), y1: pick(3, 'y1'), label: typeof spec.labelAs === 'string' ? spec.labelAs : 'label' };
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
      while (k < rest.length && worst(row.concat(rest[k]).map((it) => it.v), side) <= worst(row.map((it) => it.v), side)) {
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
    version: 1,
    doc: 'A treemap: each row becomes a rectangle whose area is its `field`, laid out as near-square cells (squarified), largest at the top left. With `group`, rows are first gathered into one block per group (an area per region, then per product inside it). Writes the corners in 0..1 (`x0`, `x1`, `y0`, `y1`, y up) and a `label` for the cells big enough to hold one. Draw with mark.rect (x = x0, x2 = x1, y = y1, y2 = y0) on two linear scales with domain [0, 1] and no axes; color by the group; label with mark.text at (x0, y1). Set `aspect` to the width / height of the plot so the cells come out square.',
    params: {
      field: { kind: 'field', required: true, doc: 'The size of each cell (positive numbers; others are left out).' },
      group: { kind: 'field', doc: 'Field that gathers cells into blocks, one per distinct value.' },
      name: { kind: 'field', doc: 'Field with each cell\'s name, copied to `label` for cells that are big enough.' },
      aspect: { kind: 'number', default: 1.6, doc: 'Width / height of the plot the treemap fills (for a 640 × 400 chart with no axes, about 1.6).' },
      padding: { kind: 'number', default: 0.004, doc: 'Space between cells, as a share of the plot height.' },
      labelMin: { kind: 'number', default: 0.02, doc: 'Cells smaller than this share of the whole get no label (so small ones stay clean).' },
      as: { kind: 'list', doc: 'Names of the four corner columns. Default [x0, x1, y0, y1].' },
      labelAs: { kind: 'string', default: 'label', doc: 'Name of the label column.' },
    },
    outputs(spec) {
      const n = names(spec);
      return [n.x0, n.x1, n.y0, n.y1, n.label];
    },
    apply(table, spec) {
      const n = names(spec);
      const values = table.columns[String(spec.field)] || [];
      const groups = typeof spec.group === 'string' ? table.columns[spec.group] : undefined;
      const labels = typeof spec.name === 'string' ? table.columns[spec.name] : undefined;
      const aspect = typeof spec.aspect === 'number' && spec.aspect > 0 && isFinite(spec.aspect) ? spec.aspect : 1.6;
      const pad = typeof spec.padding === 'number' && spec.padding >= 0 ? Math.min(0.1, spec.padding) : 0.004;
      const labelMin = typeof spec.labelMin === 'number' ? spec.labelMin : 0.02;

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
      if (groups) {
        const byGroup = new Map<unknown, Item[]>();
        for (const it of items) {
          const g = groups[it.i];
          if (!byGroup.has(g)) byGroup.set(g, []);
          byGroup.get(g)!.push(it);
        }
        const blocks = Array.from(byGroup.values()).map((list, k) => ({ i: k, v: list.reduce((a, it) => a + it.v, 0), list }));
        const blockBoxes = new Map<number, Box>();
        squarify(scaled(blocks, box), box, blockBoxes);
        blocks.forEach((b) => {
          const bb = blockBoxes.get(b.i);
          if (bb) squarify(scaled(b.list, bb), bb, cells);
        });
      } else {
        squarify(scaled(items, box), box, cells);
      }

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
      return { length: table.length, columns };
    },
  };

  BC.define(def);
})();
