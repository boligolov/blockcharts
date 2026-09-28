(function () {
  const TEXT = 'var(--bc-text, #333)';

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'boxplot',
    version: 1,
    doc: 'A box (q1 to q3), a line across it at the median, and whiskers out to low/high — the usual shape for transform.quartiles\' output. `x` is the category (a band scale, one box per category) or a plain position on a continuous one; the five value channels share the scale of `y` by default. Outliers are not drawn by this mark: transform.quartiles reports them as their own rows (only `value` set, the others NaN), meant for a plain mark.point layered on top reading the same `x` and `value`.',
    params: {
      width: { kind: 'number', default: 0.6, doc: 'Box width: a fraction (0-1) of the category band, or, off a band scale, a fixed number of px.' },
      fill: { kind: 'string', doc: 'Box fill. Default: theme color by mark index (or the `color` channel).' },
      fillOpacity: { kind: 'number', default: 0.85 },
      strokeWidth: { kind: 'number', default: 1.5, doc: 'Width of the box outline and the whiskers.' },
      opacity: { kind: 'number', default: 1 },
    },
    channels: {
      x: { required: true, scales: ['band', 'linear', 'time'] },
      low: { required: true, scales: ['linear', 'time'], sharesScale: 'y', doc: 'Bottom of the lower whisker.' },
      q1: { required: true, scales: ['linear', 'time'], sharesScale: 'y', doc: 'Bottom of the box (25th percentile).' },
      median: { required: true, scales: ['linear', 'time'], sharesScale: 'y', doc: 'Line drawn across the box.' },
      q3: { required: true, scales: ['linear', 'time'], sharesScale: 'y', doc: 'Top of the box (75th percentile).' },
      high: { required: true, scales: ['linear', 'time'], sharesScale: 'y', doc: 'Top of the upper whisker.' },
      color: { scales: ['color', 'sequential'], doc: 'Box and whisker color per row, from a color scale; rows the scale gives no color are not drawn.' },
    },
    render(spec, ctx, index) {
      const cx = ctx.channel(spec, 'x');
      const cLow = ctx.channel(spec, 'low');
      const cQ1 = ctx.channel(spec, 'q1');
      const cMedian = ctx.channel(spec, 'median');
      const cQ3 = ctx.channel(spec, 'q3');
      const cHigh = ctx.channel(spec, 'high');
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const bw = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth : 0;
      const frac = typeof spec.width === 'number' && spec.width > 0 ? spec.width : 0.6;
      const boxW = bw ? (frac <= 1 ? bw * frac : Math.min(frac, bw)) : frac > 1 ? frac : 16;
      const half = bw / 2;
      const fill = typeof spec.fill === 'string' ? spec.fill : undefined;
      const fillOpacity = typeof spec.fillOpacity === 'number' ? spec.fillOpacity : 0.85;
      const strokeWidth = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 1.5;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const { from, to } = ctx.rows(spec);
      const out: BC.Prim[] = [];
      for (let i = from; i < to; i++) {
        const low = cLow.mapped[i];
        const q1 = cQ1.mapped[i];
        const median = cMedian.mapped[i];
        const q3 = cQ3.mapped[i];
        const high = cHigh.mapped[i];
        if (!isFinite(low) || !isFinite(q1) || !isFinite(median) || !isFinite(q3) || !isFinite(high)) continue; // an outlier row, or an unmapped x
        const px = cx.mapped[i];
        if (!isFinite(px)) continue;
        const c = colors ? colors[i] : fill || ctx.color(index);
        if (!c) continue;
        const xc = px + half;
        const x0 = xc - boxW / 2;
        const x1 = xc + boxW / 2;
        const boxY = Math.min(q1, q3);
        const boxH = Math.abs(q1 - q3);
        out.push({
          type: 'path', ref: { mark: index, row: i },
          d: `M${xc} ${low}L${xc} ${high}M${x0} ${low}L${x1} ${low}M${x0} ${high}L${x1} ${high}`,
          style: { stroke: c, strokeWidth, opacity },
        });
        out.push({ type: 'rect', x: x0, y: boxY, w: boxW, h: boxH, style: { fill: c, fillOpacity, stroke: c, strokeWidth, opacity }, ref: { mark: index, row: i } });
        out.push({ type: 'path', d: `M${x0} ${median}L${x1} ${median}`, style: { stroke: TEXT, strokeWidth: strokeWidth + 0.5, opacity } });
      }
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const cx = ctx.channel(spec, 'x');
      const cLow = ctx.channel(spec, 'low');
      const cQ1 = ctx.channel(spec, 'q1');
      const cQ3 = ctx.channel(spec, 'q3');
      const cHigh = ctx.channel(spec, 'high');
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const bw = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth : 0;
      const frac = typeof spec.width === 'number' && spec.width > 0 ? spec.width : 0.6;
      const boxW = bw ? (frac <= 1 ? bw * frac : Math.min(frac, bw)) : frac > 1 ? frac : 16;
      const half = bw / 2;
      const { from, to } = ctx.rows(spec);
      const SLACK = 4;
      for (let i = to - 1; i >= from; i--) {
        if (colors && !colors[i]) continue;
        const low = cLow.mapped[i];
        const q1 = cQ1.mapped[i];
        const q3 = cQ3.mapped[i];
        const high = cHigh.mapped[i];
        const px0 = cx.mapped[i];
        if (!isFinite(low) || !isFinite(q1) || !isFinite(q3) || !isFinite(high) || !isFinite(px0)) continue;
        const xc = px0 + half;
        const x0 = xc - boxW / 2;
        const x1 = xc + boxW / 2;
        const yTop = Math.min(low, high) - SLACK;
        const yBottom = Math.max(low, high) + SLACK;
        if (px >= x0 - SLACK && px <= x1 + SLACK && py >= yTop && py <= yBottom) {
          const boxY = Math.min(q1, q3);
          const boxH = Math.abs(q1 - q3);
          return { row: i, x: xc, y: boxY, dist: 0, box: { x: x0, y: boxY, w: boxW, h: boxH } };
        }
      }
      return null;
    },
  };

  BC.define(def);
})();
