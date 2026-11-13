(function (BC: BC.Runtime) {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /** The segment a row draws, in px, or null. A channel on a band scale spans (a share of) the band, or is the middle
   *  of it when the line runs along the band; a continuous channel with its `2` partner spans between the two; a
   *  continuous channel alone is a position the other axis runs across. */
  function segments(spec: BC.MarkSpec, ctx: BC.ChartCtx) {
    const resolve = (name: string): BC.ChannelData | null => (spec[name] === undefined ? null : ctx.channel(spec, name));
    const cx = resolve('x');
    const cy = resolve('y');
    const cx2 = resolve('x2');
    const cy2 = resolve('y2');
    const share = typeof spec.thickness === 'number' && spec.thickness > 0 ? Math.min(1, spec.thickness) : 0.7;
    const { x, y, w, h } = ctx.plot;
    const span = (
      c: BC.ChannelData | null,
      c2: BC.ChannelData | null,
      along: boolean,
      i: number,
      lo: number,
      hi: number,
    ): [number, number] | null => {
      if (!c) return [lo, hi];
      const a = c.mapped[i];
      if (!isFinite(a)) return null;
      const bw = c.scale ? c.scale.bandwidth : undefined;
      if (bw !== undefined) {
        // a line from x to x2 is the line of its band, along the middle of it (a range, a dumbbell); so is a line
        // with nothing on the other axis, which runs across the whole plot
        if (along) return [a + bw / 2, a + bw / 2];
        const inset = (bw * (1 - share)) / 2;
        return [a + inset, a + bw - inset];
      }
      if (c2) {
        const b = c2.mapped[i];
        return isFinite(b) ? [a, b] : null;
      }
      return [a, a];
    };
    return (i: number): [number, number, number, number] | null => {
      const sx = span(cx, cx2, !!cy2 || !cy, i, x, x + w);
      const sy = span(cy, cy2, !!cx2 || !cx, i, y + h, y);
      if (!sx || !sy) return null;
      // a point (both continuous, no partner) is not a rule
      if (sx[0] === sx[1] && sy[0] === sy[1]) return null;
      return [sx[0], sy[0], sx[1], sy[1]];
    };
  }

  /** The color of each row, shared by the lines and `color`: '' where the scale hides it. */
  function paint(spec: BC.MarkSpec, ctx: BC.ChartCtx): (row: number) => string {
    const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
    const stroke = typeof spec.stroke === 'string' ? spec.stroke : 'var(--bc-text, #444)';
    return (row) => (colors ? colors[row] || '' : stroke);
  }

  type Line = { s: [number, number, number, number]; c: string; row: number; rows: number[] };

  /** The lines a rule draws, each once however many rows repeat it: its ends in px, its color, the first row and every
   *  row that draws it. */
  function lines(spec: BC.MarkSpec, ctx: BC.ChartCtx): Line[] {
    if (spec.x === undefined && spec.y === undefined) return [];
    const seg = segments(spec, ctx);
    const colorOf = paint(spec, ctx);
    const seen = new Map<string, Line>();
    const out: Line[] = [];
    const { from, to } = ctx.rows(spec);
    for (let i = from; i < to; i++) {
      const s = seg(i);
      if (!s) continue;
      const c = colorOf(i);
      if (!c) continue;
      const key = s.map(r2).join(',') + '|' + c;
      const known = seen.get(key);
      if (known) {
        known.rows.push(i);
        continue;
      }
      const line = { s, c, row: i, rows: [i] };
      seen.set(key, line);
      out.push(line);
    }
    return out;
  }

  /** How far past its stroke a line is still under the pointer: a whisker 2 px wide is hard to hit. */
  const REACH = 5;
  /** The narrowest the highlight across a line is: one as thin as the line would not show. */
  const BAND = 8;

  /** Whether a column decides where or in what color the rule is drawn. A rule of constants alone (a target, "today")
   *  is the same line on every row and stands for none of them. */
  function readsData(spec: BC.MarkSpec, ctx: BC.ChartCtx): boolean {
    return ['x', 'y', 'x2', 'y2', 'color'].some((name) => spec[name] !== undefined && !!ctx.channel(spec, name).field);
  }

  /** The part of a line inside `r` (Liang–Barsky), or null when none of it is. */
  function clip(s: [number, number, number, number], r: BC.Rect): [number, number, number, number] | null {
    const [x0, y0, x1, y1] = s;
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    const sides: [number, number][] = [
      [-dx, x0 - r.x],
      [dx, r.x + r.w - x0],
      [-dy, y0 - r.y],
      [dy, r.y + r.h - y0],
    ];
    for (const [p, q] of sides) {
      if (p === 0) {
        if (q < 0) return null;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
    return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'rule',
    version: 12,
    // its label is text that needs room; a plain line does not
    narrow: (spec) => typeof spec.label !== 'string' || spec.label === '',
    doc: 'Lines at values: a target, a threshold, an average, the target tick of a bullet chart. `y` alone draws a horizontal line across the plot at that value (`{ "value": 50000 }` for a constant, in the units of the y scale); `x` alone a vertical one, through the middle of its band on a band scale. With both, on a band scale the line spans the band (`thickness` of it), so y = category and x = target gives a short tick across each bar. With x2 / y2 it runs between two values, along the middle of the band on a band scale (a range, a dumbbell). The same line is drawn once however many rows repeat it. A tooltip finds a line that reads a column (an error bar, a dumbbell, a lollipop) within a few px of it; a line of constants alone stands for no row and leaves the pointer to the marks under it.',
    params: {
      stroke: { kind: 'color', doc: 'Any CSS color. Default: the theme text color.' },
      strokeWidth: { kind: 'number', default: 2 },
      dash: { kind: 'list', doc: 'Dash pattern, e.g. [4, 3].' },
      opacity: { kind: 'number', default: 1 },
      thickness: { kind: 'number', default: 0.7, doc: 'On a band scale, the share of the band the line spans (1 = the whole band).' },
      label: { kind: 'string', doc: 'Text at the end of the line ("Target 50K").' },
    },
    channels: {
      x: { accepts: { output: 'position' } },
      y: { accepts: { output: 'position' } },
      x2: { accepts: { output: 'position', input: ['number', 'date'] }, sharesScale: 'x', doc: 'Other end along x.' },
      y2: { accepts: { output: 'position', input: ['number', 'date'] }, sharesScale: 'y', doc: 'Other end along y.' },
      color: { accepts: { output: 'color', input: ['category'] }, doc: 'Line color per row, from a color scale.' },
    },
    render(spec, ctx, index) {
      const width = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 2;
      const dash = Array.isArray(spec.dash) ? (spec.dash as number[]) : undefined;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      return lines(spec, ctx).map(({ s, c, row }) => ({
        type: 'path',
        d: `M${r2(s[0])} ${r2(s[1])}L${r2(s[2])} ${r2(s[3])}`,
        style: { fill: 'none', stroke: c, strokeWidth: width, strokeDash: dash, opacity, strokeLinecap: 'butt' },
        ref: { mark: index, row },
      }));
    },
    // over every mark, whatever their order (a target line usually crosses the last bar), with a halo in the card color
    // so it reads on a bar; drawn outside the clip, so a line zoomed out of view takes its label with it
    labels(spec, ctx) {
      const label = typeof spec.label === 'string' ? spec.label : '';
      if (!label) return [];
      const { x, y, w, h } = ctx.plot;
      const inside = (px: number, py: number) => px >= x - 0.5 && px <= x + w + 0.5 && py >= y - 0.5 && py <= y + h + 0.5;
      const out: BC.Prim[] = [];
      for (const { s, c } of lines(spec, ctx)) {
        const style: BC.Style = {
          fill: c,
          stroke: 'var(--bc-tooltip-bg, #fff)',
          strokeWidth: 3,
          strokeLinejoin: 'round',
          paintOrder: 'stroke',
        };
        // at the right end of a horizontal line, above it; at the top of a vertical one
        const horizontal = Math.abs(s[2] - s[0]) >= Math.abs(s[3] - s[1]);
        const end = horizontal ? (s[0] >= s[2] ? 0 : 2) : s[1] <= s[3] ? 0 : 2;
        if (!inside(s[end], s[end + 1])) continue;
        out.push(
          horizontal
            ? { type: 'text', x: s[end], y: s[end + 1] - 5, text: label, size: 11, weight: 600, anchor: 'end', baseline: 'auto', style }
            : { type: 'text', x: s[0] + 5, y: s[end + 1], text: label, size: 11, weight: 600, anchor: 'start', baseline: 'hanging', style },
        );
      }
      return out;
    },
    // the line nearest the pointer, within a few px of its stroke: an error bar's whisker, a dumbbell's bar, a
    // lollipop's stem. A line along an axis lights up as a box around it; a slanted one gets the dot where it is nearest.
    pick(spec, ctx, _index, px, py) {
      if (!readsData(spec, ctx)) return null;
      const width = typeof spec.strokeWidth === 'number' && spec.strokeWidth > 0 ? spec.strokeWidth : 2;
      const p = ctx.plot;
      // zoomed, the plot clips what is past its edges: only what the reader sees is picked
      const seen = { x: p.x - 0.5, y: p.y - 0.5, w: p.w + 1, h: p.h + 1 };
      let best: { line: Line; s: [number, number, number, number]; x: number; y: number } | null = null;
      let bestGap = Infinity;
      for (const line of lines(spec, ctx)) {
        const s = clip(line.s, seen);
        if (!s) continue;
        const dx = s[2] - s[0];
        const dy = s[3] - s[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.min(1, Math.max(0, ((px - s[0]) * dx + (py - s[1]) * dy) / len2)) : 0;
        const nx = s[0] + t * dx;
        const ny = s[1] + t * dy;
        const gap = Math.max(0, Math.hypot(px - nx, py - ny) - width / 2);
        // the line drawn last is on top
        if (gap <= bestGap) {
          bestGap = gap;
          best = { line, s, x: nx, y: ny };
        }
      }
      if (!best || bestGap > REACH) return null;
      const { line, s } = best;
      const across = Math.max(BAND, width + 4);
      const left = Math.min(s[0], s[2]);
      const top = Math.min(s[1], s[3]);
      const long = { w: Math.abs(s[2] - s[0]), h: Math.abs(s[3] - s[1]) };
      const box =
        long.h < 0.5
          ? { x: left, y: s[1] - across / 2, w: long.w, h: across }
          : long.w < 0.5
            ? { x: s[0] - across / 2, y: top, w: across, h: long.h }
            : null;
      const pick: BC.Pick = box
        ? { row: line.row, x: box.x + box.w / 2, y: box.y, dist: bestGap, box }
        : { row: line.row, x: best.x, y: best.y, dist: bestGap };
      // one line for several rows (a total repeated on each row of its group): the card shows what they share
      if (line.rows.length > 1) pick.rows = line.rows;
      return pick;
    },
    color(spec, ctx, _index, row) {
      return paint(spec, ctx)(row);
    },
  };

  BC.define(def);
})((globalThis as any).BC);
