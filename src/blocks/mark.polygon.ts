(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  interface Shape {
    /** The first row of the shape: its color, and the row a tooltip shows. */
    row: number;
    /** Its outlines in px, each closed. */
    rings: [number, number][][];
    color: string;
  }

  /** Shared by render and pick, so that what is drawn is what is hit. */
  function shapesOf(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number): Shape[] {
    const xs = ctx.channel(spec, 'x').mapped;
    const ys = ctx.channel(spec, 'y').mapped;
    const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
    const groups = typeof spec.group === 'string' ? ctx.table.columns[spec.group] : undefined;
    const rings = typeof spec.ring === 'string' ? ctx.table.columns[spec.ring] : undefined;
    const fill = typeof spec.fill === 'string' ? spec.fill : ctx.color(index);
    const { from, to } = ctx.rows(spec);
    // a shape per value of `group` in the order it first comes; in it, an outline per run of rows with one `ring`
    const byGroup = new Map<unknown, { row: number; rings: [number, number][][]; ringKey: unknown }>();
    for (let i = from; i < to; i++) {
      const key = groups ? groups[i] : null;
      let s = byGroup.get(key);
      if (!s) byGroup.set(key, (s = { row: i, rings: [], ringKey: {} }));
      const rk = rings ? rings[i] : null;
      if (rk !== s.ringKey || !s.rings.length) {
        s.rings.push([]);
        s.ringKey = rk;
      }
      // a point with no position is left out; the outline goes straight on to the next one
      if (isFinite(xs[i]) && isFinite(ys[i])) s.rings[s.rings.length - 1].push([xs[i], ys[i]]);
    }
    const out: Shape[] = [];
    byGroup.forEach((s) => {
      const color = colors ? colors[s.row] : fill;
      if (!color) return; // a value the legend hides
      const closed = s.rings.filter((r) => r.length > 2);
      if (closed.length) out.push({ row: s.row, rings: closed, color });
    });
    return out;
  }

  /** How many times the outlines wind around a point, counterclockwise minus clockwise: inside is not 0 (nonzero rule). */
  function winding(rings: [number, number][][], x: number, y: number): number {
    let w = 0;
    for (const ring of rings)
      for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
        const [x0, y0] = ring[m];
        const [x1, y1] = ring[k];
        const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y0 <= y) {
          if (y1 > y && side > 0) w++;
        } else if (y1 <= y && side < 0) w--;
      }
    return w;
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'polygon',
    version: 1,
    doc: 'Closed shapes through the rows in their order: the regions of transform.contour, or any outline given point by point. `group` makes a shape of the rows with one value, drawn as one path, in the order the values first come (the last on top); `ring` splits a shape into several outlines, a run of rows each. An outline inside another that runs the other way round is a hole, as the rings of transform.contour do. With `filled: false` only the outlines are drawn (contour lines). The tooltip finds the shape the pointer is in, the top one first.',
    params: {
      group: { kind: 'field', doc: 'Rows with the same value make one shape. Default: all rows are one.' },
      ring: { kind: 'field', doc: 'In a shape, a run of rows with the same value is one closed outline. Default: one outline per shape.' },
      filled: { kind: 'boolean', default: true, doc: 'false draws only the outlines, in the color of the shape.' },
      fill: { kind: 'string', doc: 'Any CSS color, when there is no color channel. Default: theme color by mark index.' },
      opacity: { kind: 'number', default: 1, doc: 'Fill opacity.' },
      stroke: { kind: 'string', doc: 'Outline color of a filled shape. Default: none.' },
      strokeWidth: { kind: 'number', default: 1 },
    },
    channels: {
      x: { required: true, scales: ['linear', 'log', 'time'], doc: 'Position of each point of an outline.' },
      y: { required: true, scales: ['linear', 'log', 'time'], doc: 'Position of each point of an outline.' },
      color: { scales: ['color', 'sequential'], doc: 'Color of a shape, from its first row; a value the scale hides is not drawn.' },
    },
    render(spec, ctx, index) {
      const filled = spec.filled !== false;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const strokeWidth = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 1;
      const stroke = typeof spec.stroke === 'string' ? spec.stroke : undefined;
      return shapesOf(spec, ctx, index).map((s): BC.Prim => ({
        type: 'path',
        d: s.rings.map((r) => 'M' + r.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L') + 'Z').join(''),
        style: filled
          ? { fill: s.color, fillOpacity: opacity, stroke, strokeWidth: stroke ? strokeWidth : undefined, strokeLinejoin: 'round' }
          : { fill: 'none', stroke: s.color, strokeWidth, strokeLinejoin: 'round' },
        ref: { mark: index, row: s.row },
      }));
    },
    pick(spec, ctx, index, px, py) {
      const shapes = shapesOf(spec, ctx, index);
      for (let k = shapes.length - 1; k >= 0; k--)
        if (winding(shapes[k].rings, px, py) !== 0) return { row: shapes[k].row, x: px, y: py, dist: 0 };
      return null;
    },
  };

  BC.define(def);
})();
