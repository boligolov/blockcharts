(function () {
  const NICE_COUNT = 6;

  type Ticks = {
    niceStep(span: number, count: number): number;
    roundTicks(d0: number, d1: number, count: number): { value: number; label: string }[];
  };
  /** From lib.ticks, listed in `requires` so it is on the page. */
  const ticks = () => (BC.get('lib.ticks') as BC.LibDef).exports as Ticks;
  const niceStep: Ticks['niceStep'] = (span, count) => ticks().niceStep(span, count);
  const roundTicks: Ticks['roundTicks'] = (d0, d1, count) => ticks().roundTicks(d0, d1, count);

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
    version: 8,
    output: 'position',
    input: 'number',
    merge: 'extent',
    requires: ['lib.ticks'],
    doc: 'Continuous numeric scale. Domain is inferred from bound channels, padded, and extended to nice tick values. An explicit `domain` is two different numbers; [high, low] runs the axis the other way.',
    params: {
      nice: { kind: 'boolean', default: true, doc: 'Extend the inferred domain to round tick values.' },
      zero: { kind: 'boolean', default: false, doc: 'Include 0 in the inferred domain (bars need it).' },
      padding: {
        kind: 'number',
        default: 0,
        doc: 'Extra room around the data extent, as a fraction of its span (0.05 keeps edge points off the axes).',
      },
    },
    create(spec, ctx) {
      let b0: number, b1: number;
      if (spec.domain !== undefined && spec.domain !== null) {
        // a number or a numeric string; Number() would also make 0 of null, '' and false
        const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
        const d: unknown[] = Array.isArray(spec.domain) && spec.domain.length === 2 ? spec.domain : [];
        b0 = num(d[0]);
        b1 = num(d[1]);
        // [high, low] is fine (an axis that runs the other way); one value, or something that is not a number, is not a domain
        if (!isFinite(b0) || !isFinite(b1) || b0 === b1)
          throw new Error(`scale.linear: the domain must be two different numbers, not ${JSON.stringify(spec.domain)}`);
      } else {
        [b0, b1] = extent(ctx.sources);
        if (spec.zero) {
          b0 = Math.min(b0, 0);
          b1 = Math.max(b1, 0);
        }
        // values that differ only by rounding (0.1 + 0.2 and 0.3) are one value: as two ends they made a thousand ticks
        if (b1 - b0 <= 1e-12 * Math.max(Math.abs(b0), Math.abs(b1))) {
          b0 -= 1;
          b1 += 1;
        }
        if (typeof spec.padding === 'number' && spec.padding > 0) {
          const pad = (b1 - b0) * spec.padding;
          // `zero` is a floor: room around the data must not take the axis past it
          b0 = spec.zero && b0 === 0 ? 0 : b0 - pad;
          b1 = spec.zero && b1 === 0 ? 0 : b1 + pad;
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

      const scale = ((v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)) as unknown as BC.ScaleMapping<number, number>;
      Object.defineProperties(scale, {
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
          value: (approxCount: number = NICE_COUNT): BC.Tick[] =>
            roundTicks(d0, d1, approxCount).map((t) => ({ ...t, pos: scale(t.value) })),
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
