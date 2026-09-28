(function () {
  const KINDS = ['band', 'linear', 'time'];

  interface Dodge {
    col: BC.Column;
    order: Map<unknown, number>;
    padding: number;
  }

  /** First-appearance order of the distinct `dodge` values among the visible rows, or null (nothing to dodge:
   *  no `dodge` field, or every row shares one value). Shared by render and pick so a click hits what is drawn. */
  function dodgeOf(ctx: BC.ChartCtx, spec: BC.MarkSpec, from: number, to: number): Dodge | null {
    if (spec.dodge === undefined) return null;
    const col = ctx.channel(spec, 'dodge').raw;
    const order = new Map<unknown, number>();
    for (let i = from; i < to; i++) {
      const v = col[i];
      if (v == null || order.has(v)) continue;
      order.set(v, order.size);
    }
    if (order.size <= 1) return null;
    const padding = typeof spec.dodgePadding === 'number' ? Math.max(0, Math.min(0.9, spec.dodgePadding)) : 0.1;
    return { col, order, padding };
  }

  /** Start and size of the rectangle along one axis, in pixels, or null when the row has no valid extent. On the
   *  band-scale axis, `dodge` (if given) splits the band into one equal, gapped sub-band per distinct dodge value —
   *  a row whose dodge value never appeared among the visible rows (nullish) has no extent, like a missing channel. */
  function axis(ctx: BC.ChartCtx, spec: BC.MarkSpec, name: string, baseline: number, dodge: Dodge | null) {
    const share = typeof spec.thickness === 'number' && spec.thickness > 0 ? Math.min(1, spec.thickness) : 1;
    const main = ctx.channel(spec, name);
    const end = ctx.channel(spec, name + '2');
    const bw = main.scale ? main.scale.bandwidth : undefined;
    // Without a second channel a continuous axis grows from the baseline (bars).
    const base = !end.raw.length && bw === undefined && main.scale ? main.scale(baseline) : NaN;
    return (i: number): [number, number] | null => {
      const a = main.mapped[i];
      let start: number, size: number;
      if (bw !== undefined) {
        if (dodge) {
          const gi = dodge.order.get(dodge.col[i]);
          if (gi === undefined) return null;
          const sub = bw / dodge.order.size;
          const gap = sub * dodge.padding;
          start = a + gi * sub + gap / 2;
          size = sub - gap;
        } else {
          start = a + (bw * (1 - share)) / 2;
          size = bw * share;
        }
      } else if (end.raw.length) {
        start = Math.min(a, end.mapped[i]);
        size = Math.abs(end.mapped[i] - a);
      } else {
        start = Math.min(a, base);
        size = Math.abs(a - base);
      }
      return isFinite(start) && isFinite(size) ? [start, size] : null;
    };
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'rect',
    version: 8,
    doc: 'Rectangles. On a band scale a channel spans the band; on a continuous scale it spans from `<channel>2` (or from `baseline`) to the value. bar = band + linear; range bar = x/x2. `dodge` turns a bar chart into a grouped one: it splits each band into one bar per distinct value of the field, side by side (for a stacked bar, use `color` with transform.stack instead — dodge and stack are different arrangements of the same `color`/grouping field).',
    params: {
      baseline: { kind: 'number', default: 0, doc: 'Where bars start on a continuous axis without a second channel. Keep it inside the scale domain (scale `zero: true` for 0).' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: theme color by mark index.' },
      opacity: { kind: 'number', default: 1 },
      radius: { kind: 'number', default: 0, doc: 'Corner radius in px.' },
      thickness: { kind: 'number', default: 1, doc: 'Share of the band a bar fills, centered (0.4 = a slim bar; a bullet chart draws the value slimmer than the ranges behind it).' },
      dodgePadding: { kind: 'number', default: 0.1, doc: 'Gap between the bars of one dodged category, as a fraction of each bar\'s share of the band.' },
    },
    channels: {
      x: { required: true, scales: KINDS },
      y: { required: true, scales: KINDS },
      x2: { scales: ['linear', 'time'], sharesScale: 'x', doc: 'Other end of the rectangle along x.' },
      y2: { scales: ['linear', 'time'], sharesScale: 'y', doc: 'Other end of the rectangle along y.' },
      color: { scales: ['color', 'sequential'], doc: 'Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn.' },
      dodge: { unscaled: true, doc: 'Field that splits the band-scale axis into side-by-side bars, one per distinct value (grouped bar). Usually the same field as `color`. One distinct value (or none) draws a plain bar, unchanged.' },
    },
    render(spec, ctx, index) {
      const baseline = typeof spec.baseline === 'number' ? spec.baseline : 0;
      const fill = typeof spec.fill === 'string' ? spec.fill : ctx.color(index);
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const r = typeof spec.radius === 'number' && spec.radius > 0 ? spec.radius : undefined;
      const { from, to } = ctx.rows(spec);
      const dodge = dodgeOf(ctx, spec, from, to);
      const ax = axis(ctx, spec, 'x', baseline, dodge);
      const ay = axis(ctx, spec, 'y', baseline, dodge);
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const out: BC.Prim[] = [];
      for (let i = from; i < to; i++) {
        const hx = ax(i);
        const hy = ay(i);
        if (!hx || !hy) continue;
        const c = colors ? colors[i] : fill;
        if (!c) continue;
        out.push({ type: 'rect', x: hx[0], y: hy[0], w: hx[1], h: hy[1], r, style: { fill: c, opacity }, ref: { mark: index, row: i } });
      }
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const baseline = typeof spec.baseline === 'number' ? spec.baseline : 0;
      const { from, to } = ctx.rows(spec);
      const dodge = dodgeOf(ctx, spec, from, to);
      const ax = axis(ctx, spec, 'x', baseline, dodge);
      const ay = axis(ctx, spec, 'y', baseline, dodge);
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const SLACK = 2;
      // the last row is drawn on top, so it wins where rectangles overlap
      for (let i = to - 1; i >= from; i--) {
        if (colors && !colors[i]) continue;
        const hx = ax(i);
        const hy = ay(i);
        if (!hx || !hy) continue;
        if (px >= hx[0] - SLACK && px <= hx[0] + hx[1] + SLACK && py >= hy[0] - SLACK && py <= hy[0] + hy[1] + SLACK) {
          return { row: i, x: hx[0] + hx[1] / 2, y: hy[0], dist: 0, box: { x: hx[0], y: hy[0], w: hx[1], h: hy[1] } };
        }
      }
      return null;
    },
  };

  BC.define(def);
})();
