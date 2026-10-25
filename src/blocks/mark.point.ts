(function () {
  /** Radius per row: the `size` channel when there is one (NaN = no size, not drawn), else the constant `r`. */
  function radii(spec: BC.MarkSpec, ctx: BC.ChartCtx): (i: number) => number {
    if (spec.size !== undefined) {
      const sizes = ctx.channel(spec, 'size').mapped;
      return (i) => sizes[i] as number;
    }
    const r = typeof spec.r === 'number' ? spec.r : 3;
    return () => r;
  }

  /** The rows to draw, in drawing order: with sizes, the biggest first, so a small bubble is never hidden under a big one. */
  function order(spec: BC.MarkSpec, ctx: BC.ChartCtx, radius: (i: number) => number): number[] {
    const { from, to } = ctx.rows(spec);
    const rows: number[] = [];
    for (let i = from; i < to; i++) rows.push(i);
    if (spec.size !== undefined) {
      // rows without a size are not drawn; they go last so a NaN never reaches the comparator's arithmetic
      const key = (i: number) => { const r = radius(i); return isFinite(r) ? r : -1; };
      rows.sort((a, b) => key(b) - key(a) || a - b);
    }
    return rows;
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'point',
    version: 7,
    doc: 'One circle per row. Channels x and y, optional color (a field on a color scale); constant params r, fill, opacity. Either channel also takes a band scale, centered in its band — a category axis plus a value axis draws a dot plot (Cleveland dot plot). A `size` channel on a scale.size makes it a bubble chart: the area of each circle follows the value, big bubbles are drawn first so small ones stay on top.',
    params: {
      r: { kind: 'number', default: 3, doc: 'Radius in px (when there is no `size` channel).' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: theme color by mark index.' },
      opacity: { kind: 'number', default: 1, doc: 'Bubbles overlap: 0.7 lets the ones behind show through.' },
      stroke: { kind: 'string', doc: 'Outline color; bubbles read better with the card color as one ("var(--bc-tooltip-bg, #fff)", which follows the dark theme).' },
    },
    channels: {
      x: { required: true, scales: ['linear', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'time', 'band'] },
      color: { scales: ['color', 'sequential'], doc: 'Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn.' },
      size: { scales: ['size'], doc: 'Radius per row from a scale.size (a bubble chart); rows without a size (missing or negative) are not drawn.' },
    },
    render(spec, ctx, index) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const halfX = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
      const halfY = cy.scale && cy.scale.bandwidth !== undefined ? cy.scale.bandwidth / 2 : 0;
      const radius = radii(spec, ctx);
      const fill = typeof spec.fill === 'string' ? spec.fill : ctx.color(index);
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const stroke = typeof spec.stroke === 'string' ? spec.stroke : undefined;
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const out: BC.Prim[] = [];
      for (const i of order(spec, ctx, radius)) {
        const px = cx.mapped[i];
        const py = cy.mapped[i];
        const r = radius(i);
        if (!isFinite(px) || !isFinite(py) || !isFinite(r)) continue;
        const c = colors ? colors[i] : fill;
        if (!c) continue;
        out.push({ type: 'circle', cx: px + halfX, cy: py + halfY, r, style: stroke ? { fill: c, opacity, stroke, strokeWidth: 1 } : { fill: c, opacity }, ref: { mark: index, row: i } });
      }
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const halfX = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
      const halfY = cy.scale && cy.scale.bandwidth !== undefined ? cy.scale.bandwidth / 2 : 0;
      const radius = radii(spec, ctx);
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      // the circle drawn last that the pointer is in wins (it is on top); otherwise the one whose edge is nearest
      let best = -1;
      let bestGap = Infinity;
      let bestX = 0;
      let bestY = 0;
      for (const i of order(spec, ctx, radius)) {
        const x = cx.mapped[i] + halfX;
        const y = cy.mapped[i] + halfY;
        const r = radius(i);
        if (!isFinite(x) || !isFinite(y) || !isFinite(r) || (colors && !colors[i])) continue;
        const gap = Math.max(0, Math.hypot(x - px, y - py) - r);
        if (gap <= bestGap) {
          bestGap = gap;
          best = i;
          bestX = x;
          bestY = y;
        }
      }
      // a few pixels of slack: small dots are hard to hit exactly
      if (best < 0 || bestGap > 6) return null;
      return { row: best, x: bestX, y: bestY, dist: bestGap };
    },
  };

  BC.define(def);
})();
