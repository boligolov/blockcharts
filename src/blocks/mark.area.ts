(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /** Per-row edges of the band: top = y, bottom = y2 (or the baseline). */
  function edges(spec: BC.MarkSpec, ctx: BC.ChartCtx) {
    const y = ctx.channel(spec, 'y');
    const y2 = ctx.channel(spec, 'y2');
    const baseline = typeof spec.baseline === 'number' ? spec.baseline : 0;
    const basePx = y.scale && !y2.raw.length ? y.scale(baseline) : NaN;
    return {
      xs: ctx.channel(spec, 'x').mapped,
      top: y.mapped,
      bottom: (i: number): number => (y2.raw.length ? y2.mapped[i] : basePx),
    };
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'area',
    version: 2,
    doc: 'A filled band per series between y and y2 (or `baseline`, default 0). Stack with transform.stack and use its two columns as y2 and y. `group` or a `color` channel splits the rows into series, like mark.line. Missing values break the area.',
    params: {
      baseline: { kind: 'number', default: 0, doc: 'Where the area starts when there is no y2. Keep it inside the scale domain.' },
      group: { kind: 'field', doc: 'Field whose distinct values become separate areas.' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: theme color by series index.' },
      opacity: { kind: 'number', default: 0.85 },
    },
    channels: {
      x: { required: true, scales: ['linear', 'time'] },
      y: { required: true, scales: ['linear', 'time'] },
      y2: { scales: ['linear', 'time'], sharesScale: 'y', doc: 'Lower edge of the band.' },
      color: { scales: ['color'], doc: 'One area per distinct value of the field, colored by a color scale.' },
    },
    render(spec, ctx, index) {
      const { xs, top, bottom } = edges(spec, ctx);
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : 0.85;
      const out: BC.Prim[] = [];
      ctx.series(spec, xs).forEach(({ rows }, n) => {
        const fill = typeof spec.fill === 'string' ? spec.fill : colorCh ? colorCh.mapped[rows[0]] : ctx.color(index + n);
        if (!fill) return; // a series whose color the scale hides is not drawn
        let d = '';
        let run: number[] = [];
        // a run is a stretch of rows without gaps: forward along the top, back along the bottom, closed
        const flush = () => {
          if (run.length) {
            const last = run.length - 1;
            d += 'M' + r2(xs[run[0]]) + ' ' + r2(top[run[0]]);
            for (let k = 1; k <= last; k++) d += 'L' + r2(xs[run[k]]) + ' ' + r2(top[run[k]]);
            for (let k = last; k >= 0; k--) d += 'L' + r2(xs[run[k]]) + ' ' + r2(bottom(run[k]));
            d += 'Z';
          }
          run = [];
        };
        for (const i of rows) {
          if (isFinite(xs[i]) && isFinite(top[i]) && isFinite(bottom(i))) run.push(i);
          else flush();
        }
        flush();
        if (d) {
          out.push({ type: 'path', d, style: { fill, fillOpacity: opacity, stroke: fill, strokeWidth: 1, strokeLinejoin: 'round' } });
        }
      });
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const { xs, top, bottom } = edges(spec, ctx);
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      let best: BC.Pick | null = null;
      for (const { rows } of ctx.series(spec, xs)) {
        if (colorCh && !colorCh.mapped[rows[0]]) continue;
        const pts = rows.filter((i) => isFinite(xs[i]) && isFinite(top[i]) && isFinite(bottom(i)));
        if (!pts.length || px < xs[pts[0]] || px > xs[pts[pts.length - 1]]) continue;
        let lo = 0;
        let hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (xs[pts[mid]] <= px) lo = mid;
          else hi = mid - 1;
        }
        const a = pts[lo];
        const b = pts[Math.min(lo + 1, pts.length - 1)];
        const span = xs[b] - xs[a];
        const t = span > 0 ? Math.min(1, Math.max(0, (px - xs[a]) / span)) : 0;
        const yTop = top[a] + (top[b] - top[a]) * t;
        const yBottom = bottom(a) + (bottom(b) - bottom(a)) * t;
        if (py < Math.min(yTop, yBottom) - 1 || py > Math.max(yTop, yBottom) + 1) continue;
        const row = Math.abs(px - xs[a]) <= Math.abs(px - xs[b]) ? a : b;
        // overlapping areas: the one drawn last is on top
        best = { row, x: xs[row], y: top[row], dist: 0 };
      }
      return best;
    },
  };

  BC.define(def);
})();
