(function (BC: BC.Runtime) {
  /** A round step, 1, 2 or 5 × 10^n, that cuts `span` into about `count` parts. */
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
    // ends that differ only by rounding (0.1 + 0.2 and 0.3) have no length either: steps of 1e-17 are not ticks
    if (!(isFinite(lo) && isFinite(hi) && hi - lo > 1e-12 * Math.max(Math.abs(lo), Math.abs(hi)))) return out;
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

  const def: BC.LibDef = {
    role: 'lib',
    type: 'ticks',
    version: 2,
    doc: 'Round numbers, shared by scale.linear, scale.sequential, scale.size and transform.bin. `niceStep(span, count)` is a step of 1, 2 or 5 × 10^n that cuts `span` into about `count` parts; `roundTicks(d0, d1, count)` lists its multiples between the two ends of a domain as { value, label }, smallest first, and none for a domain with no length or not made of numbers. A spec never names it.',
    exports: { niceStep, roundTicks },
  };

  BC.define(def);
})((globalThis as any).BC);
