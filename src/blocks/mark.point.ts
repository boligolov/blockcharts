(function () {
  const def: BC.MarkDef = {
    role: 'mark',
    type: 'point',
    version: 6,
    doc: 'One circle per row. Channels x and y, optional color (a field on a color scale); constant params r, fill, opacity. Either channel also takes a band scale, centered in its band — a category axis plus a value axis draws a dot plot (Cleveland dot plot).',
    params: {
      r: { kind: 'number', default: 3, doc: 'Radius in px.' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: theme color by mark index.' },
      opacity: { kind: 'number', default: 1 },
    },
    channels: {
      x: { required: true, scales: ['linear', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'time', 'band'] },
      color: { scales: ['color', 'sequential'], doc: 'Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn.' },
    },
    render(spec, ctx, index) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const halfX = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
      const halfY = cy.scale && cy.scale.bandwidth !== undefined ? cy.scale.bandwidth / 2 : 0;
      const r = typeof spec.r === 'number' ? spec.r : 3;
      const fill = typeof spec.fill === 'string' ? spec.fill : ctx.color(index);
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const { from, to } = ctx.rows(spec);
      const out: BC.Prim[] = [];
      for (let i = from; i < to; i++) {
        const px = cx.mapped[i];
        const py = cy.mapped[i];
        if (!isFinite(px) || !isFinite(py)) continue;
        const c = colors ? colors[i] : fill;
        if (!c) continue;
        out.push({ type: 'circle', cx: px + halfX, cy: py + halfY, r, style: { fill: c, opacity }, ref: { mark: index, row: i } });
      }
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const halfX = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
      const halfY = cy.scale && cy.scale.bandwidth !== undefined ? cy.scale.bandwidth / 2 : 0;
      const r = typeof spec.r === 'number' ? spec.r : 3;
      const { from, to } = ctx.rows(spec);
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      let best = -1;
      let bestD = Infinity;
      let bestX = 0;
      let bestY = 0;
      for (let i = from; i < to; i++) {
        const x = cx.mapped[i] + halfX;
        const y = cy.mapped[i] + halfY;
        if (!isFinite(x) || !isFinite(y) || (colors && !colors[i])) continue;
        const d = Math.hypot(x - px, y - py);
        if (d <= bestD) {
          bestD = d;
          best = i;
          bestX = x;
          bestY = y;
        }
      }
      // a few pixels of slack: small dots are hard to hit exactly
      if (best < 0 || bestD > r + 6) return null;
      return { row: best, x: bestX, y: bestY, dist: Math.max(0, bestD - r) };
    },
  };

  BC.define(def);
})();
