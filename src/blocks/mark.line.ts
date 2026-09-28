(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  /** How far from the line (px) the pointer may be and still pick it. */
  const REACH = 14;
  const LABEL_SIZE = 11;
  /** Least vertical distance between two end labels, px: closer ones are pushed apart. */
  const LABEL_GAP = LABEL_SIZE + 3;

  interface EndLabel { x: number; y: number; text: string; color: string; owner: number }

  /** The end labels one line mark asks for: one per series, at its last point drawn (inside the plot when zoomed). */
  function endsOf(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number): EndLabel[] {
    const mode = spec.label === 'name' || spec.label === 'value' || spec.label === 'both' ? spec.label : 'none';
    if (mode === 'none') return [];
    const xs = ctx.channel(spec, 'x').mapped;
    const yc = ctx.channel(spec, 'y');
    const ys = yc.mapped;
    const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
    const grouped = typeof spec.group === 'string' || !!(colorCh && colorCh.field);
    const write = mode === 'value' || mode === 'both'
      ? spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : (v: unknown) => (typeof v === 'number' ? String(+v.toPrecision(6)) : String(v))
      : null;
    const right = ctx.plot.x + ctx.plot.w + 0.5;
    const out: EndLabel[] = [];
    ctx.series(spec, xs).forEach(({ key, rows }, n) => {
      const color = typeof spec.stroke === 'string' ? spec.stroke : colorCh ? colorCh.mapped[rows[0]] : ctx.color(index + n);
      if (!color) return;
      let last = -1;
      for (const i of rows) if (isFinite(xs[i]) && isFinite(ys[i]) && xs[i] <= right) last = i;
      if (last < 0) return;
      const name = grouped ? String(key) : typeof spec.name === 'string' ? spec.name : yc.field || '';
      const value = write ? write(yc.raw[last]) : '';
      const text = mode === 'name' ? name : mode === 'value' ? value : name && value ? `${name}  ${value}` : name || value;
      if (text) out.push({ x: xs[last], y: ys[last], text, color, owner: index });
    });
    return out;
  }

  /** Moves labels apart vertically (keeping their order) so none overlaps the next, and keeps them inside [top, bottom]. */
  function spread(labels: EndLabel[], top: number, bottom: number): void {
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + LABEL_GAP);
    // pushed past the bottom: shift the whole stack up, then keep the top one in view
    const over = labels.length ? labels[labels.length - 1].y - bottom : 0;
    if (over > 0) for (const l of labels) l.y -= over;
    for (let k = 0; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, top + k * LABEL_GAP);
  }

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

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'line',
    version: 7,
    doc: 'A line per series: one path however many points. Rows are joined in x order (unsorted data is sorted); missing values break the line. `group` splits the rows into one line per distinct value; a `color` channel does the same and colors each line from its color scale. `curve: "smooth"` draws a smooth curve that still passes through every point and never overshoots between two of them.',
    params: {
      group: { kind: 'field', doc: 'Field whose distinct values become separate lines (long-format data).' },
      stroke: { kind: 'string', doc: 'Any CSS color. Default: theme color by line index.' },
      strokeWidth: { kind: 'number', default: 2 },
      dash: { kind: 'list', doc: 'Dash pattern, e.g. [4, 3].' },
      opacity: { kind: 'number', default: 1 },
      curve: { kind: 'enum', values: ['linear', 'smooth'], default: 'linear', doc: '"smooth": a monotone cubic curve through the points — no peaks or dips the data does not have. "linear": straight segments.' },
      label: { kind: 'enum', values: ['none', 'name', 'value', 'both'], default: 'none', doc: 'A label at the end of each line, in its color: the series name, its last value, or both — so a legend is rarely needed. Labels that would overlap are moved apart. Leave room on the right (padding.right, about 70–110 px).' },
      format: { kind: 'any', doc: 'How the end label writes the last value (a preset or Intl options, as guide.axis `format`).' },
      name: { kind: 'string', doc: 'The end label of a line that is not split into series (default: the y field).' },
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
      const smooth = spec.curve === 'smooth';
      const out: BC.Prim[] = [];
      ctx.series(spec, xs).forEach(({ key, rows }, n) => {
        let d = '';
        let px: number[] = [];
        let py: number[] = [];
        // a run is a stretch of points without a gap; each is drawn on its own
        const flush = () => {
          if (px.length) d += 'M' + r2(px[0]) + ' ' + r2(py[0]) + through(px, py, smooth, false);
          px = [];
          py = [];
        };
        for (const i of rows) {
          const x = xs[i];
          const y = ys[i];
          if (!isFinite(x) || !isFinite(y)) {
            flush();
            continue;
          }
          px.push(x);
          py.push(y);
        }
        flush();
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
      if (endsOf(spec, ctx, index).length) {
        // the labels of every labelled line of the chart are spread together, so two line marks (revenue and plan)
        // do not write over each other; each mark then draws only its own
        const all: EndLabel[] = [];
        ctx.spec.marks.forEach((m, k) => {
          if (m.type === 'line') all.push(...endsOf(m, ctx, k));
        });
        spread(all, ctx.plot.y, ctx.plot.y + ctx.plot.h);
        for (const l of all) {
          if (l.owner !== index) continue;
          out.push({ type: 'text', x: l.x + 8, y: l.y, text: l.text, size: LABEL_SIZE, weight: 600, anchor: 'start', baseline: 'middle', style: { fill: l.color }, cls: 'bc-line-label' });
        }
      }
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
