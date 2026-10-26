(function () {
  const NICE_COUNT = 6;

  function niceStep(span: number, count: number): number {
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }

  /** More ticks than any axis can show: a guard against a span the arithmetic cannot step through. */
  const MAX_TICKS = 1000;

  /** Round values between the two ends of a domain, smallest first, whichever way the domain runs. None for a domain
   *  that has no length (a view zoomed to one value) or is not made of numbers: an empty axis, not an exception. */
  function roundTicks(d0: number, d1: number, count: number): { value: number; label: string }[] {
    const lo = Math.min(d0, d1);
    const hi = Math.max(d0, d1);
    const out: { value: number; label: string }[] = [];
    if (!(isFinite(lo) && isFinite(hi) && hi > lo)) return out;
    const step = niceStep(hi - lo, count);
    if (!(step > 0 && isFinite(step))) return out;
    // toFixed takes at most 100 digits
    const decimals = Math.min(100, Math.max(0, -Math.floor(Math.log10(step))));
    const first = Math.ceil(lo / step - 1e-9);
    const last = Math.floor(hi / step + 1e-9);
    for (let i = first; i <= last && out.length < MAX_TICKS; i++) {
      const value = +(i * step).toFixed(decimals);
      out.push({ value, label: value.toFixed(decimals) });
    }
    return out;
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
    version: 3,
    doc: 'Continuous numeric scale. Domain is inferred from bound channels, padded, and extended to nice tick values. An explicit `domain` is two different numbers; [high, low] runs the axis the other way.',
    params: {
      nice: { kind: 'boolean', default: true, doc: 'Extend the inferred domain to round tick values.' },
      zero: { kind: 'boolean', default: false, doc: 'Include 0 in the inferred domain (bars need it).' },
      padding: { kind: 'number', default: 0, doc: 'Extra room around the data extent, as a fraction of its span (0.05 keeps edge points off the axes).' },
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
        if (!isFinite(b0) || !isFinite(b1) || b0 === b1) throw new Error(`scale.linear: the domain must be two different numbers, not ${JSON.stringify(spec.domain)}`);
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
          value: (approxCount: number = NICE_COUNT): BC.Tick[] => roundTicks(d0, d1, approxCount).map((t) => ({ ...t, pos: scale(t.value) })),
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
