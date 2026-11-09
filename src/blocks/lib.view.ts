(function () {
  type Pair = [number, number];

  /** Values of a continuous scale as numbers that are even on the screen: on a log scale their logarithms. A domain
   *  that runs backwards ([100, 0]) is negated, so in these numbers the full domain always runs low to high. */
  function even(scale: BC.Scale): { to(v: unknown): number; from(x: number): number; full: Pair } {
    const log = scale.kind === 'log';
    const d = scale.baseDomain();
    const sign = Number(d[1]) < Number(d[0]) ? -1 : 1;
    const to = (v: unknown) => sign * (log ? Math.log10(Number(v)) : Number(v));
    const from = (x: number) => (log ? Math.pow(10, sign * x) : sign * x);
    return { to, from, full: [to(d[0]), to(d[1])] };
  }

  /** The view of a scale now, in even numbers. */
  function current(live: BC.LiveCtx, name: string): Pair {
    const { to } = even(live.scales[name]);
    const v = live.getView()[name] as unknown[];
    return [to(v[0]), to(v[1])];
  }

  /** Shows [d0, d1] (even numbers), shifted back inside the full domain; a view that covers all of it is no view. */
  function show(live: BC.LiveCtx, name: string, d0: number, d1: number): void {
    const { from, full } = even(live.scales[name]);
    const [b0, b1] = full;
    if (d1 - d0 >= (b1 - b0) * (1 - 1e-9)) {
      live.setView(name, null);
      return;
    }
    if (d0 < b0) {
      d1 += b0 - d0;
      d0 = b0;
    }
    if (d1 > b1) {
      d0 -= d1 - b1;
      d1 = b1;
    }
    live.setView(name, [from(d0), from(d1)]);
  }

  /** Makes the view `factor` times as wide around `anchor` (even numbers; default its middle), the anchor staying
   *  where it is on the screen; never narrower than the full domain over `maxZoom`, nor wider than the full domain. */
  function zoom(live: BC.LiveCtx, name: string, factor: number, maxZoom: number, anchor?: number): void {
    const [b0, b1] = even(live.scales[name]).full;
    const [d0, d1] = current(live, name);
    const span = Math.min(b1 - b0, Math.max((b1 - b0) / maxZoom, (d1 - d0) * factor));
    if (anchor === undefined || !(d1 > d0)) {
      const mid = anchor === undefined ? (d0 + d1) / 2 : anchor;
      return show(live, name, mid - span / 2, mid + span / 2);
    }
    const f = span / (d1 - d0);
    show(live, name, anchor - (anchor - d0) * f, anchor + (d1 - anchor) * f);
  }

  const def: BC.LibDef = {
    role: 'lib',
    type: 'view',
    version: 1,
    doc: 'The arithmetic of zooming a continuous scale, shared by interaction.zoom and interaction.zoom-controls. It runs on numbers that are even on the screen (the logarithms on a log scale; a domain that runs backwards is negated): `current(live, name)` is the view now, `show(live, name, d0, d1)` sets one, shifted back inside the full domain, and `zoom(live, name, factor, maxZoom, anchor)` widens or narrows it around a point. A spec never names it.',
    exports: { current, show, zoom },
  };

  BC.define(def);
})();
