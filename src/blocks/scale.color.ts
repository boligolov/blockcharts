(function () {
  function unique(sources: readonly BC.Column[]): unknown[] {
    const seen = new Set<unknown>();
    const out: unknown[] = [];
    for (const col of sources) {
      for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (v == null || (typeof v === 'number' && isNaN(v)) || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  }

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'color',
    version: 2,
    doc: 'Categorical color scale: one color per distinct value, in first-seen order. Colors come from `range` (a list of CSS colors) or from the theme palette (--bc-c0 …). Colors stay tied to the value when the domain is narrowed (setView, a legend filter); a value outside the visible domain gets no color, so marks do not draw it.',
    create(spec, ctx) {
      const base = spec.domain ? spec.domain.slice() : unique(ctx.sources);
      let view = base;
      let visible: Set<unknown> | null = null; // null = everything
      const colors = Array.isArray(spec.range) && spec.range.length ? spec.range.map(String) : null;
      const at = (i: number) => (colors ? colors[i % colors.length] : ctx.color(i));
      const index = new Map<unknown, number>();
      base.forEach((v, i) => index.set(v, i));

      const scale = ((v: unknown) => {
        const i = index.get(v);
        if (i === undefined) return 'var(--bc-axis, #999)';
        return visible && !visible.has(v) ? '' : at(i);
      }) as unknown as BC.Scale<unknown, string>;
      Object.defineProperties(scale, {
        kind: { value: 'color' },
        domain: { value: () => view.slice() },
        baseDomain: { value: () => base.slice() },
        setDomain: {
          value: (d: unknown[] | null) => {
            view = d ? d.slice() : base;
            visible = d ? new Set(view) : null;
          },
        },
        range: { value: () => base.map((_, i) => at(i)) },
        setRange: { value: () => {} },
      });
      return scale;
    },
  };

  BC.define(def);
})();
