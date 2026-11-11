(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  type Through = (px: number[], py: number[], curve: string, back: boolean) => string;
  /** The path through the points, from lib.curve (shared with mark.line); listed in `requires`, so it is on the page. */
  const through: Through = (px, py, curve, back) => ((BC.get('lib.curve') as BC.LibDef).exports.through as Through)(px, py, curve, back);

  /** Where the baseline is in pixels; one the scale has no place for (0 on a log scale) is the bottom of the domain. */
  function baseAt(scale: BC.Scale, baseline: number): number {
    const px = scale(baseline) as number;
    return isFinite(px) ? px : (scale(Math.min(...(scale.domain() as number[]))) as number);
  }

  const centered = new WeakMap<BC.ChannelData, ArrayLike<number>>();
  /** The rows of a series that have both edges, per series (kept while the series is): a pointer move asks every frame. */
  const drawable = new WeakMap<number[], number[]>();

  /** Per-row edges of the band: top = y, bottom = y2 (or the baseline). */
  function edges(spec: BC.MarkSpec, ctx: BC.ChartCtx) {
    const y = ctx.channel(spec, 'y');
    const y2 = ctx.channel(spec, 'y2');
    const baseline = typeof spec.baseline === 'number' ? spec.baseline : 0;
    // toBottom: down to the bottom edge of the plot, whatever value is there (a sparkline whose axis does not start at 0)
    const basePx = y2.raw.length ? NaN : spec.toBottom === true ? ctx.plot.y + ctx.plot.h : y.scale ? baseAt(y.scale, baseline) : NaN;
    // on a band scale the points sit in the middle of their categories, as on mark.line
    const cx = ctx.channel(spec, 'x');
    let xs: ArrayLike<number> | undefined = cx.half ? centered.get(cx) : cx.mapped;
    // the same array for as long as the channel lasts (one redraw), so the series of the area are split only once
    if (!xs) centered.set(cx, (xs = Array.from(cx.mapped, (v: number) => v + cx.half)));
    return {
      xs,
      top: y.mapped,
      bottom: (i: number): number => (y2.raw.length ? y2.mapped[i] : basePx),
    };
  }

  /** The color of a series (its rows, and its place among the mark's series), shared by render and `color`: '' where
   *  the scale hides it. */
  function fillOf(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number, rows: number[], n: number): string {
    if (typeof spec.fill === 'string') return spec.fill;
    if (spec.color !== undefined) return ctx.channel(spec, 'color').mapped[rows[0]] || '';
    return ctx.color(index + n);
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'area',
    version: 15,
    requires: ['lib.curve'],
    series: true,
    enter: 'wipe',
    doc: 'A filled band per series between y and y2 (or `baseline`, default 0). Stack with transform.stack and use its two columns as y2 and y. `group` or a `color` channel splits the rows into series, like mark.line. Missing values break the area. `fade` makes the fill fade out towards the bottom (put a line mark on top for the edge); `curve` matches a smooth or a step line. x also takes a band scale, as on mark.line.',
    params: {
      baseline: { kind: 'number', default: 0, doc: 'Where the area starts when there is no y2. Keep it inside the scale domain.' },
      group: { kind: 'field', doc: 'Field whose distinct values become separate areas.' },
      fill: { kind: 'color', doc: 'Any CSS color. Default: theme color by series index.' },
      opacity: { kind: 'number', default: 0.85, doc: 'Fill opacity (0.45 by default with `fade`).' },
      toBottom: {
        kind: 'boolean',
        default: false,
        doc: 'Fill down to the bottom edge of the plot instead of to `baseline`: the area under a line whose axis does not start at 0 (a sparkline, a KPI trend).',
      },
      fade: {
        kind: 'boolean',
        default: false,
        doc: 'The fill fades from the color at the top of the plot to transparent at the bottom, and the area has no outline: the soft area under a line.',
      },
      curve: {
        kind: 'enum',
        values: ['linear', 'smooth', 'step'],
        default: 'linear',
        doc: 'Same as mark.line: "smooth" is a monotone curve through the points, "step" holds each value until the next one.',
      },
    },
    channels: {
      x: { required: true, accepts: { output: 'position' } },
      y: { required: true, accepts: { output: 'position', input: ['number', 'date'] } },
      y2: { accepts: { output: 'position', input: ['number', 'date'] }, sharesScale: 'y', doc: 'Lower edge of the band.' },
      color: {
        accepts: { output: 'color', input: ['category'] },
        doc: 'One area per distinct value of the field, colored by a color scale.',
      },
    },
    render(spec, ctx, index) {
      const { xs, top, bottom } = edges(spec, ctx);
      const fade = spec.fade === true;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : fade ? 0.45 : 0.85;
      const curve = spec.curve === 'smooth' || spec.curve === 'step' ? spec.curve : 'linear';
      const out: BC.Prim[] = [];
      ctx.series(spec, xs).forEach(({ rows }, n) => {
        const fill = fillOf(spec, ctx, index, rows, n);
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
            d += 'M' + r2(px[0]) + ' ' + r2(pt[0]) + through(px, pt, curve, false);
            d += 'L' + r2(px[last]) + ' ' + r2(pb[last]) + through(px, pb, curve, true);
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
          out.push({
            type: 'path',
            d,
            style: fade
              ? { fill, fillOpacity: opacity, fade: true }
              : { fill, fillOpacity: opacity, stroke: fill, strokeWidth: 1, strokeLinejoin: 'round' },
          });
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
        let pts = drawable.get(rows);
        if (!pts) drawable.set(rows, (pts = rows.filter((i) => isFinite(xs[i]) && isFinite(top[i]) && isFinite(bottom(i)))));
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
        // a step holds a's edges up to b's x
        const held = px < xs[b] ? a : b;
        const step = spec.curve === 'step';
        const yTop = step ? top[held] : top[a] + (top[b] - top[a]) * t;
        const yBottom = step ? bottom(held) : bottom(a) + (bottom(b) - bottom(a)) * t;
        if (py < Math.min(yTop, yBottom) - 1 || py > Math.max(yTop, yBottom) + 1) continue;
        // zoomed, a series keeps a point past each edge so its area runs on: the reader cannot see it, so it is not picked
        const seen = (i: number) => xs[i] >= ctx.plot.x - 0.5 && xs[i] <= ctx.plot.x + ctx.plot.w + 0.5;
        const nearer = step ? held : Math.abs(px - xs[a]) <= Math.abs(px - xs[b]) ? a : b;
        const row = seen(nearer) ? nearer : nearer === a ? b : a;
        if (!seen(row)) continue;
        // overlapping areas: the one drawn last is on top
        best = { row, x: xs[row], y: top[row], dist: 0 };
      }
      return best;
    },
    color(spec, ctx, index, row) {
      const all = ctx.series(spec, edges(spec, ctx).xs);
      for (let n = 0; n < all.length; n++) if (all[n].rows.includes(row)) return fillOf(spec, ctx, index, all[n].rows, n);
      return '';
    },
  };

  BC.define(def);
})();
