(function () {
  const TAU = Math.PI * 2;
  const TEXT = 'var(--bc-text, #444)';
  const VALUE = 'var(--bc-kpi, var(--bc-text, #111))';
  const TRACK = 'var(--bc-grid, #edf0f4)';
  const LABEL_ROOM = 26; // radius given up to make room for outside labels
  const MIN_LABELED = 0.03; // slices thinner than 3% get no label: they would overlap
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  interface Slice {
    row: number;
    a0: number;
    a1: number;
    frac: number;
    value: number;
  }
  interface Geometry {
    cx: number;
    cy: number;
    R: number;
    r0: number;
    slices: Slice[];
    start: number;
    /** Where the arc ends (radians, the same frame as start). */
    end: number;
    /** The sum of the slices' values. */
    sum: number;
    /** What a slice is a share of: `total`, or the sum. */
    whole: number;
  }

  const DEG = Math.PI / 180;
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);

  /** Start and end in radians (0 = 3 o'clock, as Math has it); a sweep that is not 0..360 degrees is an error. */
  function angles(spec: BC.MarkSpec): [number, number] {
    const s = num(spec.startAngle) !== undefined ? (spec.startAngle as number) : 0;
    const e = num(spec.endAngle) !== undefined ? (spec.endAngle as number) : s + 360;
    if (!(e > s) || e - s > 360)
      throw new Error(`mark.arc: endAngle ${e} has to be after startAngle ${s} and at most 360 degrees on (-90 to 90 is a half circle)`);
    return [s * DEG - Math.PI / 2, e * DEG - Math.PI / 2];
  }

  /** The box of an arc of radius 1 around (0, 0): its two ends, the 3, 6, 9 and 12 o'clock points it passes, and the
   *  inner ends (or the center of a pie). The radius is fitted to this box, so a half circle fills the width. */
  function extent(a0: number, a1: number, inner: number) {
    const xs: number[] = [];
    const ys: number[] = [];
    const at = (r: number, a: number) => {
      xs.push(r * Math.cos(a));
      ys.push(r * Math.sin(a));
    };
    at(1, a0);
    at(1, a1);
    at(inner, a0);
    at(inner, a1);
    for (let k = Math.ceil(a0 / (Math.PI / 2)); k * (Math.PI / 2) <= a1; k++) at(1, k * (Math.PI / 2));
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

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
    // a gauge at zero is still its empty track; a pie of nothing is nothing
    if (!rows.length && !((num(spec.total) || 0) > 0)) return null;
    if (spec.sort === 'desc') rows.sort((a, b) => (values[b] as number) - (values[a] as number) || a - b);
    else if (spec.sort === 'asc') rows.sort((a, b) => (values[a] as number) - (values[b] as number) || a - b);

    const labelled = spec.label === 'percent' || spec.label === 'value';
    const { x, y, w, h } = ctx.plot;
    const inner = typeof spec.innerRadius === 'number' ? clamp(spec.innerRadius, 0, 0.95) : 0;
    const [start, end] = angles(spec);
    const box = extent(start, end, inner);
    const room = labelled ? LABEL_ROOM : 4;
    const R = Math.max(1, Math.min((w - 2 * room) / (box.x1 - box.x0), (h - 2 * room) / (box.y1 - box.y0)));
    const given = num(spec.total);
    if (spec.total !== undefined && !(given !== undefined && given > 0))
      throw new Error(`mark.arc: total has to be a positive number (the maximum of a gauge), not ${JSON.stringify(spec.total)}`);
    const whole = given !== undefined ? given : total;
    const sweep = end - start;
    let a = start;
    const slices: Slice[] = [];
    for (const row of rows) {
      if (a >= end) break; // past the total: cut at the end of the arc
      const value = values[row] as number;
      const frac = value / whole;
      const s = { row, a0: a, a1: Math.min(end, a + frac * sweep), frac, value };
      a = s.a1;
      slices.push(s);
    }
    return {
      cx: x + w / 2 - (R * (box.x0 + box.x1)) / 2,
      cy: y + h / 2 - (R * (box.y0 + box.y1)) / 2,
      R,
      r0: R * inner,
      slices,
      start,
      end,
      sum: total,
      whole,
    };
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

  /** The color of the slice of `row`, the `n`th drawn: shared by render and `color`. '' where the scale hides it. */
  function fillOf(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number, row: number, n: number): string {
    if (spec.color !== undefined) return ctx.channel(spec, 'color').mapped[row] || '';
    return typeof spec.fill === 'string' ? spec.fill : ctx.color(index + n);
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'arc',
    version: 7,
    enter: 'pop',
    doc: "Pie and donut chart: one slice per row, its angle proportional to `value`. Needs no x/y scales (declare only a color scale for the colors); the pie fills the plot area. Rows whose value is not a positive number are left out. Slices are laid out clockwise from 12 o'clock. A gauge or a progress ring is the same mark: `startAngle` -90 and `endAngle` 90 make a half circle, `total` the maximum (the rest of the arc is an empty track), `center` writes the figure in the middle.",
    params: {
      innerRadius: { kind: 'number', default: 0, doc: 'Hole size as a fraction of the radius (0 = pie, 0.5 = donut).' },
      startAngle: { kind: 'number', default: 0, doc: "Where the first slice starts, in degrees clockwise from 12 o'clock." },
      endAngle: {
        kind: 'number',
        doc: 'Where the arc ends, in degrees as startAngle; default a full circle (startAngle + 360). -90 to 90 is the upper half circle of a gauge. The chart is fitted to the arc, so a half circle fills the width.',
      },
      total: {
        kind: 'number',
        doc: 'The whole the slices are shares of: 100 for a score out of 100, 1 for a share, the target of a progress ring. The slices take their share of the arc and the rest is an empty track. Without it the slices fill the arc. What goes past it is cut at the end of the arc.',
      },
      center: {
        kind: 'enum',
        values: ['none', 'value', 'percent'],
        default: 'none',
        doc: 'The figure in the middle, written with `labelFormat`: the sum of the values ("value"), or their share of `total` ("percent"). Goes with innerRadius (a hole to write in).',
      },
      padAngle: { kind: 'number', default: 1, doc: 'Gap between slices, in degrees.' },
      sort: {
        kind: 'enum',
        values: ['none', 'desc', 'asc'],
        default: 'none',
        doc: 'Order of the slices by value; "none" keeps the data order.',
      },
      label: {
        kind: 'enum',
        values: ['none', 'percent', 'value'],
        default: 'none',
        doc: 'Text outside each slice (slices under 3% get none).',
      },
      labelFormat: {
        kind: 'format',
        doc: 'How to write that text, as `format` on an axis. A share is a fraction: { "style": "percent", "maximumFractionDigits": 1 } writes 45.1%.',
      },
      fill: { kind: 'color', doc: 'One color for all slices, when there is no color channel.' },
      opacity: { kind: 'number', default: 1 },
    },
    channels: {
      value: { required: true, unscaled: true, doc: 'Numeric field: the size of each slice.' },
      color: { accepts: { output: 'color' }, doc: 'Slice color per row from a color scale; a hidden category leaves its slice out.' },
    },
    render(spec, ctx, index) {
      const g = geometry(spec, ctx);
      if (!g) return [];
      const pad = ((typeof spec.padAngle === 'number' ? Math.max(0, spec.padAngle) : 1) * Math.PI) / 180;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const out: BC.Prim[] = [];
      if (num(spec.total) !== undefined) {
        // the empty track of a gauge: the whole arc, under the slices
        out.push({ type: 'path', d: arcPath(g, g.start, g.end), style: { fill: TRACK }, cls: 'bc-arc-track' });
      }
      g.slices.forEach((s, n) => {
        const fill = fillOf(spec, ctx, index, s.row, n);
        // a slice narrower than its gap keeps a sliver rather than vanishing or inverting
        // (a lone slice has no neighbour to be separated from)
        const gap = g.slices.length > 1 ? Math.min(pad, (s.a1 - s.a0) * 0.5) : 0;
        out.push({
          type: 'path',
          d: arcPath(g, s.a0 + gap / 2, s.a1 - gap / 2),
          style: { fill, opacity },
          ref: { mark: index, row: s.row },
        });
        if ((spec.label === 'percent' || spec.label === 'value') && s.frac >= MIN_LABELED) {
          const mid = (s.a0 + s.a1) / 2;
          const lx = g.cx + (g.R + 10) * Math.cos(mid);
          const ly = g.cy + (g.R + 10) * Math.sin(mid);
          const text =
            spec.labelFormat !== undefined
              ? BC.formatter(spec.labelFormat as BC.FormatSpec | string)(spec.label === 'percent' ? s.frac : s.value)
              : spec.label === 'percent'
                ? `${Math.round(s.frac * 100)}%`
                : String(Number.isInteger(s.value) ? s.value : +s.value.toPrecision(6));
          out.push({
            type: 'text',
            x: r2(lx),
            y: r2(ly),
            text,
            size: 11,
            anchor: Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle',
            baseline: 'middle',
            style: { fill: TEXT },
          });
        }
      });
      if (spec.center === 'value' || spec.center === 'percent') {
        const figure = spec.center === 'percent' ? g.sum / g.whole : g.sum;
        const text =
          spec.labelFormat !== undefined
            ? BC.formatter(spec.labelFormat as BC.FormatSpec | string)(figure)
            : spec.center === 'percent'
              ? `${Math.round(figure * 100)}%`
              : BC.formatter('compact')(figure);
        // large, but with air around it in the hole: under half its radius, narrower if the text is long
        const room = g.r0 > 0 ? g.r0 : g.R * 0.6;
        let size = clamp(room * 0.45, 10, 44);
        const wide = ctx.measure(text, size).w;
        if (wide > room * 1.6) size = Math.max(10, (size * room * 1.6) / wide);
        // a ring has its middle in the hole; an arc open at the bottom (a gauge) stands its figure on the center line
        const six = Math.PI / 2 + Math.ceil((g.start - Math.PI / 2) / TAU) * TAU;
        const below = six <= g.end;
        out.push({
          type: 'text',
          x: r2(g.cx),
          y: r2(below ? g.cy : g.cy - 4),
          text,
          size: r2(size),
          weight: 650,
          anchor: 'middle',
          baseline: below ? 'middle' : 'auto',
          style: { fill: VALUE },
          cls: 'bc-arc-center',
        });
      }
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
    color(spec, ctx, index, row) {
      const g = geometry(spec, ctx);
      const n = g ? g.slices.findIndex((s) => s.row === row) : -1;
      return n < 0 ? '' : fillOf(spec, ctx, index, row, n);
    },
  };

  BC.define(def);
})();
