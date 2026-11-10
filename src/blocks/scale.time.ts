(function () {
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;
  const YEAR = 365.25 * D;
  const MONTH = YEAR / 12;
  // milliseconds first: a span of a few of them (a trace, a benchmark) had no step that fit, and no ticks
  const FIXED = [
    1,
    2,
    5,
    10,
    20,
    50,
    100,
    200,
    500,
    1 * S,
    5 * S,
    15 * S,
    30 * S,
    M,
    5 * M,
    15 * M,
    30 * M,
    H,
    3 * H,
    6 * H,
    12 * H,
    D,
    2 * D,
    7 * D,
  ];
  const MONTHS = [1, 3, 6];
  // 1970-01-01 is a Thursday; shift 7-day steps so weeks start on Monday.
  const WEEK_OFFSET = 4 * D;

  /** The last moment a Date can hold, ms either side of 1970. A number past it is not a time (nanoseconds, say). */
  const MAX_MS = 8.64e15;
  /** More ticks than any axis can show: a guard, so a degenerate domain cannot make the tick loops run away. */
  const MAX_TICKS = 1000;

  const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

  /** Numbers are epoch milliseconds (the common case, read here without a call); strings and Dates are read by BC.time:
   *  ISO dates and times, UTC unless they name an offset. */
  function toMs(v: unknown): number {
    if (typeof v === 'number') return Math.abs(v) <= MAX_MS ? v : NaN;
    return BC.time(v);
  }

  function niceYears(span: number, count: number): number {
    const raw = span / YEAR / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const f = raw / pow;
    return Math.max(1, (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow);
  }

  function labelFixed(t: number, step: number): string {
    const d = new Date(t);
    if (step >= D) return BC.formatter({ month: 'short', day: 'numeric' }, 'date')(t);
    const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    if (step < S) {
      const ms = d.getUTCMilliseconds();
      return `${hm}:${pad2(d.getUTCSeconds())}.${ms < 10 ? '00' : ms < 100 ? '0' : ''}${ms}`;
    }
    return step < M ? `${hm}:${pad2(d.getUTCSeconds())}` : hm;
  }

  /** Date.UTC, also for the years 0 to 99, which Date.UTC takes for 1900 to 1999. */
  function utc(y: number, m: number, day: number): number {
    const t = Date.UTC(y, m, day);
    if (y < 0 || y > 99 || !isFinite(t)) return t;
    const d = new Date(t);
    d.setUTCFullYear(y);
    return d.getTime();
  }

  function makeTicks(from: number, to: number, count: number): { t: number; label: string }[] {
    const out: { t: number; label: string }[] = [];
    // a view that does not parse (NaN) has no ticks; one that runs the other way has the same ticks
    if (!isFinite(from) || !isFinite(to)) return out;
    const d0 = Math.min(from, to);
    const d1 = Math.max(from, to);
    const span = d1 - d0;
    const fixed = FIXED.find((f) => span / f <= count);
    if (fixed !== undefined) {
      const off = fixed === 7 * D ? WEEK_OFFSET : 0;
      for (let t = Math.ceil((d0 - off) / fixed) * fixed + off; t <= d1 && out.length < MAX_TICKS; t += fixed)
        out.push({ t, label: labelFixed(t, fixed) });
      return out;
    }
    const k = MONTHS.find((m) => span / (m * MONTH) <= count);
    if (k !== undefined) {
      const first = new Date(d0);
      let idx = Math.ceil((first.getUTCFullYear() * 12 + first.getUTCMonth()) / k) * k;
      for (; out.length < MAX_TICKS; idx += k) {
        const t = utc(Math.floor(idx / 12), idx % 12, 1);
        if (!isFinite(t) || t > d1) break;
        if (t < d0) continue;
        out.push({ t, label: BC.formatter({ month: 'short', year: 'numeric' }, 'date')(t) });
      }
      return out;
    }
    const years = niceYears(span, count);
    for (let y = Math.ceil(new Date(d0).getUTCFullYear() / years) * years; out.length < MAX_TICKS; y += years) {
      // past the last year a Date can hold, Date.UTC is NaN: stop there
      const t = utc(y, 0, 1);
      if (!isFinite(t) || t > d1) break;
      if (t < d0) continue;
      out.push({ t, label: String(y) });
    }
    return out;
  }

  /** Ticks for about `count` labels; a calendar step that leaves fewer than two inside the domain (a quarter on half a
   *  year starting on the 5th of January, so only April) is too coarse, and a finer one is taken. The axis still thins
   *  labels that do not fit. */
  function ticksFor(d0: number, d1: number, count: number): { t: number; label: string }[] {
    let out = makeTicks(d0, d1, count);
    for (let c = count * 2; out.length < 2 && c <= count * 16; c *= 2) {
      const finer = makeTicks(d0, d1, c);
      if (finer.length > out.length) out = finer;
    }
    return out;
  }

  const def: BC.ScaleDef = {
    role: 'scale',
    type: 'time',
    version: 8,
    output: 'position',
    input: 'date',
    merge: 'extent',
    doc: 'Time scale in UTC. Values: epoch milliseconds, ISO date strings or Dates; a date or time without an offset ("2024-03-01", "2024-03-01T09:00", "2024-03-01 09:00") is UTC, so every reader sees the same hours. Ticks snap to calendar units (milliseconds … years), and months are written in the language of the chart. Numbers beyond the range of dates (nanoseconds, say) are not times: when none of the numbers is one, the chart reports it. So does it for years given as numbers (2019 is 2 seconds into 1970): give them as text ("2019") or dates. A domain from later to earlier runs the axis the other way.',
    params: {
      padding: { kind: 'number', default: 0, doc: 'Extra room around the data extent, as a fraction of its span.' },
    },
    create(spec, ctx) {
      let b0: number, b1: number;
      // a domain given is read, or refused: one of three values used to be dropped without a word
      if (spec.domain !== undefined && spec.domain !== null) {
        const d: unknown[] = Array.isArray(spec.domain) && spec.domain.length === 2 ? spec.domain : [NaN, NaN];
        b0 = toMs(d[0]);
        b1 = toMs(d[1]);
        // [later, earlier] runs the axis the other way; equal ends have nothing between them
        if (!isFinite(b0) || !isFinite(b1) || b0 === b1)
          throw new Error(
            `scale.time: domain must be two different dates (ISO strings such as "2024-01-01", or epoch milliseconds), got ${JSON.stringify(spec.domain)}`,
          );
      } else {
        b0 = Infinity;
        b1 = -Infinity;
        let outOfRange = 0;
        let years = 0; // whole numbers from 1000 to 2999: years, most likely, not milliseconds into 1970
        let others = 0;
        for (const col of ctx.sources) {
          for (let i = 0; i < col.length; i++) {
            const t = toMs(col[i]);
            if (!isFinite(t)) {
              if (typeof col[i] === 'number' && isFinite(col[i] as number)) outOfRange++;
              continue;
            }
            if (typeof col[i] === 'number' && t >= 1000 && t <= 2999 && t === Math.floor(t)) years++;
            else others++;
            if (t < b0) b0 = t;
            if (t > b1) b1 = t;
          }
        }
        if (years && !others)
          throw new Error(
            `scale.time: the numbers look like years (${b0} to ${b1}), and a time scale reads a number as milliseconds since 1970, so all of them fall in its first three seconds. ` +
              'Give the years as text ("2019" is 1 January) or as dates ("2019-01-01"); from a CSV, "types": { "year": "string" } keeps the column text. Or draw them on a linear scale',
          );
        if (b0 > b1) {
          // numbers, and not one of them a date: almost always a time in another unit
          if (outOfRange)
            throw new Error(
              'scale.time: the numbers are outside the range of dates; a time scale reads epoch milliseconds (from nanoseconds divide by 1e6, from seconds multiply by 1000)',
            );
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

      const scale = ((v: unknown) => r0 + ((toMs(v) - d0) / (d1 - d0)) * (r1 - r0)) as unknown as BC.ScaleMapping<unknown, number>;
      Object.defineProperties(scale, {
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
            ticksFor(d0, d1, Math.max(1, approxCount)).map((k) => ({ value: k.t, pos: scale(k.t), label: k.label })),
        },
      });
      return scale;
    },
  };

  BC.define(def);
})();
