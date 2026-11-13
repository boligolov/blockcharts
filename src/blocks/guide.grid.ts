(function (BC: BC.Runtime) {
  const def: BC.GuideDef = {
    role: 'guide',
    type: 'grid',
    version: 3,
    narrow: true,
    doc: 'Grid lines at the ticks of a positional scale (the same ticks its axis shows). Draws behind the marks. An axis given `count` needs the same `count` here, or the lines and the labels part.',
    params: {
      scale: { kind: 'scale', required: true },
      count: { kind: 'number', doc: 'About how many lines: the `count` of the axis on the same scale.' },
    },
    render(spec, ctx) {
      const name = spec.scale;
      if (!name) return {};
      const vertical = ctx.orientation(name) === 'vertical';
      const { x, y, w, h } = ctx.plot;
      let d = '';
      const wish = typeof spec.count === 'number' && spec.count >= 1 ? Math.round(spec.count) : undefined;
      for (const t of wish === undefined ? ctx.ticks(name) : ctx.ticks(name, wish)) {
        d += vertical ? `M${x} ${t.pos}H${x + w}` : `M${t.pos} ${y}V${y + h}`;
      }
      if (!d) return {};
      return { grid: [{ type: 'path', d, cls: 'bc-grid', style: { fill: 'none', stroke: 'var(--bc-grid, #e6e6e6)', strokeWidth: 1 } }] };
    },
  };

  BC.define(def);
})((globalThis as any).BC);
