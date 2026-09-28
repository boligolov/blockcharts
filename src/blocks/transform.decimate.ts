(function () {
  const MARGIN = 12; // px around the plot that are kept, as the culling in the core does
  const MAX_BUCKETS = 20000;

  type Rows = Int32Array;
  interface Order { scale: BC.Scale; dir: number }

  // Both caches are keyed by the column objects of the table the transform gets. That table is the same object at every
  // redraw (only the view changes), so the work of partitioning and of checking the order is done once, not per frame.
  const partitions = new WeakMap<BC.Column, { key: unknown; rows: Rows }[]>();
  const orders = new WeakMap<Rows, Order>();

  function partitionsOf(key: BC.Column, groups: BC.Column | undefined, n: number): { key: unknown; rows: Rows }[] {
    const known = partitions.get(key);
    if (known && known.length && (groups ? true : known[0].rows.length === n)) return known;
    const lists = new Map<unknown, number[]>();
    if (groups) {
      for (let i = 0; i < n; i++) {
        const list = lists.get(groups[i]);
        if (list) list.push(i);
        else lists.set(groups[i], [i]);
      }
    } else {
      const all = new Int32Array(n);
      for (let i = 0; i < n; i++) all[i] = i;
      const out = [{ key: undefined as unknown, rows: all }];
      partitions.set(key, out);
      return out;
    }
    const out: { key: unknown; rows: Rows }[] = [];
    lists.forEach((list, k) => out.push({ key: k, rows: Int32Array.from(list) }));
    partitions.set(key, out);
    return out;
  }

  /** 1 / -1 when the rows run in one direction through the scale, 0 when the order cannot be trusted. */
  function orderOf(rows: Rows, xs: BC.Column, scale: BC.Scale): number {
    const known = orders.get(rows);
    if (known && known.scale === scale) return known.dir;
    const n = rows.length;
    if (xs instanceof Float64Array && scale.invert && n >= 2) {
      // numbers through a continuous scale: monotone, so the order can be read off the raw values (much cheaper than
      // mapping every row); the scale only says which way it points
      let rawUp = true;
      let rawDown = true;
      for (let k = 1; k < n && (rawUp || rawDown); k++) {
        const v = xs[rows[k]];
        const u = xs[rows[k - 1]];
        if (v !== v || u !== u) {
          rawUp = false;
          rawDown = false;
        } else {
          if (v < u) rawUp = false;
          if (v > u) rawDown = false;
        }
      }
      const a = xs[rows[0]];
      const b = xs[rows[n - 1]];
      let dir = 0;
      if (a === a && b === b && a !== b) {
        const points = (scale(b) as number) > (scale(a) as number) ? 1 : -1;
        dir = rawUp ? points : rawDown ? -points : 0;
      }
      orders.set(rows, { scale, dir });
      return dir;
    }
    let up = true;
    let down = true;
    let prev = 0;
    for (let k = 0; k < n && (up || down); k++) {
      const p = scale(xs[rows[k]]) as number;
      if (typeof p !== 'number' || p !== p) {
        up = false;
        down = false;
        break;
      }
      if (k > 0) {
        if (p < prev) up = false;
        if (p > prev) down = false;
      }
      prev = p;
    }
    const dir = n < 2 ? 0 : up ? 1 : down ? -1 : 0;
    orders.set(rows, { scale, dir });
    return dir;
  }

  const firstWhere = (n: number, test: (k: number) => boolean): number => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (test(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'decimate',
    version: 2,
    viewDependent: true,
    doc: 'Level of detail for long lines: keeps only the rows that can change how a line looks. Redone at every zoom. Inside the visible window it splits x into pixel columns and keeps the first, last, lowest and highest row of each, so the envelope of the data is exact; outside the window (beyond a small margin) it drops the rows. Windows that hold few rows are left whole. Needs data sorted by x (per `group`); anything else is passed through unchanged. Put it after transforms that create the rows and before the line mark reads them.',
    params: {
      x: { kind: 'field', required: true, doc: 'The x field of the line.' },
      y: { kind: 'field', required: true, doc: 'The y field of the line.' },
      scale: { kind: 'scale', default: 'x', doc: 'Name of the x scale.' },
      group: { kind: 'field', doc: 'Decimate every series (value of this field) on its own.' },
      buckets: { kind: 'number', doc: 'Pixel columns to split the plot width into. Default: one per px of plot width.' },
      threshold: { kind: 'number', default: 4, doc: 'Decimate only when the window holds more than `threshold` rows per column.' },
    },
    outputs: () => [],
    apply(table, spec, view) {
      if (!view) return table;
      const xField = spec.x as string;
      const yField = spec.y as string;
      const xs = table.columns[xField];
      const ys = table.columns[yField];
      if (!xs) throw new Error(`transform.decimate: unknown field "${xField}"`);
      if (!ys) throw new Error(`transform.decimate: unknown field "${yField}"`);
      const groupField = typeof spec.group === 'string' ? spec.group : undefined;
      const groups = groupField ? table.columns[groupField] : undefined;
      if (groupField && !groups) throw new Error(`transform.decimate: unknown field "${groupField}"`);
      const scaleName = typeof spec.scale === 'string' ? spec.scale : 'x';
      const scale = view.scales[scaleName];
      if (!scale) throw new Error(`transform.decimate: there is no scale named "${scaleName}"`);
      const range = scale.range() as unknown[];
      if (typeof range[0] !== 'number' || typeof range[1] !== 'number') return table;
      if (spec.buckets !== undefined && !(typeof spec.buckets === 'number' && spec.buckets >= 1 && spec.buckets <= MAX_BUCKETS)) {
        throw new Error(`transform.decimate: "buckets" must be a number from 1 to ${MAX_BUCKETS}`);
      }
      const threshold = typeof spec.threshold === 'number' && spec.threshold > 0 ? spec.threshold : 4;
      const lo = Math.min(range[0], range[1]) - MARGIN;
      const hi = Math.max(range[0], range[1]) + MARGIN;
      const buckets = Math.max(1, Math.floor(typeof spec.buckets === 'number' ? spec.buckets : Math.abs(range[1] - range[0])));
      const width = (hi - lo) / buckets;

      const keep: number[] = [];
      let changed = false;
      for (const part of partitionsOf(groups || xs, groups, table.length)) {
        const rows = part.rows;
        const n = rows.length;
        const dir = orderOf(rows, xs, scale);
        if (!dir) {
          // order unknown: this series is passed through whole, and that is worth saying when it defeats the purpose
          for (let k = 0; k < n; k++) keep.push(rows[k]);
          if (n > threshold * buckets) {
            const which = part.key === undefined ? 'the rows' : `series ${JSON.stringify(part.key)}`;
            view.warn(`${which} are not sorted by "${xField}" (or have a missing "${xField}"), so decimate left ${n} rows as they are; sort the data by "${xField}" first`);
          }
          continue;
        }
        const px = (k: number) => scale(xs[rows[k]]) as number;
        const start = dir === 1 ? firstWhere(n, (k) => px(k) >= lo) : firstWhere(n, (k) => px(k) <= hi);
        const end = dir === 1 ? firstWhere(n, (k) => px(k) > hi) : firstWhere(n, (k) => px(k) < lo);
        const from = Math.max(0, start - 1);
        const to = Math.min(n, end + 1);
        if (from > 0 || to < n) changed = true;
        if (to - from <= threshold * buckets) {
          for (let k = from; k < to; k++) keep.push(rows[k]);
          continue;
        }
        changed = true;
        // first, last, lowest and highest row of every pixel column, in x order; a missing y ends a column and is kept,
        // so gaps in the line stay gaps
        let bucket = -1;
        let first = 0;
        let last = 0;
        let minAt = 0;
        let maxAt = 0;
        let minY = 0;
        let maxY = 0;
        const flush = () => {
          if (bucket < 0) return;
          const picked = [first, minAt, maxAt, last].sort((a, b) => a - b);
          let prev = -1;
          for (const k of picked) {
            if (k !== prev) keep.push(rows[k]);
            prev = k;
          }
          bucket = -1;
        };
        for (let k = from; k < to; k++) {
          const y = ys[rows[k]];
          if (typeof y !== 'number' || y !== y) {
            flush();
            keep.push(rows[k]);
            continue;
          }
          const b = Math.max(0, Math.min(buckets - 1, Math.floor((px(k) - lo) / width)));
          if (b !== bucket) {
            flush();
            bucket = b;
            first = last = minAt = maxAt = k;
            minY = maxY = y;
            continue;
          }
          last = k;
          if (y < minY) {
            minY = y;
            minAt = k;
          }
          if (y > maxY) {
            maxY = y;
            maxAt = k;
          }
        }
        flush();
      }
      if (!changed) return table;

      const m = keep.length;
      const columns: Record<string, BC.Column> = {};
      for (const name of Object.keys(table.columns)) {
        const col = table.columns[name];
        const out = col instanceof Float64Array ? new Float64Array(m) : new Array(m);
        for (let i = 0; i < m; i++) out[i] = col[keep[i]] as never;
        columns[name] = out;
      }
      return { length: m, columns };
    },
  };

  BC.define(def);
})();
