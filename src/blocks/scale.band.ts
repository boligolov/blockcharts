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
    type: 'band',
    version: 2,
    doc: 'Categorical scale: one band per distinct value, in first-seen order. Maps a value to the band\'s lower edge; `bandwidth` is the band width. Bands always run in increasing pixel order (left to right, top to bottom), also on a vertical axis, so horizontal bars list their categories from the top. Zoom = a window of categories.',
    params: {
      paddingInner: { kind: 'number', default: 0.2, doc: 'Gap between bands, as a fraction of the step.' },
      paddingOuter: { kind: 'number', default: 0.1, doc: 'Gap before the first and after the last band, as a fraction of the step.' },
    },
    create(spec, ctx) {
      const inner = typeof spec.paddingInner === 'number' ? spec.paddingInner : 0.2;
      const outer = typeof spec.paddingOuter === 'number' ? spec.paddingOuter : 0.1;
      const base: unknown[] = spec.domain ? spec.domain.slice() : unique(ctx.sources);
      let view = base;
      let index = new Map<unknown, number>();
      let r0 = Number(ctx.range[0]);
      let r1 = Number(ctx.range[1]);
      let step = 0;
      let bw = 0;

      const reindex = () => {
        index = new Map();
        view.forEach((v, i) => index.set(v, i));
      };
      const layout = () => {
        step = Math.abs(r1 - r0) / Math.max(1, view.length - inner + 2 * outer);
        bw = step * (1 - inner);
      };
      // Bands run in increasing pixel order, whichever way the range points: on a vertical axis (range
      // bottom → top) the first category is still the topmost, which is how horizontal bars and heatmap rows read.
      const edge = (i: number) => Math.min(r0, r1) + outer * step + i * step;
      reindex();
      layout();

      const scale = ((v: unknown) => {
        const i = index.get(v);
        return i === undefined ? NaN : edge(i);
      }) as unknown as BC.Scale<unknown, number>;

      Object.defineProperties(scale, {
        kind: { value: 'band' },
        bandwidth: { get: () => bw },
        domain: { value: () => view.slice() },
        baseDomain: { value: () => base.slice() },
        setDomain: {
          value: (d: unknown[] | null) => {
            view = d ? d.slice() : base;
            reindex();
            layout();
          },
        },
        range: { value: () => [r0, r1] },
        setRange: {
          value: (r: number[]) => {
            r0 = r[0];
            r1 = r[1];
            layout();
          },
        },
        ticks: {
          value: (approxCount: number = 10): BC.Tick[] => {
            const every = Math.max(1, Math.ceil(view.length / Math.max(1, approxCount)));
            const out: BC.Tick[] = [];
            for (let i = 0; i < view.length; i += every) out.push({ value: view[i], pos: edge(i) + bw / 2, label: String(view[i]) });
            return out;
          },
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
