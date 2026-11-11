(function () {
  const TEXT = 'var(--bc-text, #444)';
  const NODE_WIDTH = 12;
  const LABEL_GAP = 6;
  const LABEL_SIZE = 12;
  const LINE = 15;
  const LAYOUT = ['x0', 'x1', 'y0', 'y1', 'thickness', 'waypoints'];
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
    /** Where it passes the columns between its ends: the left edge of the column and the center of the ribbon there. */
    via: { x: number; y: number }[];
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
    if (
      given !== undefined &&
      !(Array.isArray(given) && (given.length === 5 || given.length === 6) && given.every((n) => typeof n === 'string' && n))
    )
      throw new Error('mark.sankey: "layout" must be six column names: [x0, x1, y0, y1, thickness, waypoints] (five keep "waypoints")');
    const names = given === undefined ? LAYOUT : (given as string[]).concat(given.length === 5 ? [LAYOUT[5]] : []);
    const layout = names.map((n) => ctx.table.columns[n]);
    // the places a flow passes are new: a table laid out without them draws its long flows straight
    const missing = names.slice(0, 5).find((_, k) => !layout[k]);
    if (missing !== undefined)
      throw new Error(`mark.sankey: there is no column "${missing}" with the layout of the flows: put a sankey transform before it`);
    const [lx0, lx1, ly0, ly1, lth, lvia] = layout;
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
      const through = lvia ? lvia[row] : null;
      const via: { x: number; y: number }[] = [];
      if (Array.isArray(through) && through.length % 2 === 0 && through.every((t) => typeof t === 'number' && isFinite(t)))
        for (let k = 0; k < through.length; k += 2) via.push({ x: x + through[k] * (w - width), y: y + (through[k + 1] + th / 2) * h });
      const link: Link = { row, from: a, to: b, value: v, thick: th * h, y0: y + (t0 + th / 2) * h, y1: y + (t1 + th / 2) * h, via };
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

  /** The curves of a ribbon, by its center: from the right edge of a node to the left edge of the next column; through
   *  a column it passes, it runs straight across, as wide as a node, from the end of one curve to the start of the next. */
  function legs(l: Link, width: number): { xa: number; ya: number; xb: number; yb: number }[] {
    const out: { xa: number; ya: number; xb: number; yb: number }[] = [];
    let xa = l.from.x + width;
    let ya = l.y0;
    for (const v of l.via) {
      out.push({ xa, ya, xb: v.x, yb: v.y });
      xa = v.x + width;
      ya = v.y;
    }
    out.push({ xa, ya, xb: l.to.x, yb: l.y1 });
    return out;
  }

  /** A ribbon of even vertical thickness: curves along the top, and back along the bottom. */
  function ribbon(l: Link, width: number): string {
    const half = l.thick / 2;
    const parts = legs(l, width);
    const curve = (xa: number, ya: number, xb: number, yb: number) => {
      const mid = r2((xa + xb) / 2);
      return `C${mid} ${r2(ya)} ${mid} ${r2(yb)} ${r2(xb)} ${r2(yb)}`;
    };
    let d = `M${r2(parts[0].xa)} ${r2(parts[0].ya - half)}`;
    parts.forEach((p, k) => {
      if (k) d += `L${r2(p.xa)} ${r2(p.ya - half)}`;
      d += curve(p.xa, p.ya - half, p.xb, p.yb - half);
    });
    const end = parts[parts.length - 1];
    d += `L${r2(end.xb)} ${r2(end.yb + half)}`;
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      if (k < parts.length - 1) d += `L${r2(p.xb)} ${r2(p.yb + half)}`;
      d += curve(p.xb, p.yb + half, p.xa, p.ya + half);
    }
    return d + 'Z';
  }

  /** The height of a ribbon's center at x, or NaN past its ends: on a curve its x runs one way, so halving finds it. */
  function centerAt(l: Link, width: number, px: number): number {
    const parts = legs(l, width);
    for (let k = 0; k < parts.length; k++) {
      const { xa, ya, xb, yb } = parts[k];
      if (k && px < xa) return ya; // straight across a column it passes
      if (px < xa || px > xb) continue;
      const mid = (xa + xb) / 2;
      const xAt = (t: number) => {
        const u = 1 - t;
        return u * u * u * xa + 3 * u * t * (u + t) * mid + t * t * t * xb;
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
      return (u * u * u + 3 * u * u * t) * ya + (3 * u * t * t + t * t * t) * yb;
    }
    return NaN;
  }

  /** The lines of a node's label in `room` px and at most `most` lines, or null when they do not fit: the name and its
   *  total on one line; else the total under the name; the name broken at the space that makes its two lines most even
   *  when it is too long for one. */
  function lay(ctx: BC.ChartCtx, name: string, total: string | null, room: number, most: number): string[] | null {
    const wide = (t: string) => ctx.measure(t, LABEL_SIZE).w;
    const names: string[][] = [[name]];
    const words = name.split(/\s+/).filter(Boolean);
    let even: string[] | null = null;
    for (let k = 1; k < words.length; k++) {
      const two = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      if (!even || Math.max(...two.map(wide)) < Math.max(...even.map(wide))) even = two;
    }
    if (even) names.push(even);
    for (const lines of names) {
      const end = lines[lines.length - 1];
      const tries = total === null ? [lines] : [lines.slice(0, -1).concat(`${end} ${total}`), lines.concat(total)];
      for (const t of tries) if (t.length <= most && t.every((line) => wide(line) <= room)) return t;
    }
    return null;
  }

  /** As much of a name as fits on one line, cut with an ellipsis; empty when not even a letter does. */
  function cut(ctx: BC.ChartCtx, name: string, room: number): string {
    const fits = (t: string) => ctx.measure(t, LABEL_SIZE).w <= room;
    if (fits(name)) return name;
    const chars = Array.from(name);
    for (let n = chars.length - 1; n > 0; n--) {
      const short = chars.slice(0, n).join('').trimEnd() + '…';
      if (fits(short)) return short;
    }
    return '';
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'sankey',
    version: 6,
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
        doc: 'Names of the columns transform.sankey writes, when its `as` renames them: [x0, x1, y0, y1, thickness, waypoints]; five names keep "waypoints".',
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
      const write = spec.format !== undefined ? ctx.format(spec.format as BC.FormatSpec | string) : null;
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
      // a label has as many lines as its node is tall
      const most = (n: Node) => Math.max(1, Math.floor(n.h / LINE));
      const labelled = g.nodes.filter((n) => n.h >= labelMin);
      const rooms = new Map<Node, number>(labelled.map((n) => [n, room]));
      const lines = new Map<Node, string[]>();
      const layOut = () => {
        // totals are written on every node or on none: a total on some only reads as if the others had none
        const totals = labelled.every((n) => lay(ctx, n.name, total(n), rooms.get(n) as number, most(n)) !== null);
        for (const n of labelled) {
          const r = rooms.get(n) as number;
          lines.set(n, lay(ctx, n.name, totals ? total(n) : null, r, most(n)) || [cut(ctx, n.name, r)].filter(Boolean));
        }
      };
      layOut();
      // the last gap is written into from both sides. Two labels there that meet move apart, up and down, as far as their
      // nodes reach (a label stays beside its node); when that is not enough, each takes half of the gap
      const beforeLast = columns[columns.length - 2];
      const shift = new Map<Node, number>();
      const height = (n: Node) => (lines.get(n) as string[]).length * LINE;
      const middle = (n: Node) => n.y + n.h / 2 + (shift.get(n) || 0);
      // how far the middle of a label may move up (-) or down (+) and keep the label beside its node
      const reach = (n: Node, dir: number) => Math.max(0, (n.h - height(n)) / 2) * dir - (shift.get(n) || 0);
      const extent = (n: Node) => ({
        w: (lines.get(n) as string[]).reduce((m, line) => Math.max(m, ctx.measure(line, LABEL_SIZE).w), 0),
        top: middle(n) - height(n) / 2,
        bottom: middle(n) + height(n) / 2,
      });
      const facing = (pass: (a: Node, b: Node, overlap: number) => void) => {
        for (const a of labelled.filter((n) => n.x === beforeLast && !leftward(n)))
          for (const b of labelled.filter(leftward)) {
            const ea = extent(a);
            const eb = extent(b);
            const overlap = Math.min(ea.bottom, eb.bottom) - Math.max(ea.top, eb.top);
            if (overlap > 0 && ea.w + eb.w + LABEL_GAP > room) pass(a, b, overlap);
          }
      };
      facing((a, b, overlap) => {
        const [up, down] = middle(a) <= middle(b) ? [a, b] : [b, a];
        const need = overlap + 2;
        const canUp = -reach(up, -1);
        const canDown = reach(down, 1);
        if (canUp + canDown < need) return;
        const moveUp = Math.min(canUp, Math.max(need / 2, need - canDown));
        shift.set(up, (shift.get(up) || 0) - moveUp);
        shift.set(down, (shift.get(down) || 0) + (need - moveUp));
      });
      let shared = false;
      facing((a, b) => {
        rooms.set(a, (room - LABEL_GAP) / 2);
        rooms.set(b, (room - LABEL_GAP) / 2);
        shift.delete(a);
        shift.delete(b);
        shared = true;
      });
      if (shared) layOut();
      for (const n of g.nodes) {
        out.push({ type: 'rect', x: r2(n.x), y: r2(n.y), w: width, h: r2(Math.max(1, n.h)), style: { fill: n.color } });
        const ls = lines.get(n);
        if (!ls) continue;
        const toLeft = leftward(n);
        ls.forEach((text, k) =>
          out.push({
            type: 'text',
            x: r2(toLeft ? n.x - LABEL_GAP : n.x + width + LABEL_GAP),
            y: r2(middle(n) + (k - (ls.length - 1) / 2) * LINE),
            text,
            size: LABEL_SIZE,
            anchor: toLeft ? 'end' : 'start',
            baseline: 'middle',
            style: { fill: TEXT },
          }),
        );
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
            ? ctx.format(spec.format as BC.FormatSpec | string)
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
        const c = centerAt(l, width, px);
        if (isNaN(c)) continue;
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
