(function () {
  const TAU = Math.PI * 2;
  const TEXT = 'var(--bc-text, #444)';
  const LABEL_ROOM = 26; // radius given up to make room for outside labels
  const MIN_LABELED = 0.03; // slices thinner than 3% get no label: they would overlap
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  interface Slice { row: number; a0: number; a1: number; frac: number; value: number }
  interface Geometry { cx: number; cy: number; R: number; r0: number; slices: Slice[]; start: number }

  /** Slice angles, shared by render and pick so that what is drawn is what is hit. */
  function geometry(spec: BC.MarkSpec, ctx: BC.ChartCtx): Geometry | null {
    const values = ctx.channel(spec, 'value').raw;
    const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
    const { from, to } = ctx.rows(spec);
    const rows: number[] = [];
    let total = 0;
    for (let i = from; i < to; i++) {
      const v = values[i];
      if (typeof v !== 'number' || !isFinite(v) || v <= 0 || (colors && !colors[i])) continue;
      rows.push(i);
      total += v;
    }
    if (!rows.length || total <= 0) return null;
    if (spec.sort === 'desc') rows.sort((a, b) => (values[b] as number) - (values[a] as number) || a - b);
    else if (spec.sort === 'asc') rows.sort((a, b) => (values[a] as number) - (values[b] as number) || a - b);

    const labelled = spec.label === 'percent' || spec.label === 'value';
    const { x, y, w, h } = ctx.plot;
    const R = Math.max(1, Math.min(w, h) / 2 - (labelled ? LABEL_ROOM : 4));
    const inner = typeof spec.innerRadius === 'number' ? clamp(spec.innerRadius, 0, 0.95) : 0;
    // 0 degrees = 12 o'clock, clockwise
    const start = ((typeof spec.startAngle === 'number' ? spec.startAngle : 0) * Math.PI) / 180 - Math.PI / 2;
    let a = start;
    const slices: Slice[] = rows.map((row) => {
      const value = values[row] as number;
      const frac = value / total;
      const s = { row, a0: a, a1: a + frac * TAU, frac, value };
      a = s.a1;
      return s;
    });
    return { cx: x + w / 2, cy: y + h / 2, R, r0: R * inner, slices, start };
  }

  function arcPath(g: Geometry, a0: number, a1: number): string {
    const { cx, cy, R, r0 } = g;
    const pt = (r: number, a: number) => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;
    if (a1 - a0 >= TAU - 1e-6) {
      // one slice is a whole ring: an arc cannot start and end at the same point, so it is drawn as two halves
      let d = `M${pt(R, a0)}A${R} ${R} 0 1 1 ${pt(R, a0 + Math.PI)}A${R} ${R} 0 1 1 ${pt(R, a0)}Z`;
      if (r0 > 0) d += `M${pt(r0, a0)}A${r0} ${r0} 0 1 0 ${pt(r0, a0 + Math.PI)}A${r0} ${r0} 0 1 0 ${pt(r0, a0)}Z`;
      return d;
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const outer = `M${pt(R, a0)}A${R} ${R} 0 ${large} 1 ${pt(R, a1)}`;
    return r0 > 0 ? `${outer}L${pt(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)}Z` : `${outer}L${r2(cx)} ${r2(cy)}Z`;
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'arc',
    version: 1,
    doc: 'Pie and donut chart: one slice per row, its angle proportional to `value`. Needs no x/y scales (declare only a color scale for the colors); the pie fills the plot area. Rows whose value is not a positive number are left out. Slices are laid out clockwise from 12 o\'clock.',
    params: {
      innerRadius: { kind: 'number', default: 0, doc: 'Hole size as a fraction of the radius (0 = pie, 0.5 = donut).' },
      startAngle: { kind: 'number', default: 0, doc: 'Where the first slice starts, in degrees clockwise from 12 o\'clock.' },
      padAngle: { kind: 'number', default: 1, doc: 'Gap between slices, in degrees.' },
      sort: { kind: 'enum', values: ['none', 'desc', 'asc'], default: 'none', doc: 'Order of the slices by value; "none" keeps the data order.' },
      label: { kind: 'enum', values: ['none', 'percent', 'value'], default: 'none', doc: 'Text outside each slice (slices under 3% get none).' },
      fill: { kind: 'string', doc: 'One color for all slices, when there is no color channel.' },
      opacity: { kind: 'number', default: 1 },
    },
    channels: {
      value: { required: true, unscaled: true, doc: 'Numeric field: the size of each slice.' },
      color: { scales: ['color', 'sequential'], doc: 'Slice color per row from a color scale; a hidden category leaves its slice out.' },
    },
    render(spec, ctx, index) {
      const g = geometry(spec, ctx);
      if (!g) return [];
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const pad = ((typeof spec.padAngle === 'number' ? Math.max(0, spec.padAngle) : 1) * Math.PI) / 180;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const out: BC.Prim[] = [];
      g.slices.forEach((s, n) => {
        const fill = typeof spec.fill === 'string' && !colors ? spec.fill : colors ? colors[s.row] : ctx.color(index + n);
        // a slice narrower than its gap keeps a sliver rather than vanishing or inverting
        // (a lone slice has no neighbour to be separated from)
        const gap = g.slices.length > 1 ? Math.min(pad, (s.a1 - s.a0) * 0.5) : 0;
        out.push({ type: 'path', d: arcPath(g, s.a0 + gap / 2, s.a1 - gap / 2), style: { fill, opacity }, ref: { mark: index, row: s.row } });
        if ((spec.label === 'percent' || spec.label === 'value') && s.frac >= MIN_LABELED) {
          const mid = (s.a0 + s.a1) / 2;
          const lx = g.cx + (g.R + 10) * Math.cos(mid);
          const ly = g.cy + (g.R + 10) * Math.sin(mid);
          const text = spec.label === 'percent' ? `${Math.round(s.frac * 100)}%` : String(Number.isInteger(s.value) ? s.value : +s.value.toPrecision(6));
          out.push({ type: 'text', x: r2(lx), y: r2(ly), text, size: 11, anchor: Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle', baseline: 'middle', style: { fill: TEXT } });
        }
      });
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const g = geometry(spec, ctx);
      if (!g) return null;
      const dx = px - g.cx;
      const dy = py - g.cy;
      const dist = Math.hypot(dx, dy);
      if (dist > g.R || dist < g.r0) return null;
      // angle relative to where the first slice starts, in [0, TAU)
      let a = Math.atan2(dy, dx) - g.start;
      a = ((a % TAU) + TAU) % TAU;
      const at = g.start + a;
      for (const s of g.slices) {
        if (at >= s.a0 && at < s.a1) {
          const mid = (s.a0 + s.a1) / 2;
          const r = (g.R + g.r0) / 2;
          return { row: s.row, x: g.cx + r * Math.cos(mid), y: g.cy + r * Math.sin(mid), dist: 0 };
        }
      }
      return null;
    },
  };

  BC.define(def);
})();
