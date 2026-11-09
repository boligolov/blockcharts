(function () {
  /** Radius per row: the `size` channel when there is one (NaN = no size, not drawn), else the constant `r`. */
  function radii(spec: BC.MarkSpec, ctx: BC.ChartCtx): (i: number) => number {
    if (spec.size !== undefined) {
      const sizes = ctx.channel(spec, 'size').mapped;
      return (i) => sizes[i] as number;
    }
    const r = typeof spec.r === 'number' ? spec.r : 3;
    return () => r;
  }

  /** The rows to draw, in drawing order: with sizes, the biggest first, so a small bubble is never hidden under a big one. */
  function order(spec: BC.MarkSpec, ctx: BC.ChartCtx, radius: (i: number) => number): number[] {
    const { from, to } = ctx.rows(spec);
    const rows: number[] = [];
    for (let i = from; i < to; i++) rows.push(i);
    if (spec.size !== undefined) {
      // rows without a size are not drawn; they go last so a NaN never reaches the comparator's arithmetic
      const key = (i: number) => {
        const r = radius(i);
        return isFinite(r) ? r : -1;
      };
      rows.sort((a, b) => key(b) - key(a) || a - b);
    }
    return rows;
  }

  type Swarm = { across: 'x' | 'y'; shift: Float64Array; k: number };
  /** One swarm per built chart and mark: the value channel is a new object whenever the chart is laid out again (zoom,
   *  resize, a legend filter), so the pointer, which asks on every move, reuses the layout the render made. */
  const swarms = new WeakMap<object, Swarm>();

  /** With `swarm`, how far each point moves across its band so that no two touch: a beeswarm. Per category, in order of
   *  value, every point takes the smallest shift that clears the points already placed near it (closer than two radii
   *  along the value axis). When a category does not fit its band (a phone gives the value axis less room), the points
   *  and their gaps shrink together, by `k`, as little as makes every category fit and never below `1 - swarmShrink`;
   *  what still does not fit is laid over the others. Without `swarm`, null: no point moves. */
  function swarm(spec: BC.MarkSpec, ctx: BC.ChartCtx, radius: (i: number) => number): Swarm | null {
    if (spec.swarm !== true) return null;
    const cx = ctx.channel(spec, 'x');
    const cy = ctx.channel(spec, 'y');
    const bandX = !!(cx.scale && cx.scale.bandwidth !== undefined);
    const bandY = !!(cy.scale && cy.scale.bandwidth !== undefined);
    if (bandX === bandY)
      throw new Error(
        'mark.point: swarm spreads the points of a category across its band, so one of x and y needs a band scale and the other a value',
      );
    const cached = swarms.get(bandX ? cy : cx);
    if (cached) return cached;
    const cat = bandX ? cx.mapped : cy.mapped;
    const band = ((bandX ? cx : cy).scale!.bandwidth as number) / 2;
    const val = bandX ? cy.mapped : cx.mapped;
    const gap0 = typeof spec.swarmGap === 'number' && spec.swarmGap >= 0 ? spec.swarmGap : 1;
    const shrink = typeof spec.swarmShrink === 'number' && spec.swarmShrink >= 0 ? Math.min(spec.swarmShrink, 0.9) : 0.5;
    const shift = new Float64Array(val.length);
    const groups: number[][] = [];
    const byCat = new Map<number, number[]>();
    const { from, to } = ctx.rows(spec);
    for (let i = from; i < to; i++) {
      if (!isFinite(cat[i]) || !isFinite(val[i]) || !isFinite(radius(i))) continue;
      const g = byCat.get(cat[i]);
      if (g) g.push(i);
      else {
        byCat.set(cat[i], [i]);
        groups.push(byCat.get(cat[i])!);
      }
    }
    for (const rows of groups) rows.sort((a, b) => val[a] - val[b] || a - b);

    /** Lays every category out with radii and gaps times k; a probe stops at the first point that finds no room and
     *  says so, the final layout lays such points over the others. True when every point found room. */
    const place = (k: number, probe: boolean): boolean => {
      const gap = gap0 * k;
      for (const rows of groups) {
        let rMax = 0;
        for (const i of rows) rMax = Math.max(rMax, radius(i) * k);
        const placed: number[] = [];
        let head = 0;
        let full = 0;
        for (const i of rows) {
          const ri = radius(i) * k;
          // a point stays inside its band; one that finds no room there is laid over the others and is not a neighbour
          // anyone has to clear, so a category of thousands of equal values costs no more than one its band can hold
          const limit = Math.max(0, band - ri);
          // the points placed so far that can still touch this one, by their value alone
          while (head < placed.length && val[placed[head]] < val[i] - ri - rMax - gap) head++;
          const near = placed.slice(head);
          const clear = (o: number) =>
            near.every((j) => {
              const d = ri + radius(j) * k + gap;
              const dv = val[i] - val[j];
              const ds = o - shift[j];
              return dv * dv + ds * ds >= d * d - 1e-6;
            });
          let best = 0;
          if (!clear(0)) {
            best = Infinity;
            for (const j of near) {
              const d = ri + radius(j) * k + gap;
              const dv = val[i] - val[j];
              if (Math.abs(dv) >= d) continue;
              const s = Math.sqrt(d * d - dv * dv);
              for (const o of [shift[j] + s, shift[j] - s]) if (Math.abs(o) <= limit && Math.abs(o) < Math.abs(best) && clear(o)) best = o;
            }
          }
          if (isFinite(best)) {
            shift[i] = best;
            placed.push(i);
          } else if (probe) {
            return false;
          } else {
            // spread the ones that do not fit evenly over the band rather than all on its middle
            shift[i] = limit * (((full++ * 0.618034) % 1) * 2 - 1);
          }
        }
      }
      return true;
    };

    // the largest k that fits, to a few thousandths of the radius; when even the smallest allowed does not, the smallest
    let k = 1;
    if (shrink > 0 && !place(1, true)) {
      let lo = 1 - shrink;
      if (place(lo, true)) {
        let hi = 1;
        for (let step = 0; step < 8; step++) {
          const mid = (lo + hi) / 2;
          if (place(mid, true)) lo = mid;
          else hi = mid;
        }
      }
      k = lo;
    }
    place(k, false);
    const out: Swarm = { across: bandX ? 'x' : 'y', shift, k };
    swarms.set(bandX ? cy : cx, out);
    return out;
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'point',
    version: 11,
    doc: 'One circle per row. Channels x and y, optional color (a field on a color scale); constant params r, fill, opacity. Either channel also takes a band scale, centered in its band — a category axis plus a value axis draws a dot plot (Cleveland dot plot). A `size` channel on a scale.size makes it a bubble chart: the area of each circle follows the value, big bubbles are drawn first so small ones stay on top. `swarm` on a category axis spreads the points of each category across its band so none overlap: a beeswarm, every sample visible; on a narrow screen its points shrink so they still fit.',
    params: {
      r: { kind: 'number', default: 3, doc: 'Radius in px (when there is no `size` channel).' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: theme color by mark index.' },
      opacity: { kind: 'number', default: 1, doc: 'Bubbles overlap: 0.7 lets the ones behind show through.' },
      stroke: {
        kind: 'string',
        doc: 'Outline color; bubbles read better with the card color as one ("var(--bc-tooltip-bg, #fff)", which follows the dark theme).',
      },
      swarm: {
        kind: 'boolean',
        default: false,
        doc: 'Spread the points of each category across its band so that none overlap, keeping each at its value: a beeswarm. Needs a band scale on one axis and a value on the other. When a category does not fit its band (on a phone, say), all points of the mark shrink as little as makes them fit (see `swarmShrink`); a point that still finds no room is laid over the others: use a taller chart, or for thousands of points a violin (transform.density).',
      },
      swarmGap: { kind: 'number', default: 1, doc: 'Space between the points of a swarm, px; it shrinks with the points.' },
      swarmShrink: {
        kind: 'number',
        default: 0.5,
        doc: 'How much smaller the points of a swarm may get when a category does not fit its band, as a share of their radius: 0.5 lets them get half as big, 0 keeps them as given (at most 0.9).',
      },
    },
    channels: {
      x: { required: true, scales: ['linear', 'log', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'log', 'time', 'band'] },
      color: {
        scales: ['color', 'sequential'],
        doc: 'Fill color per row, from a color scale; rows the scale gives no color (a hidden category, a missing number) are not drawn.',
      },
      size: {
        scales: ['size'],
        doc: 'Radius per row from a scale.size (a bubble chart); rows without a size (missing or negative) are not drawn.',
      },
    },
    render(spec, ctx, index) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const halfX = cx.half;
      const halfY = cy.half;
      const radius = radii(spec, ctx);
      const fill = typeof spec.fill === 'string' ? spec.fill : ctx.color(index);
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const stroke = typeof spec.stroke === 'string' ? spec.stroke : undefined;
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const sw = swarm(spec, ctx, radius);
      const out: BC.Prim[] = [];
      for (const i of order(spec, ctx, radius)) {
        const px = cx.mapped[i] + (sw && sw.across === 'x' ? sw.shift[i] : 0);
        const py = cy.mapped[i] + (sw && sw.across === 'y' ? sw.shift[i] : 0);
        const r = radius(i) * (sw ? sw.k : 1);
        if (!isFinite(px) || !isFinite(py) || !isFinite(r)) continue;
        const c = colors ? colors[i] : fill;
        if (!c) continue;
        out.push({
          type: 'circle',
          cx: px + halfX,
          cy: py + halfY,
          r,
          style: stroke ? { fill: c, opacity, stroke, strokeWidth: 1 } : { fill: c, opacity },
          ref: { mark: index, row: i },
        });
      }
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const halfX = cx.half;
      const halfY = cy.half;
      const radius = radii(spec, ctx);
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const sw = swarm(spec, ctx, radius);
      // the circle drawn last that the pointer is in wins (it is on top); otherwise the one whose edge is nearest
      let best = -1;
      let bestGap = Infinity;
      let bestX = 0;
      let bestY = 0;
      for (const i of order(spec, ctx, radius)) {
        const x = cx.mapped[i] + halfX + (sw && sw.across === 'x' ? sw.shift[i] : 0);
        const y = cy.mapped[i] + halfY + (sw && sw.across === 'y' ? sw.shift[i] : 0);
        const r = radius(i) * (sw ? sw.k : 1);
        if (!isFinite(x) || !isFinite(y) || !isFinite(r) || (colors && !colors[i])) continue;
        const gap = Math.max(0, Math.hypot(x - px, y - py) - r);
        if (gap <= bestGap) {
          bestGap = gap;
          best = i;
          bestX = x;
          bestY = y;
        }
      }
      // a few pixels of slack: small dots are hard to hit exactly
      if (best < 0 || bestGap > 6) return null;
      return { row: best, x: bestX, y: bestY, dist: bestGap };
    },
  };

  BC.define(def);
})();
