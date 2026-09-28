(function () {
  const def: BC.GuideDef = {
    role: 'guide',
    type: 'grid',
    version: 1,
    doc: 'Grid lines at the ticks of a positional scale (the same ticks its axis shows). Draws behind the marks.',
    params: {
      scale: { kind: 'scale', required: true },
    },
    render(spec, ctx) {
      const name = spec.scale;
      if (!name) return {};
      const vertical = ctx.orientation(name) === 'vertical';
      const { x, y, w, h } = ctx.plot;
      let d = '';
      for (const t of ctx.ticks(name)) {
        d += vertical ? `M${x} ${t.pos}H${x + w}` : `M${t.pos} ${y}V${y + h}`;
      }
      if (!d) return {};
      return { grid: [{ type: 'path', d, cls: 'bc-grid', style: { fill: 'none', stroke: 'var(--bc-grid, #e6e6e6)', strokeWidth: 1 } }] };
    },
  };

  BC.define(def);
})();
