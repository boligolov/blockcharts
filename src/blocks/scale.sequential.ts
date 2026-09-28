(function () {
  // viridis, five stops: perceptually even and readable on light and dark backgrounds
  const DEFAULT_RANGE = ['#440154', '#3b528b', '#21908d', '#5dc863', '#fde725'];
  const NONE = '';

  type RGB = [number, number, number];

  function parseColor(c: unknown): RGB {
    const m = typeof c === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim()) : null;
    if (!m) throw new Error(`scale.sequential: range colors must be #rgb or #rrggbb, got ${JSON.stringify(c)} (mixing needs real numbers, so CSS variables and names cannot be used)`);
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  const hex = (n: number) => {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return (v < 16 ? '0' : '') + v.toString(16);
  };

  function niceStep(span: number, count: number): number {
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'sequential',
    version: 1,
    doc: 'Continuous color scale: numbers map to colors along `range` (two or more #hex colors, mixed piecewise-linearly; default viridis). Values outside an explicit `domain` take the end colors; a missing or non-numeric value has no color, and marks do not draw such rows. Use it for heatmaps and for coloring points or bars by a number; for a diverging scale give three colors and a symmetric `domain`.',
    params: {},
    create(spec, ctx) {
      const stops = (Array.isArray(spec.range) && spec.range.length ? spec.range : DEFAULT_RANGE).map(parseColor);
      if (stops.length < 2) throw new Error('scale.sequential: range needs at least two colors');

      let b0: number, b1: number;
      if (spec.domain && spec.domain.length === 2) {
        b0 = Number(spec.domain[0]);
        b1 = Number(spec.domain[1]);
        if (!isFinite(b0) || !isFinite(b1) || b0 === b1) throw new Error('scale.sequential: domain must be [min, max] with min < max');
      } else {
        b0 = Infinity;
        b1 = -Infinity;
        for (const col of ctx.sources) {
          for (let i = 0; i < col.length; i++) {
            const v = col[i];
            if (typeof v !== 'number' || !isFinite(v)) continue;
            if (v < b0) b0 = v;
            if (v > b1) b1 = v;
          }
        }
        if (b0 > b1) {
          b0 = 0;
          b1 = 1;
        }
        if (b0 === b1) {
          b0 -= 0.5;
          b1 += 0.5;
        }
      }
      let d0 = b0;
      let d1 = b1;

      const colorAt = (t: number): string => {
        const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(x));
        const f = x - i;
        const a = stops[i];
        const b = stops[i + 1];
        return '#' + hex(a[0] + (b[0] - a[0]) * f) + hex(a[1] + (b[1] - a[1]) * f) + hex(a[2] + (b[2] - a[2]) * f);
      };

      const scale = ((v: unknown) => (typeof v === 'number' && isFinite(v) ? colorAt((v - d0) / (d1 - d0)) : NONE)) as unknown as BC.Scale<number, string>;
      Object.defineProperties(scale, {
        kind: { value: 'sequential' },
        domain: { value: () => [d0, d1] },
        baseDomain: { value: () => [b0, b1] },
        setDomain: {
          value: (d: number[] | null) => {
            d0 = d ? d[0] : b0;
            d1 = d ? d[1] : b1;
          },
        },
        range: { value: () => stops.map((s) => '#' + hex(s[0]) + hex(s[1]) + hex(s[2])) },
        setRange: { value: () => {} },
        // pos is a fraction of the domain, which is what a legend needs to place its labels along the color bar
        ticks: {
          value: (approxCount: number = 5): BC.Tick[] => {
            const step = niceStep(d1 - d0, approxCount);
            const decimals = Math.max(0, -Math.floor(Math.log10(step)));
            const out: BC.Tick[] = [];
            for (let i = Math.ceil(d0 / step - 1e-9); i <= Math.floor(d1 / step + 1e-9); i++) {
              const value = +(i * step).toFixed(decimals);
              out.push({ value, pos: (value - d0) / (d1 - d0), label: value.toFixed(decimals) });
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
