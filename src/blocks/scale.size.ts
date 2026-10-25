(function () {
  const DEFAULT_RANGE = [2, 24];

  function niceStep(span: number, count: number): number {
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'size',
    version: 1,
    doc: 'Numbers to circle radii, so that the area of a circle (not its radius) grows with the value: a bubble chart reads true. `range` is [smallest, largest] radius in px (default [2, 24]). The domain starts at 0 unless `zero` is false, so a value twice as big is a circle twice the area. Missing, non-numeric and negative values have no size, and marks do not draw such rows. Pair with mark.point `size` and a guide.legend on the same scale.',
    params: {
      zero: { kind: 'boolean', default: true, doc: 'Start the domain at 0, so areas are proportional to the values. false: the smallest value gets the smallest radius (shows differences, overstates ratios).' },
    },
    create(spec, ctx) {
      const r = Array.isArray(spec.range) && spec.range.length === 2 ? spec.range.map(Number) : DEFAULT_RANGE;
      if (!r.every((v) => isFinite(v) && v >= 0) || r[0] > r[1]) throw new Error(`scale.size: range must be [smallest, largest] radius in px, got ${JSON.stringify(spec.range)}`);
      let r0 = r[0];
      let r1 = r[1];

      let b0: number, b1: number;
      if (spec.domain && spec.domain.length === 2) {
        b0 = Number(spec.domain[0]);
        b1 = Number(spec.domain[1]);
        if (!isFinite(b0) || !isFinite(b1) || b0 >= b1 || b0 < 0) throw new Error('scale.size: domain must be [min, max] with 0 <= min < max');
      } else {
        b0 = Infinity;
        b1 = -Infinity;
        for (const col of ctx.sources) {
          for (let i = 0; i < col.length; i++) {
            const v = col[i];
            if (typeof v !== 'number' || !isFinite(v) || v < 0) continue;
            if (v < b0) b0 = v;
            if (v > b1) b1 = v;
          }
        }
        if (b0 > b1) {
          b0 = 0;
          b1 = 1;
        }
        if (spec.zero !== false) b0 = 0;
        if (b0 === b1) {
          // one value (or only zeros): a middle-sized circle rather than a division by zero
          b0 = b0 > 0 ? 0 : b0;
          b1 = b1 > 0 ? b1 * 2 : 1;
        }
      }
      let d0 = b0;
      let d1 = b1;

      // the area, r², runs linearly between the two radii; values past the domain take the end sizes
      const scale = ((v: unknown) => {
        if (typeof v !== 'number' || !isFinite(v) || v < 0) return NaN;
        const t = Math.max(0, Math.min(1, (v - d0) / (d1 - d0)));
        return Math.sqrt(r0 * r0 + t * (r1 * r1 - r0 * r0));
      }) as unknown as BC.Scale<number, number>;
      Object.defineProperties(scale, {
        kind: { value: 'size' },
        domain: { value: () => [d0, d1] },
        baseDomain: { value: () => [b0, b1] },
        setDomain: {
          value: (d: number[] | null) => {
            d0 = d ? Number(d[0]) : b0;
            d1 = d ? Number(d[1]) : b1;
          },
        },
        range: { value: () => [r0, r1] },
        setRange: {
          value: (next: unknown[]) => {
            // the radii are the spec's own; only a list of two numbers can replace them
            if (Array.isArray(next) && next.length === 2 && next.every((v) => typeof v === 'number' && isFinite(v))) {
              r0 = next[0] as number;
              r1 = next[1] as number;
            }
          },
        },
        // a few round values inside the domain, for a legend; pos is the radius
        ticks: {
          value: (approxCount: number = 3): BC.Tick[] => {
            const step = niceStep(d1 - d0, approxCount);
            const decimals = Math.max(0, -Math.floor(Math.log10(step)));
            const out: BC.Tick[] = [];
            for (let i = Math.ceil(d0 / step - 1e-9); i <= Math.floor(d1 / step + 1e-9) && out.length < 50; i++) {
              const value = +(i * step).toFixed(decimals);
              if (value <= 0) continue; // a circle of nothing says nothing
              out.push({ value, pos: scale(value) as number, label: value.toFixed(decimals) });
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
