(function (BC: BC.Runtime) {
  type Check = (block: string, table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) => void;
  /** The fields it reads must exist and the columns it writes must not replace others: lib.columns, listed in
   *  `requires` so it is on the page. */
  const checkColumns = (table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) =>
    ((BC.get('lib.columns') as BC.LibDef).exports.check as Check)('transform.hexbin', table, reads, writes, keep);

  const SQRT3 = Math.sqrt(3);
  const MAX_BINS = 200;
  /** The shape of plot the hexagons are binned for when there is no plot yet: the binning the scales take their domains from. */
  const GUESS = 1.6;
  /** The last binning for the shape of a plot, per spec: every redraw that is not zoomed asks for the same one. */
  const shaped = new WeakMap<BC.TransformSpec, { table: BC.Table; aspect: number; out: { table: BC.Table; room: number[] } }>();
  const aspectOf = (spec: BC.TransformSpec) =>
    typeof spec.aspect === 'number' && spec.aspect > 0 && isFinite(spec.aspect) ? spec.aspect : undefined;

  function names(spec: BC.TransformSpec) {
    const as = Array.isArray(spec.as) ? spec.as : [];
    const pick = (k: number, d: string) => (typeof as[k] === 'string' ? (as[k] as string) : d);
    return {
      x0: pick(0, 'x0'),
      x1: pick(1, 'x1'),
      y0: pick(2, 'y0'),
      y1: pick(3, 'y1'),
      count: typeof spec.countAs === 'string' ? spec.countAs : 'count',
    };
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'hexbin',
    version: 3,
    requires: ['lib.columns'],
    replacesColumns: true,
    // without a fixed `aspect` it follows the plot, and it can also run without one: the scales read its first result
    viewDependent: (spec) => aspectOf(spec) === undefined,
    doc: 'Hexagonal binning, for a scatter of too many points to read: the plane is tiled with hexagons and each row of the result is one hexagon that has points in it, with how many (`count`). It writes the box of each hexagon (x0, x1, y0, y1), for a mark.rect with `shape: "hexagon"` on two linear scales with `nice: false`, x: x0, x2: x1, y: y0, y2: y1, colored by `count` on a sequential scale; and its center under the names of `x` and `y`, for the tooltip. The hexagons are binned anew for the size the chart is drawn at, and at every zoom, so they stay regular on a phone as on a wide screen; each covers the same area of the data whatever its shape, so a count, and the color legend, mean the same at every size. The scales take their domains from the hexagons binned for the plot as it is laid out: they keep inside it, from edge to edge along one axis and in the middle along the other, where whole regular hexagons leave a little room (under a third of one on most plots). Rows where x or y is not a number are left out.',
    params: {
      x: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field along x.' },
      y: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field along y.' },
      bins: {
        kind: 'number',
        default: 20,
        doc: 'How many hexagons fit across the width of the data on a plot 1.6 times as wide as tall. On a narrower plot fewer fit across, as large in the data, so they stay as large on the screen.',
      },
      aspect: {
        kind: 'number',
        doc: 'Width / height of the plot, to bin once for that shape instead of following the plot: the scales then keep exactly to the hexagons, but at another size the hexagons come out stretched. The plot is the chart less its axes and legend: a 640 × 400 chart with axes on the left and bottom has a plot of about 560 × 320 (1.75).',
      },
      xScale: { kind: 'scale', default: 'x', doc: 'Name of the x scale the hexagons are drawn on: they are binned for its size.' },
      yScale: { kind: 'scale', default: 'y', doc: 'Name of the y scale the hexagons are drawn on.' },
      as: { kind: 'list', doc: 'Names of the four columns of the box. Default [x0, x1, y0, y1].' },
      countAs: { kind: 'string', default: 'count', doc: 'Name of the column with the number of points.' },
    },
    outputs(spec) {
      const n = names(spec);
      const out = [n.x0, n.x1, n.y0, n.y1, n.count];
      for (const f of [spec.x, spec.y]) if (typeof f === 'string') out.push(f);
      return out;
    },
    apply(table, spec, view) {
      const n = names(spec);
      const xf = spec.x as string;
      const yf = spec.y as string;
      checkColumns(
        table,
        [
          ['x', xf],
          ['y', yf],
        ],
        [
          ['as[0]', n.x0],
          ['as[1]', n.x1],
          ['as[2]', n.y0],
          ['as[3]', n.y1],
          ['countAs', n.count],
          ['x', xf],
          ['y', yf],
        ],
        // the result is a table of its own, so the data's columns are no matter; only its own names must differ
        Object.keys(table.columns),
      );
      const bins = typeof spec.bins === 'number' && spec.bins >= 1 ? Math.min(MAX_BINS, Math.round(spec.bins)) : 20;
      const xs = table.columns[xf];
      const ys = table.columns[yf];
      const num = (v: unknown): number => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : NaN);
      let xmin = Infinity;
      let xmax = -Infinity;
      let ymin = Infinity;
      let ymax = -Infinity;
      for (let i = 0; i < table.length; i++) {
        const x = num(xs[i]);
        const y = num(ys[i]);
        if (!isFinite(x) || !isFinite(y)) continue;
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
      const cols: Record<string, number[]> = { [n.x0]: [], [n.x1]: [], [n.y0]: [], [n.y1]: [], [n.count]: [], [xf]: [], [yf]: [] };
      if (!(xmax >= xmin)) return { length: 0, columns: cols };
      // one value along an axis is a line of hexagons: give it a span of one around the value
      if (xmax === xmin) ((xmin -= 0.5), (xmax += 0.5));
      if (ymax === ymin) ((ymin -= 0.5), (ymax += 0.5));
      const spanX = xmax - xmin;
      const spanY = ymax - ymin;
      // Binned in units where the data is `a` wide and 1 tall, a hexagon is regular: pointy at the top, rows offset by
      // half, `across` of them across the data.
      const binAll = (a: number, across = bins) => {
        const dx = a / across;
        const r = dx / SQRT3;
        const dy = r * 1.5;
        const counts = new Map<string, { i: number; j: number; n: number }>();
        for (let k = 0; k < table.length; k++) {
          const x = num(xs[k]);
          const y = num(ys[k]);
          if (!isFinite(x) || !isFinite(y)) continue;
          // the nearest center (the search of d3-hexbin, with distances measured the same way along both axes)
          const px0 = (((x - xmin) / spanX) * a) / dx;
          const py = (y - ymin) / spanY / dy;
          let j = Math.round(py);
          const px = px0 - (j & 1) / 2;
          let i = Math.round(px);
          const py1 = py - j;
          if (Math.abs(py1) * 3 > 1) {
            const px1 = px - i;
            const i2 = i + (px < i ? -1 : 1) / 2;
            const j2 = j + (py < j ? -1 : 1);
            const px2 = px - i2;
            const py2 = py - j2;
            // a step of px is sqrt(3) r long and a step of py 1.5 r
            if (3 * px1 * px1 + 2.25 * py1 * py1 > 3 * px2 * px2 + 2.25 * py2 * py2) {
              i = i2 + (j & 1 ? 1 : -1) / 2;
              j = j2;
            }
          }
          const key = i + ',' + j;
          const bin = counts.get(key);
          if (bin) bin.n++;
          else counts.set(key, { i, j, n: 1 });
        }
        let u0 = Infinity;
        let u1 = -Infinity;
        let v0 = Infinity;
        let v1 = -Infinity;
        for (const b of counts.values()) {
          const cu = (b.i + (b.j & 1) / 2) * dx;
          u0 = Math.min(u0, cu);
          u1 = Math.max(u1, cu);
          v0 = Math.min(v0, b.j * dy);
          v1 = Math.max(v1, b.j * dy);
        }
        return { a, dx, r, dy, counts, ratio: (u1 - u0 + dx) / (v1 - v0 + 2 * r) };
      };
      /** For a plot `aspect` times as wide as tall whose scales span the boxes of the outer hexagons (a little more than
       *  the data): `a` is set for those boxes to have that shape, and set again as they shift with it. With `keepArea`
       *  as many go across as keeps the area of each hexagon that of one binned for a plot GUESS wide, as `followed`. */
      const fitted = (aspect: number, keepArea = false) => {
        const across = (a: number) => (keepArea ? bins * Math.sqrt(a / GUESS) : bins);
        const off = (b: { ratio: number }) => Math.abs(Math.log(b.ratio / aspect));
        let best = binAll(aspect, across(aspect));
        let last = best;
        for (let round = 0, a = aspect; round < 8 && Math.abs(best.ratio / aspect - 1) > 1e-9; round++) {
          a *= aspect / last.ratio;
          last = binAll(a, across(a));
          if (off(last) < off(best)) best = last;
        }
        return best;
      };
      const xName = typeof spec.xScale === 'string' ? spec.xScale : 'x';
      const yName = typeof spec.yScale === 'string' ? spec.yScale : 'y';
      /** On the plot as it is drawn now: as many px for a unit of `a` across as for one up, read off the two scales. */
      const followed = (v: BC.TransformView) => {
        const pxPerUnit = (name: string) => {
          const scale = v.scales[name];
          if (!scale) return NaN;
          const d = scale.domain() as unknown[];
          const r = scale.range() as unknown[];
          return Math.abs((num(r[1]) - num(r[0])) / (num(d[d.length - 1]) - num(d[0])));
        };
        const a = (spanX * pxPerUnit(xName)) / (spanY * pxPerUnit(yName));
        // as many across as keeps the area of a hexagon in the data that of one binned for a plot GUESS wide (a / across²)
        if (a > 0 && isFinite(a)) return binAll(a, bins * Math.sqrt(a / GUESS));
        v.warn(
          `transform.hexbin: the scales "${xName}" and "${yName}" cannot be followed (one is missing or has no extent), so the hexagons are binned for a plot ${GUESS} times as wide as tall`,
        );
        return undefined;
      };
      const rowsOf = ({ a, dx, r, dy, counts }: ReturnType<typeof binAll>): BC.Table => {
        const out: Record<string, number[]> = { [n.x0]: [], [n.x1]: [], [n.y0]: [], [n.y1]: [], [n.count]: [], [xf]: [], [yf]: [] };
        // bottom row first, each from the left: the order does not depend on the order of the data
        const sorted = Array.from(counts.values()).sort((p, q) => p.j - q.j || p.i - q.i);
        const halfX = ((dx / 2) * spanX) / a;
        const halfY = r * spanY;
        for (const b of sorted) {
          const cx = xmin + (((b.i + (b.j & 1) / 2) * dx) / a) * spanX;
          const cy = ymin + b.j * dy * spanY;
          out[n.x0].push(cx - halfX);
          out[n.x1].push(cx + halfX);
          out[n.y0].push(cy - halfY);
          out[n.y1].push(cy + halfY);
          out[n.count].push(b.n);
          out[xf].push(cx);
          out[yf].push(cy);
        }
        return { length: sorted.length, columns: out };
      };
      /** Binned for a plot `aspect` wide per 1 tall, and the room the scales are to span for it: the box of the outer
       *  hexagons, made that shape by as much more on each side along the axis it is short. Whole hexagons make a box of
       *  only some shapes; stretched to the plot's they would not be regular. */
      const shapedFor = (aspect: number) => {
        const b = fitted(aspect, true);
        const t = rowsOf(b);
        const c = t.columns as Record<string, number[]>;
        const room = [Infinity, -Infinity, Infinity, -Infinity];
        for (let k = 0; k < t.length; k++) {
          room[0] = Math.min(room[0], c[n.x0][k]);
          room[1] = Math.max(room[1], c[n.x1][k]);
          room[2] = Math.min(room[2], c[n.y0][k]);
          room[3] = Math.max(room[3], c[n.y1][k]);
        }
        // b.ratio is the box's shape, measured in the units it was binned in
        if (b.ratio > aspect) {
          const more = ((room[3] - room[2]) * (b.ratio / aspect - 1)) / 2;
          room[2] -= more;
          room[3] += more;
        } else {
          const more = ((room[1] - room[0]) * (aspect / b.ratio - 1)) / 2;
          room[0] -= more;
          room[1] += more;
        }
        return { table: t, room };
      };
      const given = aspectOf(spec);
      if (given === undefined && view) {
        // Binned for the shape of the plot (its px), in room the scales are to span. The run that gives the scales their
        // domains says so; after it the scales do span that room, unless they have a domain of their own, a rounded one,
        // or a zoom: then the hexagons follow the scales.
        const length = (name: string) => {
          const scale = view.scales[name];
          const r = scale ? (scale.range() as unknown[]) : [];
          return Math.abs(num(r[1]) - num(r[0]));
        };
        const aspect = length(xName) / length(yName);
        if (aspect > 0 && isFinite(aspect)) {
          let kept = shaped.get(spec);
          if (!kept || kept.table !== table || kept.aspect !== aspect) shaped.set(spec, (kept = { table, aspect, out: shapedFor(aspect) }));
          const { room } = kept.out;
          if (view.fitting) {
            if (view.reach) {
              view.reach(xName, [room[0], room[1]]);
              view.reach(yName, [room[2], room[3]]);
            }
            return kept.out.table;
          }
          const spans = (name: string, lo: number, hi: number) => {
            const d = view.scales[name].domain() as unknown[];
            const near = Math.abs(hi - lo) * 1e-9;
            return Math.abs(num(d[0]) - lo) <= near && Math.abs(num(d[d.length - 1]) - hi) <= near;
          };
          if (spans(xName, room[0], room[1]) && spans(yName, room[2], room[3])) return kept.out.table;
        }
        const f = followed(view);
        if (f) return rowsOf(f);
      }
      return rowsOf(fitted(given ?? GUESS));
    },
  };

  BC.define(def);
})((globalThis as any).BC);
