(function () {
  const NICE_COUNT = 6;

  function niceStep(span: number, count: number): number {
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }

  function extent(sources: readonly BC.Column[]): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const col of sources) {
      for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return lo <= hi ? [lo, hi] : [0, 1];
  }

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'linear',
    version: 2,
    doc: 'Continuous numeric scale. Domain is inferred from bound channels, padded, and extended to nice tick values.',
    params: {
      nice: { kind: 'boolean', default: true, doc: 'Extend the inferred domain to round tick values.' },
      zero: { kind: 'boolean', default: false, doc: 'Include 0 in the inferred domain (bars need it).' },
      padding: { kind: 'number', default: 0, doc: 'Extra room around the data extent, as a fraction of its span (0.05 keeps edge points off the axes).' },
    },
    create(spec, ctx) {
      let b0: number, b1: number;
      if (spec.domain && spec.domain.length === 2) {
        b0 = Number(spec.domain[0]);
        b1 = Number(spec.domain[1]);
      } else {
        [b0, b1] = extent(ctx.sources);
        if (spec.zero) {
          b0 = Math.min(b0, 0);
          b1 = Math.max(b1, 0);
        }
        if (b0 === b1) {
          b0 -= 1;
          b1 += 1;
        }
        if (typeof spec.padding === 'number' && spec.padding > 0) {
          const pad = (b1 - b0) * spec.padding;
          b0 -= pad;
          b1 += pad;
        }
        if (spec.nice !== false) {
          const step = niceStep(b1 - b0, NICE_COUNT);
          b0 = Math.floor(b0 / step + 1e-9) * step;
          b1 = Math.ceil(b1 / step - 1e-9) * step;
        }
      }
      let d0 = b0;
      let d1 = b1;
      let r0 = Number(ctx.range[0]);
      let r1 = Number(ctx.range[1]);

      const scale = ((v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)) as unknown as BC.Scale<number, number>;
      Object.defineProperties(scale, {
        kind: { value: 'linear' },
        domain: { value: () => [d0, d1] },
        baseDomain: { value: () => [b0, b1] },
        setDomain: {
          value: (d: number[] | null) => {
            d0 = d ? d[0] : b0;
            d1 = d ? d[1] : b1;
          },
        },
        range: { value: () => [r0, r1] },
        setRange: {
          value: (r: number[]) => {
            r0 = r[0];
            r1 = r[1];
          },
        },
        invert: { value: (px: number) => d0 + ((px - r0) / (r1 - r0)) * (d1 - d0) },
        ticks: {
          value: (approxCount: number = NICE_COUNT): BC.Tick[] => {
            const step = niceStep(d1 - d0, approxCount);
            const decimals = Math.max(0, -Math.floor(Math.log10(step)));
            const out: BC.Tick[] = [];
            const first = Math.ceil(d0 / step - 1e-9);
            const last = Math.floor(d1 / step + 1e-9);
            for (let i = first; i <= last; i++) {
              const value = +(i * step).toFixed(decimals);
              out.push({ value, pos: scale(value), label: value.toFixed(decimals) });
            }
            return out;
          },
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
