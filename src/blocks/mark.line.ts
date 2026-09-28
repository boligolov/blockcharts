(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  /** How far from the line (px) the pointer may be and still pick it. */
  const REACH = 14;

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'line',
    version: 5,
    doc: 'A polyline per series: one path however many points. Rows are joined in x order (unsorted data is sorted); missing values break the line. `group` splits the rows into one line per distinct value; a `color` channel does the same and colors each line from its color scale.',
    params: {
      group: { kind: 'field', doc: 'Field whose distinct values become separate lines (long-format data).' },
      stroke: { kind: 'string', doc: 'Any CSS color. Default: theme color by line index.' },
      strokeWidth: { kind: 'number', default: 2 },
      dash: { kind: 'list', doc: 'Dash pattern, e.g. [4, 3].' },
      opacity: { kind: 'number', default: 1 },
    },
    channels: {
      x: { required: true, scales: ['linear', 'time'] },
      y: { required: true, scales: ['linear', 'time'] },
      color: { scales: ['color'], doc: 'One line per distinct value of the field, colored by a color scale.' },
    },
    render(spec, ctx, index) {
      const xs = ctx.channel(spec, 'x').mapped;
      const ys = ctx.channel(spec, 'y').mapped;
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      const grouped = typeof spec.group === 'string' || !!(colorCh && colorCh.field);
      const width = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 2;
      const dash = Array.isArray(spec.dash) ? (spec.dash as number[]) : undefined;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const out: BC.Prim[] = [];
      ctx.series(spec, xs).forEach(({ key, rows }, n) => {
        let d = '';
        let pen = false;
        for (const i of rows) {
          const x = xs[i];
          const y = ys[i];
          if (!isFinite(x) || !isFinite(y)) {
            pen = false;
            continue;
          }
          d += (pen ? 'L' : 'M') + r2(x) + ' ' + r2(y);
          pen = true;
        }
        if (!d) return;
        const stroke = typeof spec.stroke === 'string' ? spec.stroke : colorCh ? colorCh.mapped[rows[0]] : ctx.color(index + n);
        if (!stroke) return; // a series whose color the scale hides is not drawn
        out.push({
          type: 'path',
          d,
          title: grouped ? String(key) : undefined,
          style: { fill: 'none', stroke, strokeWidth: width, strokeDash: dash, opacity, strokeLinejoin: 'round', strokeLinecap: 'round' },
        });
      });
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const xs = ctx.channel(spec, 'x').mapped;
      const ys = ctx.channel(spec, 'y').mapped;
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      let best: BC.Pick | null = null;
      for (const { rows } of ctx.series(spec, xs)) {
        if (colorCh && !colorCh.mapped[rows[0]]) continue;
        const pts = rows.filter((i) => isFinite(xs[i]) && isFinite(ys[i]));
        if (!pts.length || px < xs[pts[0]] - REACH || px > xs[pts[pts.length - 1]] + REACH) continue;
        // last vertex at or left of the pointer (binary search: pts are in x order)
        let lo = 0;
        let hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (xs[pts[mid]] <= px) lo = mid;
          else hi = mid - 1;
        }
        const a = pts[lo];
        const b = pts[Math.min(lo + 1, pts.length - 1)];
        // height of the line under the pointer: interpolated between the two vertices around it
        const span = xs[b] - xs[a];
        const t = span > 0 ? Math.min(1, Math.max(0, (px - xs[a]) / span)) : 0;
        const lineY = ys[a] + (ys[b] - ys[a]) * t;
        const dist = Math.abs(py - lineY);
        if (dist > REACH || (best && dist >= best.dist)) continue;
        const row = Math.abs(px - xs[a]) <= Math.abs(px - xs[b]) ? a : b;
        best = { row, x: xs[row], y: ys[row], dist };
      }
      return best;
    },
  };

  BC.define(def);
})();
