(function () {
  const NICE_COUNT = 6;
  const lg = Math.log10;

  function fail(message: string): never {
    throw new Error('scale.log: ' + message);
  }

  /** Smallest and largest positive value; zero and negatives have no place on a log scale. */
  function extent(sources: readonly BC.Column[]): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const col of sources) {
      for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (typeof v !== 'number' || !(v > 0) || v === Infinity) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }

  const label = (v: number) => (v >= 1 ? BC.formatter({ notation: 'compact', maximumSignificantDigits: 3 })(v) : String(+v.toPrecision(3)));
  /** Below this many decades, whole powers of ten would leave much of the plot empty. */
  const FEW_DECADES = 2;
  const round125 = (v: number, up: boolean): number => {
    const p = Math.pow(10, Math.floor(lg(v) + 1e-9));
    const m = v / p;
    const steps = [1, 2, 5, 10];
    return (
      p *
      (up
        ? steps.find((s) => s >= m - 1e-9)
        : steps
            .slice()
            .reverse()
            .find((s) => s <= m + 1e-9))!
    );
  };

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'log',
    version: 4,
    output: 'position',
    input: 'number',
    merge: 'extent',
    doc: 'Logarithmic numeric scale (base 10): equal steps for equal ratios, so 10 → 100 is as long as 100 → 1,000. For values that span several orders of magnitude (company sizes, populations) or growth compared as rates. Only positive values have a place on it: zero, negatives and missing values are left out (a line breaks there), and the domain is inferred from the positive ones. `nice` extends it to whole powers of ten, or to 1, 2 or 5 of a power when the data spans less than two of them. Ticks are the powers of ten, with 2 and 5 between them when the domain spans few of them; their labels are compact (1K, 10K, 1M) unless the axis has a `format`. Bars on a log scale start at the bottom of the domain.',
    params: {
      nice: { kind: 'boolean', default: true, doc: 'Extend the inferred domain to round values.' },
    },
    create(spec, ctx) {
      let b0: number, b1: number;
      if (spec.domain && spec.domain.length === 2) {
        b0 = Number(spec.domain[0]);
        b1 = Number(spec.domain[1]);
        if (!(b0 > 0 && b1 > 0 && isFinite(b0) && isFinite(b1)))
          fail(`the domain must be two positive numbers, not [${spec.domain.join(', ')}]`);
      } else {
        const e = extent(ctx.sources);
        [b0, b1] = e || [1, 10];
        if (b0 === b1) {
          b0 /= 10;
          b1 *= 10;
        }
        if (spec.nice !== false) {
          const few = lg(b1) - lg(b0) < FEW_DECADES;
          b0 = few ? round125(b0, false) : Math.pow(10, Math.floor(lg(b0) + 1e-9));
          b1 = few ? round125(b1, true) : Math.pow(10, Math.ceil(lg(b1) - 1e-9));
        }
      }
      let d0 = b0;
      let d1 = b1;
      let r0 = Number(ctx.range[0]);
      let r1 = Number(ctx.range[1]);

      const scale = ((v: number) => (v > 0 ? r0 + ((lg(v) - lg(d0)) / (lg(d1) - lg(d0))) * (r1 - r0) : NaN)) as unknown as BC.ScaleMapping<
        number,
        number
      >;
      Object.defineProperties(scale, {
        domain: { value: () => [d0, d1] },
        baseDomain: { value: () => [b0, b1] },
        setDomain: {
          value: (d: number[] | null) => {
            d0 = d && d[0] > 0 ? d[0] : b0;
            d1 = d && d[1] > 0 ? d[1] : b1;
          },
        },
        range: { value: () => [r0, r1] },
        setRange: {
          value: (r: number[]) => {
            r0 = r[0];
            r1 = r[1];
          },
        },
        invert: { value: (px: number) => Math.pow(10, lg(d0) + ((px - r0) / (r1 - r0)) * (lg(d1) - lg(d0))) },
        ticks: {
          value: (approxCount: number = NICE_COUNT): BC.Tick[] => {
            const lo = Math.min(d0, d1);
            const hi = Math.max(d0, d1);
            const p0 = Math.floor(lg(lo) + 1e-9);
            const p1 = Math.ceil(lg(hi) - 1e-9);
            const decades = Math.max(1, p1 - p0);
            const count = Math.max(1, approxCount);
            // few decades: 1, 2, 5 of each; many: every power of ten, or every k-th so the count stays near approxCount
            const steps = decades * 3 <= count ? [1, 2, 5] : decades * 2 <= count ? [1, 3] : [1];
            const every = steps.length === 1 ? Math.max(1, Math.ceil(decades / count)) : 1;
            const out: BC.Tick[] = [];
            for (let p = p0; p <= p1; p++) {
              if ((p - p0) % every) continue;
              for (const m of steps) {
                const value = +(m * Math.pow(10, p)).toPrecision(12);
                if (value < lo * (1 - 1e-9) || value > hi * (1 + 1e-9)) continue;
                out.push({ value, pos: scale(value), label: label(value) });
              }
            }
            // a domain inside one decade (say 20 to 80) has no power of ten in it: fall back to its two ends
            if (out.length < 2) return [lo, hi].map((value) => ({ value, pos: scale(value), label: label(value) }));
            return out;
          },
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
