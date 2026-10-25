(function () {
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;
  const YEAR = 365.25 * D;
  const MONTH = YEAR / 12;
  const FIXED = [1 * S, 5 * S, 15 * S, 30 * S, M, 5 * M, 15 * M, 30 * M, H, 3 * H, 6 * H, 12 * H, D, 2 * D, 7 * D];
  const MONTHS = [1, 3, 6];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // 1970-01-01 is a Thursday; shift 7-day steps so weeks start on Monday.
  const WEEK_OFFSET = 4 * D;

  /** The last moment a Date can hold, ms either side of 1970. A number past it is not a time (nanoseconds, say). */
  const MAX_MS = 8.64e15;
  /** More ticks than any axis can show: a guard, so a degenerate domain cannot make the tick loops run away. */
  const MAX_TICKS = 1000;

  const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

  /** Numbers are epoch milliseconds; strings are parsed as ISO dates (date-only = UTC midnight). */
  function toMs(v: unknown): number {
    if (typeof v === 'number') return Math.abs(v) <= MAX_MS ? v : NaN;
    if (typeof v === 'string') return Date.parse(v);
    if (v && typeof (v as Date).getTime === 'function') return (v as Date).getTime();
    return NaN;
  }

  function niceYears(span: number, count: number): number {
    const raw = span / YEAR / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const f = raw / pow;
    return Math.max(1, (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow);
  }

  function labelFixed(t: number, step: number): string {
    const d = new Date(t);
    if (step >= D) return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
    const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    return step < M ? `${hm}:${pad2(d.getUTCSeconds())}` : hm;
  }

  function makeTicks(d0: number, d1: number, count: number): { t: number; label: string }[] {
    const out: { t: number; label: string }[] = [];
    // a view that does not parse (NaN) or runs backwards has no ticks
    if (!isFinite(d0) || !isFinite(d1) || d1 < d0) return out;
    const span = d1 - d0;
    const fixed = FIXED.find((f) => span / f <= count);
    if (fixed !== undefined) {
      const off = fixed === 7 * D ? WEEK_OFFSET : 0;
      for (let t = Math.ceil((d0 - off) / fixed) * fixed + off; t <= d1 && out.length < MAX_TICKS; t += fixed) out.push({ t, label: labelFixed(t, fixed) });
      return out;
    }
    const k = MONTHS.find((m) => span / (m * MONTH) <= count);
    if (k !== undefined) {
      const first = new Date(d0);
      let idx = Math.ceil((first.getUTCFullYear() * 12 + first.getUTCMonth()) / k) * k;
      for (; out.length < MAX_TICKS; idx += k) {
        const t = Date.UTC(Math.floor(idx / 12), idx % 12, 1);
        if (!isFinite(t) || t > d1) break;
        if (t < d0) continue;
        out.push({ t, label: `${MON[idx % 12]} ${Math.floor(idx / 12)}` });
      }
      return out;
    }
    const years = niceYears(span, count);
    for (let y = Math.ceil(new Date(d0).getUTCFullYear() / years) * years; out.length < MAX_TICKS; y += years) {
      // past the last year a Date can hold, Date.UTC is NaN: stop there
      const t = Date.UTC(y, 0, 1);
      if (!isFinite(t) || t > d1) break;
      if (t < d0) continue;
      out.push({ t, label: String(y) });
    }
    return out;
  }

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'time',
    version: 2,
    doc: 'Time scale in UTC. Values: epoch milliseconds, ISO date strings or Dates. Ticks snap to calendar units (seconds … years). Numbers beyond the range of dates (nanoseconds, say) are not times: when none of the numbers is one, the chart reports it.',
    params: {
      padding: { kind: 'number', default: 0, doc: 'Extra room around the data extent, as a fraction of its span.' },
    },
    create(spec, ctx) {
      let b0: number, b1: number;
      if (spec.domain && spec.domain.length === 2) {
        b0 = toMs(spec.domain[0]);
        b1 = toMs(spec.domain[1]);
        if (!isFinite(b0) || !isFinite(b1)) throw new Error(`scale.time: domain must be two dates (ISO strings such as "2024-01-01", or epoch milliseconds), got ${JSON.stringify(spec.domain)}`);
      } else {
        b0 = Infinity;
        b1 = -Infinity;
        let outOfRange = 0;
        for (const col of ctx.sources) {
          for (let i = 0; i < col.length; i++) {
            const t = toMs(col[i]);
            if (!isFinite(t)) {
              if (typeof col[i] === 'number' && isFinite(col[i] as number)) outOfRange++;
              continue;
            }
            if (t < b0) b0 = t;
            if (t > b1) b1 = t;
          }
        }
        if (b0 > b1) {
          // numbers, and not one of them a date: almost always a time in another unit
          if (outOfRange) throw new Error('scale.time: the numbers are outside the range of dates; a time scale reads epoch milliseconds (from nanoseconds divide by 1e6, from seconds multiply by 1000)');
          b0 = 0;
          b1 = D;
        }
        if (b0 === b1) {
          b0 -= D / 2;
          b1 += D / 2;
        }
        if (typeof spec.padding === 'number' && spec.padding > 0) {
          const pad = (b1 - b0) * spec.padding;
          b0 -= pad;
          b1 += pad;
        }
      }
      let d0 = b0;
      let d1 = b1;
      let r0 = Number(ctx.range[0]);
      let r1 = Number(ctx.range[1]);

      const scale = ((v: unknown) => r0 + ((toMs(v) - d0) / (d1 - d0)) * (r1 - r0)) as unknown as BC.Scale<unknown, number>;
      Object.defineProperties(scale, {
        kind: { value: 'time' },
        domain: { value: () => [d0, d1] },
        baseDomain: { value: () => [b0, b1] },
        setDomain: {
          value: (d: unknown[] | null) => {
            d0 = d ? toMs(d[0]) : b0;
            d1 = d ? toMs(d[1]) : b1;
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
          value: (approxCount: number = 6): BC.Tick[] =>
            makeTicks(d0, d1, Math.max(1, approxCount)).map((k) => ({ value: k.t, pos: scale(k.t), label: k.label })),
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
