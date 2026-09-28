(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /** Tangents of a monotone cubic through the points (x ascending): the curve never overshoots a point (Fritsch–Carlson). */
  function tangents(px: number[], py: number[]): number[] {
    const n = px.length;
    const d: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const h = px[k + 1] - px[k];
      d.push(h ? (py[k + 1] - py[k]) / h : 0);
    }
    const m: number[] = new Array(n);
    m[0] = d[0] || 0;
    m[n - 1] = d[n - 2] || 0;
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
      if (!d[k]) {
        m[k] = 0;
        m[k + 1] = 0;
        continue;
      }
      const a = m[k] / d[k];
      const b = m[k + 1] / d[k];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[k] = t * a * d[k];
        m[k + 1] = t * b * d[k];
      }
    }
    return m;
  }

  /** Path commands through the points after the first one: straight segments, or a smooth monotone curve. `back` walks
   *  them from the last point to the first (the lower edge of an area). The caller has already moved to the start. */
  function through(px: number[], py: number[], smooth: boolean, back: boolean): string {
    const n = px.length;
    let d = '';
    if (!smooth || n < 3) {
      if (back) for (let k = n - 2; k >= 0; k--) d += 'L' + r2(px[k]) + ' ' + r2(py[k]);
      else for (let k = 1; k < n; k++) d += 'L' + r2(px[k]) + ' ' + r2(py[k]);
      return d;
    }
    const m = tangents(px, py);
    const seg = (a: number, b: number) => {
      const h = (px[b] - px[a]) / 3;
      d += 'C' + r2(px[a] + h) + ' ' + r2(py[a] + m[a] * h) + ' ' + r2(px[b] - h) + ' ' + r2(py[b] - m[b] * h) + ' ' + r2(px[b]) + ' ' + r2(py[b]);
    };
    if (back) {
      for (let k = n - 1; k > 0; k--) {
        const h = (px[k] - px[k - 1]) / 3;
        d += 'C' + r2(px[k] - h) + ' ' + r2(py[k] - m[k] * h) + ' ' + r2(px[k - 1] + h) + ' ' + r2(py[k - 1] + m[k - 1] * h) + ' ' + r2(px[k - 1]) + ' ' + r2(py[k - 1]);
      }
    } else {
      for (let k = 0; k < n - 1; k++) seg(k, k + 1);
    }
    return d;
  }

  /** Per-row edges of the band: top = y, bottom = y2 (or the baseline). */
  function edges(spec: BC.MarkSpec, ctx: BC.ChartCtx) {
    const y = ctx.channel(spec, 'y');
    const y2 = ctx.channel(spec, 'y2');
    const baseline = typeof spec.baseline === 'number' ? spec.baseline : 0;
    // toBottom: down to the bottom edge of the plot, whatever value is there (a sparkline whose axis does not start at 0)
    const basePx = y2.raw.length ? NaN : spec.toBottom === true ? ctx.plot.y + ctx.plot.h : y.scale ? y.scale(baseline) : NaN;
    return {
      xs: ctx.channel(spec, 'x').mapped,
      top: y.mapped,
      bottom: (i: number): number => (y2.raw.length ? y2.mapped[i] : basePx),
    };
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'area',
    version: 3,
    doc: 'A filled band per series between y and y2 (or `baseline`, default 0). Stack with transform.stack and use its two columns as y2 and y. `group` or a `color` channel splits the rows into series, like mark.line. Missing values break the area. `fade` makes the fill fade out towards the bottom (put a line mark on top for the edge); `curve: "smooth"` matches a smooth line.',
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
      x: { required: true, scales: ['linear', 'time'] },
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
