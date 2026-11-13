(function (BC: BC.Runtime) {
  type Check = (block: string, table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) => void;
  /** The fields it reads must exist and the columns it writes must not replace others: lib.columns, listed in
   *  `requires` so it is on the page. */
  const checkColumns = (table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) =>
    ((BC.get('lib.columns') as BC.LibDef).exports.check as Check)('transform.contour', table, reads, writes, keep);

  const GRID = 80;
  const MAX_GRID = 400;
  const LEVELS = 6;
  const MAX_LEVELS = 50;

  function fail(message: string): never {
    throw new Error('transform.contour: ' + message);
  }

  /** From lib.stats, listed in `requires` so it is on the page. */
  const spread = (sorted: ArrayLike<number>) =>
    ((BC.get('lib.stats') as BC.LibDef).exports.spread as (s: ArrayLike<number>) => number)(sorted);

  /** Scott's rule for two dimensions, per axis: spread · n^-1/6. Values all alike have no spread, so a width is made up
   *  from their size. */
  function bandwidthOf(values: Float64Array): number {
    const sorted = Float64Array.from(values).sort();
    const s = spread(sorted);
    if (s > 0) return s * Math.pow(sorted.length, -1 / 6);
    return Math.abs(sorted[0]) * 0.05 || 1;
  }

  /** A Gaussian of `sigma` cells, cut at 4 sigma and summing to 1. */
  function kernelOf(sigma: number): Float64Array {
    const half = Math.max(1, Math.ceil(4 * sigma));
    const k = new Float64Array(2 * half + 1);
    let sum = 0;
    for (let i = -half; i <= half; i++) sum += k[i + half] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    return k;
  }

  /** Blurs the grid (nx columns of ny) along x with kx, then along y with ky: a Gaussian in two dimensions. */
  function blur(g: Float64Array, nx: number, ny: number, kx: Float64Array, ky: Float64Array): Float64Array {
    const tmp = new Float64Array(g.length);
    const hx = (kx.length - 1) / 2;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let s = 0;
        for (let k = Math.max(-hx, -i); k <= Math.min(hx, nx - 1 - i); k++) s += g[j * nx + i + k] * kx[k + hx];
        tmp[j * nx + i] = s;
      }
    const out = new Float64Array(g.length);
    const hy = (ky.length - 1) / 2;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let s = 0;
        for (let k = Math.max(-hy, -j); k <= Math.min(hy, ny - 1 - j); k++) s += tmp[(j + k) * nx + i] * ky[k + hy];
        out[j * nx + i] = s;
      }
    return out;
  }

  /**
   * The outlines of where the grid is at least `t`, by marching squares, in grid units (x right, y up). Outside the grid
   * it is 0, so every outline closes. Each runs with the inside on its left: around a region it goes counterclockwise,
   * around a hole in one clockwise, so a path of all of them filled with the nonzero rule leaves the holes empty.
   */
  function outlines(g: Float64Array, nx: number, ny: number, t: number): [number, number][][] {
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : g[j * nx + i]);
    const W = nx + 2;
    const node = (i: number, j: number) => (j + 1) * W + (i + 1);
    // an edge is named by its lower node: 2n for the one to the right, 2n + 1 for the one up
    const point = (edge: number): [number, number] => {
      const n = edge >> 1;
      const i = (n % W) - 1;
      const j = Math.floor(n / W) - 1;
      const up = edge & 1;
      const v0 = at(i, j);
      const v1 = up ? at(i, j + 1) : at(i + 1, j);
      const f = v1 === v0 ? 0.5 : (t - v0) / (v1 - v0);
      return up ? [i, j + f] : [i + f, j];
    };
    const next = new Map<number, number>();
    for (let j = -1; j < ny; j++)
      for (let i = -1; i < nx; i++) {
        // the corners counterclockwise from the bottom left, and the edges between them in the same order
        const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const inside = v.map((x) => x >= t);
        if (inside[0] === inside[1] && inside[1] === inside[2] && inside[2] === inside[3]) continue;
        const edges = [2 * node(i, j), 2 * node(i + 1, j) + 1, 2 * node(i, j + 1), 2 * node(i, j) + 1];
        const crossings: { edge: number; out: boolean }[] = [];
        for (let k = 0; k < 4; k++) if (inside[k] !== inside[(k + 1) % 4]) crossings.push({ edge: edges[k], out: inside[k] });
        // leaving the inside, the outline runs to where it comes back in: the next crossing round the cell, or in a
        // saddle (two opposite corners inside) the next one if the middle of the cell is inside and the one before if not
        const turn = crossings.length === 4 && (v[0] + v[1] + v[2] + v[3]) / 4 < t ? 3 : 1;
        crossings.forEach((c, k) => {
          if (c.out) next.set(c.edge, crossings[(k + turn) % crossings.length].edge);
        });
      }
    const rings: [number, number][][] = [];
    for (const start of next.keys()) {
      if (!next.has(start)) continue;
      const ring: [number, number][] = [];
      let e = start;
      while (next.has(e)) {
        ring.push(point(e));
        const to = next.get(e) as number;
        next.delete(e);
        e = to;
      }
      if (ring.length > 2) rings.push(ring);
    }
    return rings;
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'contour',
    version: 2,
    requires: ['lib.columns', 'lib.stats'],
    replacesColumns: true,
    doc: 'Density contours, for a scatter of too many points to read: where the points of two measures gather, as regions nested like the rings of a map. It smooths the points into a density (a kernel density estimate in two dimensions) and draws the outline of where it is at least each of a few levels. A row of the result is a point of an outline, under the names of `x` and `y`, in order; `ring` names its outline and `level` the region it bounds, 1 the outermost; `share` is how many of the points lie inside that region (0 to 1) and `density` the level itself. Draw it with mark.polygon (`group: "level"`, `ring: "ring"`), colored by `share` or `level` on a sequential scale; outlines of holes run the other way, so a region with a hole in it is drawn with the hole. Rows where x or y is not a number are left out.',
    params: {
      x: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field along x.' },
      y: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field along y.' },
      shares: {
        kind: 'list',
        doc: 'Regions by how many of the points they hold: [0.25, 0.5, 0.75, 0.95] draws the smallest region with a quarter of the points, then with half, and so on (each number above 0 and below 1). Without it, `levels` regions at even steps of the density.',
      },
      levels: {
        kind: 'number',
        default: LEVELS,
        doc: 'How many regions, at even steps of the density up to its peak, when there are no `shares` (1 to 50).',
      },
      bandwidth: {
        kind: 'list',
        doc: "How smooth the density is: [along x, along y], in the units of each field, the width of the bump each point adds. Default: Scott's rule on each axis; null keeps it on one axis. Smaller shows more detail and more noise.",
      },
      extent: {
        kind: 'list',
        doc: 'Where the regions are cut, [[x low, x high], [y low, y high]], each end a number or null for none: [[0, null], [0, null]] for distances and times, which cannot be negative, so no region runs below 0. A point outside it is outside every region.',
      },
      grid: {
        kind: 'number',
        default: GRID,
        doc: 'Cells of the grid the density is worked out on, along each axis (8 to 400). More draws smoother outlines.',
      },
    },
    outputs(spec) {
      const out = ['level', 'share', 'density', 'ring'];
      for (const f of [spec.x, spec.y]) if (typeof f === 'string') out.push(f);
      return out;
    },
    apply(table, spec) {
      const xf = spec.x as string;
      const yf = spec.y as string;
      checkColumns(
        table,
        [
          ['x', xf],
          ['y', yf],
        ],
        [
          ['x', xf],
          ['y', yf],
          ['level', 'level'],
          ['share', 'share'],
          ['density', 'density'],
          ['ring', 'ring'],
        ],
        // the result is a table of its own, so the data's columns are no matter; only its own names must differ
        Object.keys(table.columns),
      );
      const grid = spec.grid === undefined ? GRID : (spec.grid as number);
      if (!(typeof grid === 'number' && Math.floor(grid) === grid && grid >= 8 && grid <= MAX_GRID))
        fail(`"grid" must be a whole number from 8 to ${MAX_GRID}`);
      const levels = spec.levels === undefined ? LEVELS : (spec.levels as number);
      if (!(typeof levels === 'number' && Math.floor(levels) === levels && levels >= 1 && levels <= MAX_LEVELS))
        fail(`"levels" must be a whole number from 1 to ${MAX_LEVELS}`);
      let shares: number[] | undefined;
      if (spec.shares !== undefined) {
        const s = spec.shares;
        if (!Array.isArray(s) || !s.length || s.length > MAX_LEVELS || !s.every((v) => typeof v === 'number' && v > 0 && v < 1))
          fail(`"shares" must be a list of up to ${MAX_LEVELS} numbers above 0 and below 1, like [0.25, 0.5, 0.75]`);
        shares = (s as number[]).slice();
      }
      let given: (number | null)[] = [null, null];
      if (spec.bandwidth !== undefined) {
        const b = spec.bandwidth;
        if (!Array.isArray(b) || b.length !== 2 || !b.every((v) => v === null || (typeof v === 'number' && v > 0 && isFinite(v))))
          fail('"bandwidth" must be [along x, along y]: two positive numbers, or null to keep one to the rule');
        given = b as (number | null)[];
      }
      let cut: (number | null)[][] = [
        [null, null],
        [null, null],
      ];
      if (spec.extent !== undefined) {
        const e = spec.extent;
        const range = (r: unknown) =>
          r === null ||
          (Array.isArray(r) &&
            r.length === 2 &&
            r.every((v) => v === null || (typeof v === 'number' && isFinite(v))) &&
            !(typeof r[0] === 'number' && typeof r[1] === 'number' && r[0] >= r[1]));
        if (!Array.isArray(e) || e.length !== 2 || !e.every(range))
          fail(
            '"extent" must be [[x low, x high], [y low, y high]], each end a number or null, the low below the high, like [[0, null], [0, null]]',
          );
        cut = (e as ((number | null)[] | null)[]).map((r) => r || [null, null]);
      }

      const num = (v: unknown): number => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : NaN);
      const xsIn = table.columns[xf];
      const ysIn = table.columns[yf];
      const px: number[] = [];
      const py: number[] = [];
      for (let k = 0; k < table.length; k++) {
        const x = num(xsIn[k]);
        const y = num(ysIn[k]);
        if (isFinite(x) && isFinite(y)) (px.push(x), py.push(y));
      }
      const cols: Record<string, number[]> = { level: [], share: [], density: [], ring: [], [xf]: [], [yf]: [] };
      const n = px.length;
      if (!n) return { length: 0, columns: cols };
      // in order of x, then y: sums come out the same to the last digit whatever the order of the data
      const order = px.map((_, k) => k).sort((a, b) => px[a] - px[b] || py[a] - py[b]);
      const xs = Float64Array.from(order, (k) => px[k]);
      const ys = Float64Array.from(order, (k) => py[k]);
      const bx = given[0] ?? bandwidthOf(xs);
      const by = given[1] ?? bandwidthOf(ys);
      let xmin = Infinity;
      let xmax = -Infinity;
      let ymin = Infinity;
      let ymax = -Infinity;
      for (let k = 0; k < n; k++) {
        xmin = Math.min(xmin, xs[k]);
        xmax = Math.max(xmax, xs[k]);
        ymin = Math.min(ymin, ys[k]);
        ymax = Math.max(ymax, ys[k]);
      }
      // the grid reaches 3 bandwidths past the data, where a single point has faded to a hundredth of its peak, or to a cut
      const gx0 = cut[0][0] ?? xmin - 3 * bx;
      const gy0 = cut[1][0] ?? ymin - 3 * by;
      const gx1 = cut[0][1] ?? xmax + 3 * bx;
      const gy1 = cut[1][1] ?? ymax + 3 * by;
      if (!(gx1 > gx0 && gy1 > gy0)) fail('"extent" leaves no room for the points');
      const cx = (gx1 - gx0) / (grid - 1);
      const cy = (gy1 - gy0) / (grid - 1);
      /** Where a point is on the grid: the node at its bottom left and how far on from it, or null outside the grid. */
      const cell = (x: number, y: number) => {
        const fx = (x - gx0) / cx;
        const fy = (y - gy0) / cy;
        if (!(fx >= 0 && fy >= 0 && fx <= grid - 1 && fy <= grid - 1)) return null;
        const i = Math.min(grid - 2, Math.floor(fx));
        const j = Math.min(grid - 2, Math.floor(fy));
        return { i, j, u: fx - i, v: fy - j };
      };
      // each point shared out between the four nodes around it, then blurred: the density at the nodes, per unit of x
      // times unit of y, of a total of 1
      let g: Float64Array = new Float64Array(grid * grid);
      for (let k = 0; k < n; k++) {
        const c = cell(xs[k], ys[k]);
        if (!c) continue; // beyond a cut
        const { i, j, u, v } = c;
        g[j * grid + i] += (1 - u) * (1 - v);
        g[j * grid + i + 1] += u * (1 - v);
        g[(j + 1) * grid + i] += (1 - u) * v;
        g[(j + 1) * grid + i + 1] += u * v;
      }
      g = blur(g, grid, grid, kernelOf(bx / cx), kernelOf(by / cy));
      const scale = 1 / (n * cx * cy);
      for (let k = 0; k < g.length; k++) g[k] *= scale;
      // the density at each point, read off the grid the same way, so a point is inside a region when it is above its level
      const at = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const c = cell(xs[k], ys[k]);
        if (!c) continue; // beyond a cut: in no region
        const { i, j, u, v } = c;
        at[k] =
          g[j * grid + i] * (1 - u) * (1 - v) +
          g[j * grid + i + 1] * u * (1 - v) +
          g[(j + 1) * grid + i] * (1 - u) * v +
          g[(j + 1) * grid + i + 1] * u * v;
      }
      const ranked = Array.from(at).sort((a, b) => b - a);
      let peak = 0;
      for (let k = 0; k < g.length; k++) peak = Math.max(peak, g[k]);
      // the levels, lowest first: from shares, the density of the point that brings the region up to its share of them
      const thresholds = shares
        ? shares.map((s) => ranked[Math.max(0, Math.ceil(s * n) - 1)])
        : Array.from({ length: levels }, (_, k) => (peak * (k + 1)) / (levels + 1));
      const sortedT = Array.from(new Set(thresholds.filter((t) => t > 0))).sort((a, b) => a - b);
      let ringId = 0;
      sortedT.forEach((t, k) => {
        let inside = 0;
        for (let p = 0; p < n; p++) if (at[p] >= t) inside++;
        for (const ring of outlines(g, grid, grid, t)) {
          for (const [i, j] of ring) {
            cols.level.push(k + 1);
            cols.share.push(inside / n);
            cols.density.push(t);
            cols.ring.push(ringId);
            // an outline that meets a cut runs along it (outside the grid is 0, so it would close a little beyond)
            cols[xf].push(gx0 + Math.min(grid - 1, Math.max(0, i)) * cx);
            cols[yf].push(gy0 + Math.min(grid - 1, Math.max(0, j)) * cy);
          }
          ringId++;
        }
      });
      return { length: cols.level.length, columns: cols };
    },
  };

  BC.define(def);
})((globalThis as any).BC);
