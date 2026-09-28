(function () {
  const KINDS = ['band', 'linear', 'time'];
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /** The segment a row draws, in px, or null. A channel on a band scale spans (a share of) the band; a continuous channel
   *  with its `2` partner spans between the two; a continuous channel alone is a position the other axis runs across. */
  function segments(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number) {
    const n = ctx.table.length;
    // a constant is a value in the data's terms ({ value: 50000 } is 50 000 on the y scale), not a pixel position
    const resolve = (name: string, scaleName: string): BC.ChannelData | null => {
      const v = spec[name];
      if (v === undefined) return null;
      if (v && typeof v === 'object' && (v as { field?: unknown }).field === undefined && (v as { value?: unknown }).value !== undefined) {
        const o = v as { value: unknown; scale?: unknown };
        const scale = ctx.scales[typeof o.scale === 'string' ? o.scale : scaleName];
        if (!scale) return null;
        const px = scale(o.value);
        const mapped = new Array(n).fill(px);
        return { raw: new Array(n).fill(o.value), mapped, scale };
      }
      return ctx.channel(spec, name);
    };
    const cx = resolve('x', 'x');
    const cy = resolve('y', 'y');
    const cx2 = resolve('x2', 'x');
    const cy2 = resolve('y2', 'y');
    const share = typeof spec.thickness === 'number' && spec.thickness > 0 ? Math.min(1, spec.thickness) : 0.7;
    const { x, y, w, h } = ctx.plot;
    const span = (c: BC.ChannelData | null, c2: BC.ChannelData | null, i: number, lo: number, hi: number): [number, number] | null => {
      if (!c) return [lo, hi];
      const a = c.mapped[i];
      if (!isFinite(a)) return null;
      const bw = c.scale ? c.scale.bandwidth : undefined;
      if (bw !== undefined) {
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
      const sx = span(cx, cx2, i, x, x + w);
      const sy = span(cy, cy2, i, y + h, y);
      if (!sx || !sy) return null;
      // a point (both continuous, no partner) is not a rule
      if (sx[0] === sx[1] && sy[0] === sy[1]) return null;
      return [sx[0], sy[0], sx[1], sy[1]];
    };
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'rule',
    version: 1,
    doc: 'Lines at values: a target, a threshold, an average, the target tick of a bullet chart. `y` alone draws a horizontal line across the plot at that value (`{ "value": 50000 }` for a constant, in the units of the y scale — keep it inside the scale domain); `x` alone a vertical one. On a band scale the line spans the band (`thickness` of it), so y = category and x = target gives a short tick across each bar. With x2 / y2 it runs between two values. The same line is drawn once however many rows repeat it.',
    params: {
      stroke: { kind: 'string', doc: 'Any CSS color. Default: the theme text color.' },
      strokeWidth: { kind: 'number', default: 2 },
      dash: { kind: 'list', doc: 'Dash pattern, e.g. [4, 3].' },
      opacity: { kind: 'number', default: 1 },
      thickness: { kind: 'number', default: 0.7, doc: 'On a band scale, the share of the band the line spans (1 = the whole band).' },
      label: { kind: 'string', doc: 'Text at the end of the line ("Target 50K").' },
    },
    channels: {
      x: { scales: KINDS },
      y: { scales: KINDS },
      x2: { scales: ['linear', 'time'], sharesScale: 'x', doc: 'Other end along x.' },
      y2: { scales: ['linear', 'time'], sharesScale: 'y', doc: 'Other end along y.' },
      color: { scales: ['color'], doc: 'Line color per row, from a color scale.' },
    },
    render(spec, ctx, index) {
      if (spec.x === undefined && spec.y === undefined) return [];
      const seg = segments(spec, ctx, index);
      const stroke = typeof spec.stroke === 'string' ? spec.stroke : 'var(--bc-text, #444)';
      const width = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 2;
      const dash = Array.isArray(spec.dash) ? (spec.dash as number[]) : undefined;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const label = typeof spec.label === 'string' ? spec.label : '';
      const seen = new Set<string>();
      const out: BC.Prim[] = [];
      const { from, to } = ctx.rows(spec);
      for (let i = from; i < to; i++) {
        const s = seg(i);
        if (!s) continue;
        const c = colors ? colors[i] : stroke;
        if (!c) continue;
        const key = s.map(r2).join(',') + '|' + c;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          type: 'path',
          d: `M${r2(s[0])} ${r2(s[1])}L${r2(s[2])} ${r2(s[3])}`,
          style: { fill: 'none', stroke: c, strokeWidth: width, strokeDash: dash, opacity, strokeLinecap: 'butt' },
          ref: { mark: index, row: i },
        });
        if (label) {
          // at the right end of a horizontal line, above it; at the top of a vertical one
          const horizontal = Math.abs(s[2] - s[0]) >= Math.abs(s[3] - s[1]);
          out.push(horizontal
            ? { type: 'text', x: Math.max(s[0], s[2]), y: s[1] - 5, text: label, size: 11, weight: 600, anchor: 'end', baseline: 'auto', style: { fill: c } }
            : { type: 'text', x: s[0] + 5, y: Math.min(s[1], s[3]), text: label, size: 11, weight: 600, anchor: 'start', baseline: 'hanging', style: { fill: c } });
        }
      }
      return out;
    },
  };

  BC.define(def);
})();
