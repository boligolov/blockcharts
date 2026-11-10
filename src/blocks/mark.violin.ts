(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const CARD = 'var(--bc-tooltip-bg, #fff)';

  interface Shape {
    /** Rows of one category, in the order of their value on the value axis. */
    rows: number[];
    /** Where the shape stands across the band: its middle (both sides) or its base (one side), px. */
    at: number;
    /** Half the width (both sides) or the height (one side) of every row, px. */
    w: Float64Array;
    color: string;
  }
  interface Layout {
    /** true: the categories are on x and the shapes stand up (a violin); false: on y, lying down (a ridgeline). */
    upright: boolean;
    /** Position of each row along the value axis, px. */
    v: Float64Array;
    both: boolean;
    shapes: Shape[];
  }

  /** Shared by render and pick, so that what is drawn is what is hit. */
  function layout(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number): Layout {
    const cx = ctx.channel(spec, 'x');
    const cy = ctx.channel(spec, 'y');
    const upright = !!(cx.scale && cx.scale.bandwidth !== undefined);
    if (!upright && !(cy.scale && cy.scale.bandwidth !== undefined))
      throw new Error('mark.violin: put the categories on a band scale, x for violins standing up or y for ridges lying down');
    const cat = upright ? cx : cy;
    const val = upright ? cy : cx;
    const dens = ctx.channel(spec, 'density').raw;
    const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
    const bw = cat.scale!.bandwidth as number;
    const both = spec.side !== 'one';
    const extent = typeof spec.extent === 'number' && spec.extent > 0 ? spec.extent : both ? 0.9 : 1.6;
    const fill = typeof spec.fill === 'string' ? spec.fill : '';
    const { from, to } = ctx.rows(spec);
    const n = val.mapped.length;
    const v = new Float64Array(n);
    const groups = new Map<number, number[]>();
    for (let i = from; i < to; i++) {
      const p = cat.mapped[i];
      const d = dens[i];
      v[i] = val.mapped[i];
      if (!isFinite(p) || !isFinite(v[i]) || typeof d !== 'number' || !isFinite(d) || d < 0) continue;
      if (colors && !colors[i]) continue; // a category the legend hides
      const g = groups.get(p);
      if (g) g.push(i);
      else groups.set(p, [i]);
    }
    // the widest point of all shapes fills `extent` of the band, so shapes compare; "each" fits every shape on its own
    let top = 0;
    groups.forEach((rows) => rows.forEach((i) => (top = Math.max(top, dens[i] as number))));
    const shapes: Shape[] = [];
    [...groups.keys()]
      .sort((a, b) => a - b)
      .forEach((p) => {
        const rows = (groups.get(p) as number[]).sort((a, b) => v[a] - v[b] || a - b);
        const own = spec.normalize === 'each' ? rows.reduce((m, i) => Math.max(m, dens[i] as number), 0) : top;
        const full = (both ? bw / 2 : bw) * extent;
        const w = new Float64Array(n);
        for (const i of rows) w[i] = own > 0 ? ((dens[i] as number) / own) * full : 0;
        shapes.push({
          rows,
          // a ridge sits on the bottom of its band and rises; a violin is centered on its band
          at: both ? p + bw / 2 : upright ? p : p + bw,
          w,
          color: colors ? colors[rows[0]] : fill || ctx.color(index),
        });
      });
    return { upright, v, both, shapes };
  }

  /** A point of the outline: `side` +1 is the right of a violin or the top of a ridge, -1 the other side. */
  function point(l: Layout, s: Shape, i: number, side: number): [number, number] {
    // a ridge grows up the screen, which is towards smaller y; a violin and an upright one-sided shape grow right
    const across = l.both ? s.at + side * s.w[i] : l.upright ? s.at + (side > 0 ? s.w[i] : 0) : s.at - (side > 0 ? s.w[i] : 0);
    return l.upright ? [across, l.v[i]] : [l.v[i], across];
  }

  function outline(l: Layout, s: Shape): string {
    const pts = (side: number, rows: number[]) => rows.map((i) => point(l, s, i, side).map(r2).join(' '));
    const fwd = pts(1, s.rows);
    const back = pts(-1, s.rows.slice().reverse());
    return 'M' + fwd.join('L') + 'L' + back.join('L') + 'Z';
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'violin',
    version: 3,
    doc: 'The shape of a distribution per category, from the rows of transform.density (one row per point of a curve): a violin, mirrored on both sides of its band, or with `side: "one"` a ridge standing on the bottom of its band and rising into the one above (a ridgeline, joy plot). Put the categories on a band scale: on x the violins stand up and the value runs along y; on y the shapes lie down and the value runs along x (the usual ridgeline). All shapes share one width scale, so a wider shape is a denser spot; `normalize: "each"` fits every shape to its band instead. Shapes further down are drawn over the ones above them.',
    params: {
      side: {
        kind: 'enum',
        values: ['both', 'one'],
        default: 'both',
        doc: '"both": a violin, the curve mirrored around the middle of the band. "one": a ridge on one side, rising from the bottom of the band (on a band y) or from its left (on a band x).',
      },
      extent: {
        kind: 'number',
        doc: 'How much of the band the widest point fills: default 0.9 for a violin, 1.6 for a ridge (above 1 a ridge rises into the band above it, as ridgelines do).',
      },
      normalize: {
        kind: 'enum',
        values: ['all', 'each'],
        default: 'all',
        doc: '"all": one width scale for every shape, so they compare. "each": every shape as tall as its band, to read shapes rather than sizes.',
      },
      fill: { kind: 'color', doc: 'Any CSS color, when there is no color channel. Default: the first theme color.' },
      opacity: { kind: 'number', default: 0.85, doc: 'Fill opacity.' },
      stroke: {
        kind: 'string',
        doc: 'Outline color. Default: none for a violin; the card color for a ridge, so a ridge in front stands apart from the one behind it.',
      },
      strokeWidth: { kind: 'number', default: 1.5 },
    },
    channels: {
      x: { required: true, accepts: { output: 'position' }, doc: 'The category (band) for violins, or the value for ridges.' },
      y: { required: true, accepts: { output: 'position' }, doc: 'The value for violins, or the category (band) for ridges.' },
      density: { required: true, unscaled: true, doc: 'Numeric field with the density at each point (`density` of transform.density).' },
      color: { accepts: { output: 'color' }, doc: 'Fill per category, from a color scale; a category the scale hides is not drawn.' },
    },
    render(spec, ctx, index) {
      const l = layout(spec, ctx, index);
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : 0.85;
      const stroke = typeof spec.stroke === 'string' ? spec.stroke : l.both ? undefined : CARD;
      const strokeWidth = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 1.5;
      return l.shapes
        .filter((s) => s.rows.length > 1)
        .map((s): BC.Prim => ({
          type: 'path',
          d: outline(l, s),
          style: { fill: s.color, fillOpacity: opacity, stroke, strokeWidth: stroke ? strokeWidth : undefined },
          ref: { mark: index, row: s.rows[0] },
        }));
    },
    pick(spec, ctx, index, px, py) {
      const l = layout(spec, ctx, index);
      const along = l.upright ? py : px;
      const across = l.upright ? px : py;
      // the shape in front (drawn last) first
      for (let k = l.shapes.length - 1; k >= 0; k--) {
        const s = l.shapes[k];
        if (s.rows.length < 2) continue;
        const first = l.v[s.rows[0]];
        const last = l.v[s.rows[s.rows.length - 1]];
        if (along < Math.min(first, last) || along > Math.max(first, last)) continue;
        let best = s.rows[0];
        for (const i of s.rows) if (Math.abs(l.v[i] - along) < Math.abs(l.v[best] - along)) best = i;
        const w = s.w[best] + 3;
        const inside = l.both
          ? Math.abs(across - s.at) <= w
          : l.upright
            ? across >= s.at - 3 && across <= s.at + w
            : across <= s.at + 3 && across >= s.at - w;
        if (!inside) continue;
        const [x, y] = point(l, s, best, 1);
        return { row: best, x: l.both ? (l.upright ? s.at : x) : x, y: l.both ? (l.upright ? y : s.at) : y, dist: 0 };
      }
      return null;
    },
  };

  BC.define(def);
})();
