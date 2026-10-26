(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  type Through = (px: number[], py: number[], smooth: boolean, back: boolean) => string;
  /** The path through the points, from lib.curve (shared with mark.line); listed in `requires`, so it is on the page. */
  const through: Through = (px, py, smooth, back) => ((BC.get('lib.curve') as BC.LibDef).exports.through as Through)(px, py, smooth, back);

  /** Per-row edges of the band: top = y, bottom = y2 (or the baseline). */
  function edges(spec: BC.MarkSpec, ctx: BC.ChartCtx) {
    const y = ctx.channel(spec, 'y');
    const y2 = ctx.channel(spec, 'y2');
    const baseline = typeof spec.baseline === 'number' ? spec.baseline : 0;
    // toBottom: down to the bottom edge of the plot, whatever value is there (a sparkline whose axis does not start at 0)
    const basePx = y2.raw.length ? NaN : spec.toBottom === true ? ctx.plot.y + ctx.plot.h : y.scale ? y.scale(baseline) : NaN;
    // on a band scale the points sit in the middle of their categories, as on mark.line
    const cx = ctx.channel(spec, 'x');
    const half = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
    return {
      xs: half ? Array.from(cx.mapped, (v: number) => v + half) : cx.mapped,
      top: y.mapped,
      bottom: (i: number): number => (y2.raw.length ? y2.mapped[i] : basePx),
    };
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'area',
    version: 5,
    requires: ['lib.curve'],
    doc: 'A filled band per series between y and y2 (or `baseline`, default 0). Stack with transform.stack and use its two columns as y2 and y. `group` or a `color` channel splits the rows into series, like mark.line. Missing values break the area. `fade` makes the fill fade out towards the bottom (put a line mark on top for the edge); `curve: "smooth"` matches a smooth line. x also takes a band scale, as on mark.line.',
    params: {
      baseline: { kind: 'number', default: 0, doc: 'Where the area starts when there is no y2. Keep it inside the scale domain.' },
      group: { kind: 'field', doc: 'Field whose distinct values become separate areas.' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: theme color by series index.' },
      opacity: { kind: 'number', default: 0.85, doc: 'Fill opacity (0.45 by default with `fade`).' },
      toBottom: { kind: 'boolean', default: false, doc: 'Fill down to the bottom edge of the plot instead of to `baseline`: the area under a line whose axis does not start at 0 (a sparkline, a KPI trend).' },
      fade: { kind: 'boolean', default: false, doc: 'The fill fades from the color at the top of the plot to transparent at the bottom, and the area has no outline: the soft area under a line.' },
      curve: { kind: 'enum', values: ['linear', 'smooth'], default: 'linear', doc: 'Same as mark.line: "smooth" is a monotone curve through the points.' },
    },
    channels: {
      x: { required: true, scales: ['linear', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'time'] },
      y2: { scales: ['linear', 'time'], sharesScale: 'y', doc: 'Lower edge of the band.' },
      color: { scales: ['color'], doc: 'One area per distinct value of the field, colored by a color scale.' },
    },
    render(spec, ctx, index) {
      const { xs, top, bottom } = edges(spec, ctx);
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      const fade = spec.fade === true;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : fade ? 0.45 : 0.85;
      const smooth = spec.curve === 'smooth';
      const out: BC.Prim[] = [];
      ctx.series(spec, xs).forEach(({ rows }, n) => {
        const fill = typeof spec.fill === 'string' ? spec.fill : colorCh ? colorCh.mapped[rows[0]] : ctx.color(index + n);
        if (!fill) return; // a series whose color the scale hides is not drawn
        let d = '';
        let run: number[] = [];
        // a run is a stretch of rows without gaps: forward along the top, back along the bottom, closed
        const flush = () => {
          if (run.length) {
            const px = run.map((i) => xs[i]);
            const pt = run.map((i) => top[i]);
            const pb = run.map((i) => bottom(i));
            const last = run.length - 1;
            d += 'M' + r2(px[0]) + ' ' + r2(pt[0]) + through(px, pt, smooth, false);
            d += 'L' + r2(px[last]) + ' ' + r2(pb[last]) + through(px, pb, smooth, true);
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
          out.push({ type: 'path', d, style: fade ? { fill, fillOpacity: opacity, fade: true } : { fill, fillOpacity: opacity, stroke: fill, strokeWidth: 1, strokeLinejoin: 'round' } });
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
