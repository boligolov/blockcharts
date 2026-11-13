(function (BC: BC.Runtime) {
  type Check = (block: string, table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) => void;
  /** The fields it reads must exist and the columns it writes must not replace others: lib.columns, listed in
   *  `requires` so it is on the page. */
  const checkColumns = (table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]) =>
    ((BC.get('lib.columns') as BC.LibDef).exports.check as Check)('transform.sankey', table, reads, writes, keep);

  const GAP = 0.03;
  /** Passes of ordering each column by where its neighbours are: enough for the crossings to settle. */
  const ORDER_PASSES = 8;
  const NAMES = ['x0', 'x1', 'y0', 'y1', 'thickness', 'waypoints'];

  interface Node {
    name: string;
    layer: number;
    value: number;
    /** Top and height, in shares of the height of the plot from its top. */
    y: number;
    h: number;
    ins: Link[];
    outs: Link[];
  }
  interface Link {
    row: number;
    from: Node;
    to: Node;
    value: number;
    thick: number;
    /** Tops of the ribbon at its two ends. */
    top0: number;
    top1: number;
    /** A flow that reaches past the next column runs through a place of its own in each column between: the pieces
     *  from column to column, through nodes no one sees. */
    parts?: Link[];
  }

  function fail(message: string): never {
    throw new Error('transform.sankey: ' + message);
  }

  function namesOf(spec: BC.TransformSpec): string[] {
    if (spec.as === undefined) return NAMES;
    const as = spec.as;
    if (!Array.isArray(as) || (as.length !== 5 && as.length !== 6) || !as.every((n) => typeof n === 'string' && n))
      fail('"as" must be six column names: [x0, x1, y0, y1, thickness, waypoints] (five keep "waypoints")');
    return as.length === 6 ? (as as string[]) : (as as string[]).concat(NAMES[5]);
  }

  const present = (v: unknown) => v !== null && v !== undefined && v !== '';

  /** Every node goes one column past the furthest node that flows into it, and a node nothing leaves goes to the last
   *  column. Flows run one way, so a loop has no layout; the error says which nodes are in it. */
  function assignLayers(nodes: Node[]): number {
    const waiting = new Map<Node, number>(nodes.map((n) => [n, n.ins.length]));
    const ready = nodes.filter((n) => !n.ins.length);
    let done = 0;
    while (done < ready.length) {
      const n = ready[done++];
      for (const l of n.outs) {
        l.to.layer = Math.max(l.to.layer, n.layer + 1);
        const left = (waiting.get(l.to) as number) - 1;
        waiting.set(l.to, left);
        if (!left) ready.push(l.to);
      }
    }
    if (done < nodes.length) {
      const stuck = nodes.filter((n) => (waiting.get(n) as number) > 0).map((n) => `"${n.name}"`);
      fail(`the flows go round in a loop through ${stuck.slice(0, 6).join(', ')}; a Sankey needs them to run one way`);
    }
    const last = nodes.reduce((m, n) => Math.max(m, n.layer), 0);
    for (const n of nodes) if (!n.outs.length) n.layer = last;
    return last;
  }

  /** A flow from column 1 to column 3 would run behind the nodes of column 2: it is cut into pieces through a node no
   *  one sees in each column between, which takes its place in the order and the height of that column like any other,
   *  so the ribbon passes through a gap of its own. */
  function throughColumns(links: Link[], nodes: Node[]): void {
    for (const l of links) {
      if (l.to.layer - l.from.layer < 2) continue;
      const take = (list: Link[]) => list.splice(list.indexOf(l), 1);
      take(l.from.outs);
      take(l.to.ins);
      l.parts = [];
      let at = l.from;
      for (let layer = l.from.layer + 1; layer <= l.to.layer; layer++) {
        let next = l.to;
        if (layer < l.to.layer) {
          next = { name: '', layer, value: 0, y: 0, h: 0, ins: [], outs: [] };
          nodes.push(next);
        }
        const part: Link = { row: l.row, from: at, to: next, value: l.value, thick: 0, top0: 0, top1: 0 };
        at.outs.push(part);
        next.ins.push(part);
        l.parts.push(part);
        at = next;
      }
    }
  }

  /** The value-weighted middle of the other ends of some links, or NaN when there are none. */
  function middle(links: Link[], end: (l: Link) => Node, rank: Map<Node, number>): number {
    let sum = 0;
    let weight = 0;
    for (const l of links) {
      sum += (rank.get(end(l)) as number) * l.value;
      weight += l.value;
    }
    return weight ? sum / weight : NaN;
  }

  /** Orders the columns to cross less: each is sorted by where its neighbours are, sweeping right and then left. */
  function orderColumns(columns: Node[][]): void {
    const rank = new Map<Node, number>();
    const remember = (col: Node[]) => col.forEach((n, i) => rank.set(n, i / Math.max(1, col.length - 1)));
    const sort = (col: Node[], score: (n: Node) => number) => {
      const place = new Map(col.map((n) => [n, score(n)] as [Node, number]));
      const start = new Map(col.map((n, i) => [n, i] as [Node, number]));
      const at = (n: Node) => {
        const s = place.get(n) as number;
        return isNaN(s) ? (rank.get(n) as number) : s; // with nothing to go by a node stays where it is
      };
      col.sort((a, b) => at(a) - at(b) || (start.get(a) as number) - (start.get(b) as number));
      remember(col);
    };
    columns.forEach(remember);
    for (let pass = 0; pass < ORDER_PASSES; pass++) {
      const right = pass % 2 === 0;
      const sweep = right ? columns.slice(1) : columns.slice(0, -1).reverse();
      for (const col of sweep) sort(col, (n) => (right ? middle(n.ins, (l) => l.from, rank) : middle(n.outs, (l) => l.to, rank)));
    }
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'sankey',
    version: 3,
    requires: ['lib.columns'],
    doc: 'The layout of a Sankey diagram, for mark.sankey: one row per flow, from `source` to `target`, its thickness in proportion to `value`. Columns come from the flows themselves: a node goes to the right of everything that flows into it, and a node nothing leaves to the last column; a flow that reaches past the next column gets a place of its own in each column between, so its ribbon runs through a gap rather than behind a node; the nodes of a column are ordered so that ribbons cross as little as they can, and every value is the same height in every column. It keeps the rows and writes on each flow where its ribbon runs, in shares of the plot: `x0` and `x1`, the columns it leaves and reaches (0 the first, 1 the last); `y0` and `y1`, the top of the ribbon at either end (0 the top of the plot, 1 its bottom); `thickness`; and `waypoints`, the column and the top of the ribbon in each column it passes ([x, top, x, top, ...], empty for a flow to the next column). A row with no positive value or no name, or a flow from a node to itself, gets none. Flows have to run one way: a loop is an error that names it.',
    params: {
      source: { kind: 'field', required: true, doc: 'Field with the name of the node a flow leaves.' },
      target: { kind: 'field', required: true, doc: 'Field with the name of the node a flow arrives at.' },
      value: { kind: 'field', reads: 'number', required: true, doc: 'Numeric field: the size of the flow.' },
      nodeGap: {
        kind: 'number',
        default: GAP,
        doc: 'Space between the nodes of a column, as a share of the height of the plot; it shrinks when a column is full, so the gaps take at most half of it.',
      },
      as: { kind: 'list', doc: 'Names of the new columns: [x0, x1, y0, y1, thickness, waypoints]; five names keep "waypoints".' },
    },
    outputs: (spec) => namesOf(spec),
    apply(table, spec) {
      const names = namesOf(spec);
      const [sf, tf, vf] = [spec.source, spec.target, spec.value] as string[];
      checkColumns(
        table,
        [
          ['source', sf],
          ['target', tf],
          ['value', vf],
        ],
        names.map((n, k) => [`as[${k}]`, n] as [string, string]),
        [],
      );
      const gapWanted = spec.nodeGap === undefined ? GAP : (spec.nodeGap as number);
      if (!(typeof gapWanted === 'number' && gapWanted >= 0 && gapWanted < 1))
        fail('"nodeGap" must be a share of the height, from 0 to below 1');
      const sources = table.columns[sf];
      const targets = table.columns[tf];
      const values = table.columns[vf];
      const byName = new Map<string, Node>();
      const node = (name: string) => {
        let n = byName.get(name);
        if (!n) byName.set(name, (n = { name, layer: 0, value: 0, y: 0, h: 0, ins: [], outs: [] }));
        return n;
      };
      const links: Link[] = [];
      for (let row = 0; row < table.length; row++) {
        const v = values[row];
        if (typeof v !== 'number' || !isFinite(v) || v <= 0 || !present(sources[row]) || !present(targets[row])) continue;
        const a = node(String(sources[row]));
        const b = node(String(targets[row]));
        if (a === b) continue;
        const link = { row, from: a, to: b, value: v, thick: 0, top0: 0, top1: 0 };
        links.push(link);
        a.outs.push(link);
        b.ins.push(link);
      }
      // nodes only a dropped row named have no flow and no place
      const nodes = Array.from(byName.values()).filter((n) => n.ins.length || n.outs.length);
      const cols: Record<string, (number | number[] | null)[]> = {};
      for (const n of names) cols[n] = new Array(table.length).fill(n === names[5] ? null : NaN);
      const out = { length: table.length, columns: { ...table.columns, ...cols } as Record<string, BC.Column> };
      if (!links.length) return out;

      const last = assignLayers(nodes);
      throughColumns(links, nodes);
      const columns: Node[][] = Array.from({ length: last + 1 }, () => []);
      for (const n of nodes) {
        n.value = Math.max(
          n.ins.reduce((a, l) => a + l.value, 0),
          n.outs.reduce((a, l) => a + l.value, 0),
        );
        columns[n.layer].push(n);
      }
      orderColumns(columns);
      const tallest = columns.reduce((m, c) => Math.max(m, c.length), 1);
      // gaps never take more than half of the height, however many nodes there are
      const gap = Math.min(gapWanted, 0.5 / Math.max(1, tallest - 1));
      // one scale for all the columns, set by the fullest: a value is the same height everywhere
      let k = Infinity;
      for (const col of columns) {
        const sum = col.reduce((a, n) => a + n.value, 0);
        k = Math.min(k, (1 - gap * (col.length - 1)) / sum);
      }
      for (const col of columns) {
        const used = col.reduce((a, n) => a + n.value * k, 0) + gap * (col.length - 1);
        let top = (1 - used) / 2;
        for (const n of col) {
          n.y = top;
          n.h = n.value * k;
          top += n.h + gap;
        }
      }
      for (const l of links) for (const p of l.parts || [l]) p.thick = l.value * k;
      // the ribbons of a node stack in the order of the other ends, so they do not cross at the node
      for (const n of nodes) {
        let at = n.y;
        for (const l of n.outs.slice().sort((a, b) => a.to.y - b.to.y || a.row - b.row)) {
          l.top0 = at;
          at += l.thick;
        }
        at = n.y;
        for (const l of n.ins.slice().sort((a, b) => a.from.y - b.from.y || a.row - b.row)) {
          l.top1 = at;
          at += l.thick;
        }
      }
      const [x0, x1, y0, y1, thick, through] = names.map((n) => cols[n]);
      for (const l of links) {
        const parts = l.parts || [l];
        x0[l.row] = last ? l.from.layer / last : 0;
        x1[l.row] = last ? l.to.layer / last : 0;
        y0[l.row] = parts[0].top0;
        y1[l.row] = parts[parts.length - 1].top1;
        thick[l.row] = l.value * k;
        through[l.row] = parts.slice(0, -1).flatMap((p) => [p.to.layer / last, p.to.y]);
      }
      return out;
    },
  };

  BC.define(def);
})((globalThis as any).BC);
