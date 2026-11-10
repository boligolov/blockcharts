(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /** The segment a row draws, in px, or null. A channel on a band scale spans (a share of) the band; a continuous channel
   *  with its `2` partner spans between the two; a continuous channel alone is a position the other axis runs across. */
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
      cross: BC.ChannelData | null,
      i: number,
      lo: number,
      hi: number,
    ): [number, number] | null => {
      if (!c) return [lo, hi];
      const a = c.mapped[i];
      if (!isFinite(a)) return null;
      const bw = c.scale ? c.scale.bandwidth : undefined;
      if (bw !== undefined) {
        // a line from x to x2 is the line of its band, along the middle of it (a range, a dumbbell)
        if (cross) return [a + bw / 2, a + bw / 2];
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
      const sx = span(cx, cx2, cy2, i, x, x + w);
      const sy = span(cy, cy2, cx2, i, y + h, y);
      if (!sx || !sy) return null;
      // a point (both continuous, no partner) is not a rule
      if (sx[0] === sx[1] && sy[0] === sy[1]) return null;
      return [sx[0], sy[0], sx[1], sy[1]];
    };
  }

  /** The lines a rule draws, each once however many rows repeat it: its ends in px, its color and the first row. */
  function lines(spec: BC.MarkSpec, ctx: BC.ChartCtx): { s: [number, number, number, number]; c: string; row: number }[] {
    if (spec.x === undefined && spec.y === undefined) return [];
    const seg = segments(spec, ctx);
    const stroke = typeof spec.stroke === 'string' ? spec.stroke : 'var(--bc-text, #444)';
    const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
    const seen = new Set<string>();
    const out: { s: [number, number, number, number]; c: string; row: number }[] = [];
    const { from, to } = ctx.rows(spec);
    for (let i = from; i < to; i++) {
      const s = seg(i);
      if (!s) continue;
      const c = colors ? colors[i] : stroke;
      if (!c) continue;
      const key = s.map(r2).join(',') + '|' + c;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ s, c, row: i });
    }
    return out;
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'rule',
    version: 8,
    doc: 'Lines at values: a target, a threshold, an average, the target tick of a bullet chart. `y` alone draws a horizontal line across the plot at that value (`{ "value": 50000 }` for a constant, in the units of the y scale); `x` alone a vertical one. On a band scale the line spans the band (`thickness` of it), so y = category and x = target gives a short tick across each bar. With x2 / y2 it runs between two values, along the middle of the band on a band scale (a range, a dumbbell). The same line is drawn once however many rows repeat it.',
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
  };

  BC.define(def);
})();
