(function () {
  type Pair = [number, number];

  /** Values of a continuous scale as numbers that are even on the screen, read off the scale's own mapping: how far along
   *  its full domain the scale puts them, 0 at its first end and 1 at its last. That is the value itself on a linear
   *  scale and its logarithm on a log one, scaled, and it does not change as the view does; a scale of any other name
   *  that maps one way and is not clamped zooms the same. A domain that runs backwards ([100, 0]) needs no case of its
   *  own. Null when the scale has no length on the screen to measure by. */
  function even(scale: BC.Scale): { to(v: unknown): number; from(x: number): unknown; full: Pair } | null {
    const d = scale.baseDomain();
    const p0 = scale(d[0]) as number;
    const span = (scale(d[1]) as number) - p0;
    if (!scale.invert || !(isFinite(p0) && isFinite(span) && span !== 0)) return null;
    return {
      to: (v) => ((scale(v) as number) - p0) / span,
      // the ends of the full domain are its own values, not what the arithmetic makes of them
      from: (x) => (x === 0 ? d[0] : x === 1 ? d[1] : scale.invert!(p0 + x * span)),
      full: [0, 1],
    };
  }

  /** The view of a scale now, in even numbers ([0, 1] when it cannot be measured, and then nothing moves). */
  function current(live: BC.LiveCtx, name: string): Pair {
    const e = even(live.scales[name]);
    const v = live.getView()[name] as unknown[];
    return e ? [e.to(v[0]), e.to(v[1])] : [0, 1];
  }

  /** Shows [d0, d1] (even numbers), shifted back inside the full domain; a view that covers all of it is no view. */
  function show(live: BC.LiveCtx, name: string, d0: number, d1: number): void {
    const e = even(live.scales[name]);
    if (!e) return;
    const { from, full } = e;
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
    const e = even(live.scales[name]);
    if (!e) return;
    const [b0, b1] = e.full;
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
    version: 2,
    doc: 'The arithmetic of zooming a continuous scale, shared by interaction.zoom and interaction.zoom-controls. It runs on numbers that are even on the screen, read off the mapping of the scale itself (how far along its full domain a value is put, from 0 to 1), so a log scale or one of any other name needs no case of its own: `current(live, name)` is the view now, `show(live, name, d0, d1)` sets one, shifted back inside the full domain, and `zoom(live, name, factor, maxZoom, anchor)` widens or narrows it around a point. A spec never names it.',
    exports: { current, show, zoom },
  };

  BC.define(def);
})();
