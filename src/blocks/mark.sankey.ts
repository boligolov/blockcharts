(function () {
  const TEXT = 'var(--bc-text, #444)';
  const NODE_WIDTH = 12;
  const MAX_GAP = 12;
  const LABEL_GAP = 6;
  const LABEL_SIZE = 12;
  /** Passes of ordering each column by where its neighbours are: enough for the crossings to settle. */
  const ORDER_PASSES = 8;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  interface Node {
    name: string;
    order: number;
    layer: number;
    value: number;
    x: number;
    y: number;
    h: number;
    color: string;
    ins: Link[];
    outs: Link[];
  }
  interface Link {
    row: number;
    from: Node;
    to: Node;
    value: number;
    thick: number;
    /** Centers of the ribbon at its two ends. */
    y0: number;
    y1: number;
  }
  interface Geometry {
    nodes: Node[];
    links: Link[];
  }

  const present = (v: unknown) => v !== null && v !== undefined && v !== '';

  /** Gathers the flows into nodes and links. Rows with no flow are left out, and so is a flow from a node to itself, which
   *  has no direction to draw in. */
  function collect(spec: BC.MarkSpec, ctx: BC.ChartCtx): Geometry {
    const sources = ctx.channel(spec, 'source').raw;
    const targets = ctx.channel(spec, 'target').raw;
    const values = ctx.channel(spec, 'value').raw;
    const { from, to } = ctx.rows(spec);
    const byName = new Map<string, Node>();
    const node = (name: string) => {
      let n = byName.get(name);
      if (!n) {
        n = { name, order: byName.size, layer: 0, value: 0, x: 0, y: 0, h: 0, color: '', ins: [], outs: [] };
        byName.set(name, n);
      }
      return n;
    };
    const links: Link[] = [];
    for (let row = from; row < to; row++) {
      const v = values[row];
      if (typeof v !== 'number' || !isFinite(v) || v <= 0 || !present(sources[row]) || !present(targets[row])) continue;
      const a = node(String(sources[row]));
      const b = node(String(targets[row]));
      if (a === b) continue;
      const link = { row, from: a, to: b, value: v, thick: 0, y0: 0, y1: 0 };
      links.push(link);
      a.outs.push(link);
      b.ins.push(link);
    }
    return { nodes: Array.from(byName.values()), links };
  }

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
      throw new Error(
        `mark.sankey: the flows go round in a loop through ${stuck.slice(0, 6).join(', ')}; a Sankey needs them to run one way`,
      );
    }
    const last = nodes.reduce((m, n) => Math.max(m, n.layer), 0);
    for (const n of nodes) if (!n.outs.length) n.layer = last;
    return last;
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

  const widthOf = (spec: BC.MarkSpec, ctx: BC.ChartCtx) =>
    typeof spec.nodeWidth === 'number' && spec.nodeWidth > 0 ? Math.min(spec.nodeWidth, ctx.plot.w / 4) : NODE_WIDTH;

  /** Nodes and ribbons in px, shared by render and pick so that what is drawn is what is hit. */
  function geometry(spec: BC.MarkSpec, ctx: BC.ChartCtx): Geometry | null {
    const g = collect(spec, ctx);
    if (!g.links.length) return null;
    const last = assignLayers(g.nodes);
    const columns: Node[][] = Array.from({ length: last + 1 }, () => []);
    for (const n of g.nodes) {
      n.value = Math.max(
        n.ins.reduce((a, l) => a + l.value, 0),
        n.outs.reduce((a, l) => a + l.value, 0),
      );
      n.color = ctx.color(n.order);
      columns[n.layer].push(n);
    }
    orderColumns(columns);

    const { x, y, w, h } = ctx.plot;
    const width = widthOf(spec, ctx);
    const wanted = typeof spec.nodeGap === 'number' && spec.nodeGap >= 0 ? spec.nodeGap : MAX_GAP;
    const tallest = columns.reduce((m, c) => Math.max(m, c.length), 1);
    // gaps never take more than half of the height, however many nodes there are
    const gap = Math.min(wanted, (h * 0.5) / Math.max(1, tallest - 1));
    // one scale for all the columns, set by the fullest: a value is the same height everywhere
    let k = Infinity;
    for (const col of columns) {
      const sum = col.reduce((a, n) => a + n.value, 0);
      k = Math.min(k, (h - gap * (col.length - 1)) / sum);
    }
    columns.forEach((col, c) => {
      const used = col.reduce((a, n) => a + n.value * k, 0) + gap * (col.length - 1);
      let top = y + (h - used) / 2;
      for (const n of col) {
        n.x = x + (last ? (c / last) * (w - width) : 0);
        n.y = top;
        n.h = n.value * k;
        top += n.h + gap;
      }
    });
    for (const l of g.links) l.thick = l.value * k;
    // the ribbons of a node stack in the order of the other ends, so they do not cross at the node
    for (const n of g.nodes) {
      let at = n.y;
      for (const l of n.outs.slice().sort((a, b) => a.to.y - b.to.y || a.row - b.row)) {
        l.y0 = at + l.thick / 2;
        at += l.thick;
      }
      at = n.y;
      for (const l of n.ins.slice().sort((a, b) => a.from.y - b.from.y || a.row - b.row)) {
        l.y1 = at + l.thick / 2;
        at += l.thick;
      }
    }
    return g;
  }

  /** The ends of a ribbon: it leaves the right edge of a node and arrives at the left edge of another. */
  function span(l: Link, width: number) {
    const x0 = l.from.x + width;
    const x1 = l.to.x;
    return { x0, x1, mid: (x0 + x1) / 2 };
  }

  /** A ribbon of even vertical thickness: one curve along the top, one back along the bottom. */
  function ribbon(l: Link, width: number): string {
    const { x0, x1, mid } = span(l, width);
    const half = l.thick / 2;
    return (
      `M${r2(x0)} ${r2(l.y0 - half)}C${r2(mid)} ${r2(l.y0 - half)} ${r2(mid)} ${r2(l.y1 - half)} ${r2(x1)} ${r2(l.y1 - half)}` +
      `L${r2(x1)} ${r2(l.y1 + half)}C${r2(mid)} ${r2(l.y1 + half)} ${r2(mid)} ${r2(l.y0 + half)} ${r2(x0)} ${r2(l.y0 + half)}Z`
    );
  }

  /** The height of a ribbon's center at x: the curve's x runs one way, so halving finds it. */
  function centerAt(l: Link, width: number, px: number): number {
    const { x0, x1, mid } = span(l, width);
    const xAt = (t: number) => {
      const u = 1 - t;
      return u * u * u * x0 + 3 * u * t * (u + t) * mid + t * t * t * x1;
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const t = (lo + hi) / 2;
      if (xAt(t) < px) lo = t;
      else hi = t;
    }
    const t = (lo + hi) / 2;
    const u = 1 - t;
    return (u * u * u + 3 * u * u * t) * l.y0 + (3 * u * t * t + t * t * t) * l.y1;
  }

  /** What fits between two columns: the name and total, else the name, else as much of the name as there is room for. */
  function fitted(ctx: BC.ChartCtx, name: string, total: string | null, room: number): string {
    const fits = (t: string) => ctx.measure(t, LABEL_SIZE).w <= room;
    if (total !== null && fits(`${name} ${total}`)) return `${name} ${total}`;
    if (fits(name)) return name;
    const chars = Array.from(name);
    for (let n = chars.length - 1; n > 0; n--) {
      const cut = chars.slice(0, n).join('').trimEnd() + '…';
      if (fits(cut)) return cut;
    }
    return '';
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'sankey',
    version: 2,
    doc: 'A Sankey diagram: one row per flow, from `source` to `target`, its thickness in proportion to `value`. Columns come from the flows themselves: a node goes to the right of everything that flows into it. Needs no scales and no axes; every node is named on the chart, and has a color of the palette. Rows with no positive value are left out, and so is a flow from a node to itself. Flows have to run one way: a loop is an error. A label too long for the space between columns loses the total, then the end of the name; two labels that face each other across the last gap share it. Hovering a node lights up its flows. Give the same name to the same node in `source` and `target`, and different names to different stages (a "Direct" channel and a "Direct" segment would be one node).',
    params: {
      nodeWidth: { kind: 'number', default: NODE_WIDTH, doc: 'Width of a node, in px.' },
      nodeGap: { kind: 'number', default: MAX_GAP, doc: 'Space between the nodes of a column, in px; it shrinks when a column is full.' },
      format: { kind: 'any', doc: 'How the total of a node is written after its name. Without it, only the name.' },
      linkOpacity: { kind: 'number', default: 0.35, doc: 'Opacity of the ribbons.' },
      nodeLabels: {
        kind: 'list',
        doc: 'What a tooltip calls what flows into and out of a node: ["In", "Out"] by default. Translate it on a page in another language.',
      },
      labelMin: { kind: 'number', default: 11, doc: 'Nodes shorter than this many px get no label, so that labels do not overlap.' },
    },
    channels: {
      source: { required: true, unscaled: true, doc: 'Field with the name of the node a flow leaves.' },
      target: { required: true, unscaled: true, doc: 'Field with the name of the node a flow arrives at.' },
      value: { required: true, unscaled: true, doc: 'Numeric field: the size of the flow.' },
    },
    render(spec, ctx, index) {
      const g = geometry(spec, ctx);
      if (!g) return [];
      const width = widthOf(spec, ctx);
      const opacity = typeof spec.linkOpacity === 'number' ? spec.linkOpacity : 0.35;
      const labelMin = typeof spec.labelMin === 'number' ? spec.labelMin : 11;
      const write = spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : null;
      const out: BC.Prim[] = [];
      // the thick ribbons go first, so that a thin one is not lost under them and can be hovered
      for (const l of g.links.slice().sort((a, b) => b.thick - a.thick || a.row - b.row))
        out.push({ type: 'path', d: ribbon(l, width), style: { fill: l.from.color, opacity }, ref: { mark: index, row: l.row } });
      const right = ctx.plot.x + ctx.plot.w;
      const columns = Array.from(new Set(g.nodes.map((n) => n.x))).sort((a, b) => a - b);
      const room = (columns.length > 1 ? columns[1] - columns[0] : ctx.plot.w) - width - LABEL_GAP * 2;
      // a label goes towards the middle of the chart: the last column writes it to its left, the rest to their right
      const leftward = (n: Node) => n.x + width >= right - 0.5 && g.nodes.some((o) => o.x < n.x);
      const total = (n: Node) => (write ? write(n.value) : null);
      const widthAt = (n: Node) => ctx.measure(fitted(ctx, n.name, total(n), room), LABEL_SIZE).w;
      // the last gap is written into from both sides: two labels at one height that do not fit together take half of it each
      const limit = new Map<Node, number>();
      const beforeLast = columns[columns.length - 2];
      const labelled = g.nodes.filter((n) => n.h >= labelMin);
      for (const a of labelled.filter((n) => n.x === beforeLast && !leftward(n)))
        for (const b of labelled.filter(leftward)) {
          const sameHeight = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < LABEL_SIZE + 2;
          if (!sameHeight || widthAt(a) + widthAt(b) + LABEL_GAP <= room) continue;
          limit.set(a, (room - LABEL_GAP) / 2);
          limit.set(b, (room - LABEL_GAP) / 2);
        }
      for (const n of g.nodes) {
        out.push({ type: 'rect', x: r2(n.x), y: r2(n.y), w: width, h: r2(Math.max(1, n.h)), style: { fill: n.color } });
        if (n.h < labelMin) continue;
        const toLeft = leftward(n);
        const text = fitted(ctx, n.name, total(n), limit.get(n) ?? room);
        if (!text) continue;
        out.push({
          type: 'text',
          x: r2(toLeft ? n.x - LABEL_GAP : n.x + width + LABEL_GAP),
          y: r2(n.y + n.h / 2),
          text,
          size: LABEL_SIZE,
          anchor: toLeft ? 'end' : 'start',
          baseline: 'middle',
          style: { fill: TEXT },
        });
      }
      return out;
    },
    pick(spec, ctx, _index, px, py) {
      const g = geometry(spec, ctx);
      if (!g) return null;
      const width = widthOf(spec, ctx);
      // a node is drawn over its ribbons, and it is many rows: the card says what passes through it
      for (const n of g.nodes) {
        if (px < n.x || px > n.x + width || py < n.y || py > n.y + Math.max(1, n.h)) continue;
        const names = Array.isArray(spec.nodeLabels) ? spec.nodeLabels : [];
        const name = (k: number, d: string) => (typeof names[k] === 'string' ? (names[k] as string) : d);
        const write =
          spec.format !== undefined
            ? BC.formatter(spec.format as BC.FormatSpec | string)
            : (v: unknown) => String(+(v as number).toPrecision(6));
        const sum = (links: Link[]) => links.reduce((a, l) => a + l.value, 0);
        const lines: [string, string][] = [];
        if (n.ins.length) lines.push([name(0, 'In'), write(sum(n.ins))]);
        if (n.outs.length) lines.push([name(1, 'Out'), write(sum(n.outs))]);
        const row = (n.outs[0] || n.ins[0]).row;
        return {
          row,
          x: n.x + width / 2,
          y: n.y + n.h / 2,
          dist: 0,
          box: { x: n.x, y: n.y, w: width, h: Math.max(1, n.h) },
          card: { title: n.name, color: n.color, lines },
          flows: n.ins.concat(n.outs).map((l) => ({ d: ribbon(l, width), fill: l.from.color })),
        };
      }
      // what is on top is what the pointer is on: the thinnest ribbons are drawn last
      let best: Link | null = null;
      let center = 0;
      for (const l of g.links) {
        const { x0, x1 } = span(l, width);
        if (px < x0 || px > x1) continue;
        const c = centerAt(l, width, px);
        if (Math.abs(py - c) <= Math.max(l.thick, 2) / 2 && (!best || l.thick < best.thick)) {
          best = l;
          center = c;
        }
      }
      return best ? { row: best.row, x: px, y: center, dist: 0 } : null;
    },
  };

  BC.define(def);
})();
