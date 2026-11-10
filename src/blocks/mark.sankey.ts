(function () {
  const TEXT = 'var(--bc-text, #444)';
  const NODE_WIDTH = 12;
  const LABEL_GAP = 6;
  const LABEL_SIZE = 12;
  const LAYOUT = ['x0', 'x1', 'y0', 'y1', 'thickness'];
  const r2 = (v: number) => Math.round(v * 100) / 100;

  interface Node {
    name: string;
    /** Which node it is in the order the flows name them: its color. */
    order: number;
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

  const widthOf = (spec: BC.MarkSpec, ctx: BC.ChartCtx) =>
    typeof spec.nodeWidth === 'number' && spec.nodeWidth > 0 ? Math.min(spec.nodeWidth, ctx.plot.w / 4) : NODE_WIDTH;

  /** Nodes and ribbons in px, from the layout the rows carry in shares of the plot; shared by render and pick so that
   *  what is drawn is what is hit. A node is as tall as the more of what flows in and out, its top where its first
   *  ribbon starts. */
  function geometry(spec: BC.MarkSpec, ctx: BC.ChartCtx): Geometry | null {
    const given = spec.layout;
    if (given !== undefined && !(Array.isArray(given) && given.length === 5 && given.every((n) => typeof n === 'string' && n)))
      throw new Error('mark.sankey: "layout" must be five column names: [x0, x1, y0, y1, thickness]');
    const names = given === undefined ? LAYOUT : (given as string[]);
    const layout = names.map((n) => ctx.table.columns[n]);
    const missing = names.find((_, k) => !layout[k]);
    if (missing !== undefined)
      throw new Error(`mark.sankey: there is no column "${missing}" with the layout of the flows: put a sankey transform before it`);
    const [lx0, lx1, ly0, ly1, lth] = layout;
    const sources = ctx.channel(spec, 'source').raw;
    const targets = ctx.channel(spec, 'target').raw;
    const values = ctx.channel(spec, 'value').raw;
    const { x, y, w, h } = ctx.plot;
    const width = widthOf(spec, ctx);
    const { from, to } = ctx.rows(spec);
    const byName = new Map<string, Node & { top: number; inH: number; outH: number; inV: number; outV: number }>();
    const links: Link[] = [];
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : NaN);
    for (let row = from; row < to; row++) {
      const v = values[row];
      const [a0, a1, t0, t1, th] = [num(lx0[row]), num(lx1[row]), num(ly0[row]), num(ly1[row]), num(lth[row])];
      if (typeof v !== 'number' || !(v > 0) || !present(sources[row]) || !present(targets[row])) continue;
      if (!(isFinite(a0) && isFinite(a1) && isFinite(t0) && isFinite(t1) && th >= 0)) continue;
      const node = (name: string, share: number) => {
        let n = byName.get(name);
        if (!n) {
          n = {
            name,
            order: byName.size,
            value: 0,
            x: x + share * (w - width),
            y: 0,
            h: 0,
            color: '',
            ins: [],
            outs: [],
            top: Infinity,
            inH: 0,
            outH: 0,
            inV: 0,
            outV: 0,
          };
          byName.set(name, n);
        }
        return n;
      };
      const a = node(String(sources[row]), a0);
      const b = node(String(targets[row]), a1);
      if (a === b) continue;
      const link: Link = { row, from: a, to: b, value: v, thick: th * h, y0: y + (t0 + th / 2) * h, y1: y + (t1 + th / 2) * h };
      links.push(link);
      a.outs.push(link);
      b.ins.push(link);
      a.top = Math.min(a.top, t0);
      b.top = Math.min(b.top, t1);
      a.outH += th;
      b.inH += th;
      a.outV += v;
      b.inV += v;
    }
    if (!links.length) return null;
    const nodes = Array.from(byName.values());
    for (const n of nodes) {
      n.y = y + n.top * h;
      n.h = Math.max(n.inH, n.outH) * h;
      n.value = Math.max(n.inV, n.outV);
      n.color = ctx.color(n.order);
    }
    return { nodes, links };
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
    version: 4,
    doc: 'A Sankey diagram: one row per flow, from `source` to `target`, its thickness in proportion to `value`, drawn where transform.sankey lays it out (put it in `transforms` with the same three fields). Needs no scales and no axes; every node is named on the chart, and has a color of the palette. A label too long for the space between columns loses the total, then the end of the name; two labels that face each other across the last gap share it. Hovering a node lights up its flows. Give the same name to the same node in `source` and `target`, and different names to different stages (a "Direct" channel and a "Direct" segment would be one node).',
    params: {
      nodeWidth: { kind: 'number', default: NODE_WIDTH, doc: 'Width of a node, in px.' },
      format: { kind: 'format', doc: 'How the total of a node is written after its name. Without it, only the name.' },
      linkOpacity: { kind: 'number', default: 0.35, doc: 'Opacity of the ribbons.' },
      nodeLabels: {
        kind: 'list',
        doc: 'What a tooltip calls what flows into and out of a node: ["In", "Out"] by default. Translate it on a page in another language.',
      },
      layout: {
        kind: 'list',
        doc: 'Names of the five columns transform.sankey writes, when its `as` renames them: [x0, x1, y0, y1, thickness].',
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
