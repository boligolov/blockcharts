(function () {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  /** How far from the line (px) the pointer may be and still pick it. */
  const REACH = 14;
  const LABEL_SIZE = 11;
  /** Least vertical distance between two end labels, px: closer ones are pushed apart. */
  const LABEL_GAP = LABEL_SIZE + 3;

  interface EndLabel {
    x: number;
    y: number;
    text: string;
    color: string;
    owner: number;
  }

  /** x of each row in px: on a band scale, the middle of its band (a category axis), so the line joins the categories in
   *  their domain order. */
  function xsOf(spec: BC.MarkSpec, ctx: BC.ChartCtx): ArrayLike<number> {
    const cx = ctx.channel(spec, 'x');
    if (!cx.half) return cx.mapped;
    // the same array for as long as the channel lasts (one redraw), so the series of the line are split only once
    let xs = centered.get(cx);
    if (!xs) centered.set(cx, (xs = Array.from(cx.mapped, (v: number) => v + cx.half)));
    return xs;
  }
  const centered = new WeakMap<BC.ChannelData, ArrayLike<number>>();
  /** The rows of a series that have a point, per series (kept while the series is): a pointer move asks every frame. */
  const drawable = new WeakMap<number[], number[]>();

  /** The end labels one line mark asks for: one per series, at its last point in view (inside the plot, when zoomed). */
  function endsOf(spec: BC.MarkSpec, ctx: BC.ChartCtx, index: number): EndLabel[] {
    const mode = spec.label === 'name' || spec.label === 'value' || spec.label === 'both' ? spec.label : 'none';
    if (mode === 'none') return [];
    const xs = xsOf(spec, ctx);
    const yc = ctx.channel(spec, 'y');
    const ys = yc.mapped;
    const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
    const grouped = typeof spec.group === 'string' || !!(colorCh && colorCh.field);
    const write =
      mode === 'value' || mode === 'both'
        ? spec.format !== undefined
          ? BC.formatter(spec.format as BC.FormatSpec | string)
          : (v: unknown) => (typeof v === 'number' ? String(+v.toPrecision(6)) : String(v))
        : null;
    const { x: left, y: top, w, h } = ctx.plot;
    // points left of a view are culled from the series, so past the right edge, above and below are what is out of it
    const seen = (i: number) => xs[i] <= left + w + 0.5 && ys[i] >= top - 0.5 && ys[i] <= top + h + 0.5;
    const out: EndLabel[] = [];
    ctx.series(spec, xs).forEach(({ key, rows }, n) => {
      const color = typeof spec.stroke === 'string' ? spec.stroke : colorCh ? colorCh.mapped[rows[0]] : ctx.color(index + n);
      if (!color) return;
      let last = -1;
      for (const i of rows) if (isFinite(xs[i]) && isFinite(ys[i]) && seen(i)) last = i;
      if (last < 0) return;
      const name = grouped ? String(key) : typeof spec.name === 'string' ? spec.name : yc.field || '';
      const value = write ? write(yc.raw[last]) : '';
      const text = mode === 'name' ? name : mode === 'value' ? value : name && value ? `${name}  ${value}` : name || value;
      if (text) out.push({ x: xs[last], y: ys[last], text, color, owner: index });
    });
    return out;
  }

  /** Moves labels apart vertically (keeping their order) so none overlaps the next, and keeps them inside [top, bottom]. */
  function spread(labels: EndLabel[], top: number, bottom: number): void {
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + LABEL_GAP);
    // pushed past the bottom: shift the whole stack up, then keep the top one in view
    const over = labels.length ? labels[labels.length - 1].y - bottom : 0;
    if (over > 0) for (const l of labels) l.y -= over;
    for (let k = 0; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, top + k * LABEL_GAP);
  }

  type Through = (px: number[], py: number[], curve: string, back: boolean) => string;
  /** The path through the points, from lib.curve (shared with mark.area); listed in `requires`, so it is on the page. */
  const through: Through = (px, py, curve, back) => ((BC.get('lib.curve') as BC.LibDef).exports.through as Through)(px, py, curve, back);

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'line',
    version: 19,
    requires: ['lib.curve'],
    series: true,
    enter: 'wipe',
    doc: 'A line per series: one path however many points. Rows are joined in x order (unsorted data is sorted); missing values break the line. `group` splits the rows into one line per distinct value; a `color` channel does the same and colors each line from its color scale. `curve: "smooth"` draws a smooth curve that still passes through every point and never overshoots between two of them; `curve: "step"` holds each value until the next point (a price, a tariff). x also takes a band scale: the points sit in the middle of their categories, joined in the order of the band scale domain — a slope chart (two categories, before and after) or a line over named periods.',
    params: {
      group: { kind: 'field', doc: 'Field whose distinct values become separate lines (long-format data).' },
      stroke: { kind: 'color', doc: 'Any CSS color. Default: theme color by line index.' },
      strokeWidth: { kind: 'number', default: 2 },
      dash: { kind: 'list', doc: 'Dash pattern, e.g. [4, 3].' },
      opacity: { kind: 'number', default: 1 },
      curve: {
        kind: 'enum',
        values: ['linear', 'smooth', 'step'],
        default: 'linear',
        doc: '"smooth": a monotone cubic curve through the points — no peaks or dips the data does not have. "linear": straight segments. "step": each value holds until the next point, then the line jumps: prices, tariffs, stock levels, anything that changes at moments and stays.',
      },
      label: {
        kind: 'enum',
        values: ['none', 'name', 'value', 'both'],
        default: 'none',
        doc: 'A label at the end of each line, in its color: the series name, its last value, or both — so a legend is rarely needed. Labels that would overlap are moved apart. Leave room on the right (padding.right, about 70–110 px).',
      },
      format: { kind: 'format', doc: 'How the end label writes the last value (a preset or Intl options, as guide.axis `format`).' },
      name: { kind: 'string', doc: 'The end label of a line that is not split into series (default: the y field).' },
    },
    channels: {
      x: { required: true, accepts: { output: 'position' } },
      y: { required: true, accepts: { output: 'position', input: ['number', 'date'] } },
      color: {
        accepts: { output: 'color', input: ['category'] },
        doc: 'One line per distinct value of the field, colored by a color scale.',
      },
    },
    render(spec, ctx, index) {
      const xs = xsOf(spec, ctx);
      const ys = ctx.channel(spec, 'y').mapped;
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      const grouped = typeof spec.group === 'string' || !!(colorCh && colorCh.field);
      const width = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 2;
      const dash = Array.isArray(spec.dash) ? (spec.dash as number[]) : undefined;
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const curve = spec.curve === 'smooth' || spec.curve === 'step' ? spec.curve : 'linear';
      const out: BC.Prim[] = [];
      ctx.series(spec, xs).forEach(({ key, rows }, n) => {
        let d = '';
        let px: number[] = [];
        let py: number[] = [];
        // a run is a stretch of points without a gap; each is drawn on its own
        const flush = () => {
          if (px.length) d += 'M' + r2(px[0]) + ' ' + r2(py[0]) + through(px, py, curve, false);
          px = [];
          py = [];
        };
        for (const i of rows) {
          const x = xs[i];
          const y = ys[i];
          if (!isFinite(x) || !isFinite(y)) {
            flush();
            continue;
          }
          px.push(x);
          py.push(y);
        }
        flush();
        if (!d) return;
        const stroke = typeof spec.stroke === 'string' ? spec.stroke : colorCh ? colorCh.mapped[rows[0]] : ctx.color(index + n);
        if (!stroke) return; // a series whose color the scale hides is not drawn
        out.push({
          type: 'path',
          d,
          title: grouped ? String(key) : undefined,
          style: { fill: 'none', stroke, strokeWidth: width, strokeDash: dash, opacity, strokeLinejoin: 'round', strokeLinecap: 'round' },
        });
      });
      return out;
    },
    // past the plot's right edge, where the padding is: drawn outside the clip a zoom puts on the marks
    labels(spec, ctx, index) {
      if (!endsOf(spec, ctx, index).length) return [];
      // the labels of every labelled line of the chart are spread together, so two line marks (revenue and plan)
      // do not write over each other; each mark then draws only its own
      const all: EndLabel[] = [];
      ctx.spec.marks.forEach((m, k) => {
        if (m.type === 'line') all.push(...endsOf(m, ctx, k));
      });
      spread(all, ctx.plot.y, ctx.plot.y + ctx.plot.h);
      return all
        .filter((l) => l.owner === index)
        .map((l): BC.Prim => ({
          type: 'text',
          x: l.x + 8,
          y: l.y,
          text: l.text,
          size: LABEL_SIZE,
          weight: 600,
          anchor: 'start',
          baseline: 'middle',
          style: { fill: l.color },
          cls: 'bc-line-label',
        }));
    },
    pick(spec, ctx, _index, px, py) {
      const xs = xsOf(spec, ctx);
      const ys = ctx.channel(spec, 'y').mapped;
      const colorCh = spec.color !== undefined ? ctx.channel(spec, 'color') : null;
      // a crosshair follows the pointer at any height, so the value it points at has to as well
      const reach = ctx.alongX ? Infinity : REACH;
      let best: BC.Pick | null = null;
      for (const { rows } of ctx.series(spec, xs)) {
        if (colorCh && !colorCh.mapped[rows[0]]) continue;
        let pts = drawable.get(rows);
        if (!pts) drawable.set(rows, (pts = rows.filter((i) => isFinite(xs[i]) && isFinite(ys[i]))));
        if (!pts.length || px < xs[pts[0]] - REACH || px > xs[pts[pts.length - 1]] + REACH) continue;
        // last vertex at or left of the pointer (binary search: pts are in x order)
        let lo = 0;
        let hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (xs[pts[mid]] <= px) lo = mid;
          else hi = mid - 1;
        }
        const a = pts[lo];
        const b = pts[Math.min(lo + 1, pts.length - 1)];
        // height of the line under the pointer: interpolated between the two vertices around it
        const span = xs[b] - xs[a];
        const t = span > 0 ? Math.min(1, Math.max(0, (px - xs[a]) / span)) : 0;
        const lineY = ys[a] + (ys[b] - ys[a]) * t;
        const dist = Math.abs(py - lineY);
        if (dist > reach || (best && dist >= best.dist)) continue;
        const near = Math.abs(px - xs[a]) <= Math.abs(px - xs[b]);
        const row = near ? a : b;
        best = { row, x: xs[row], y: ys[row], dist };
        // a vertex that several rows put on one spot (a total repeated on each row of its quarter) stands for all of them
        let k0 = near ? lo : Math.min(lo + 1, pts.length - 1);
        let k1 = k0;
        const at = (k: number) => xs[pts[k]] === xs[row] && ys[pts[k]] === ys[row];
        while (k0 > 0 && at(k0 - 1)) k0--;
        while (k1 < pts.length - 1 && at(k1 + 1)) k1++;
        if (k1 > k0) best.rows = pts.slice(k0, k1 + 1);
      }
      return best;
    },
  };

  BC.define(def);
})();
