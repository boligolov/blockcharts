(function () {
  const SWATCH = 10;
  const GAP = 6;
  const PAD = 8;
  const ROW = 16;
  const FONT = 11;
  const TEXT = 'var(--bc-text, #444)';
  const BAR = 12; // thickness of a color bar
  const STEPS = 48; // slices a color bar is drawn from (no gradient primitive: any renderer can draw rects)
  const HIDDEN_OPACITY = 0.4;

  type Side = 'top' | 'right' | 'bottom' | 'left';
  interface Item { label: string; color: string; w: number; hidden: boolean; index: number }

  function scaleOf(spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Scale {
    const scale = spec.scale ? ctx.scales[spec.scale] : undefined;
    if (!scale || (scale.kind !== 'color' && scale.kind !== 'sequential' && scale.kind !== 'size')) throw new Error('guide.legend needs a color, sequential or size scale');
    return scale;
  }

  /** A size legend: a few round values as circles of their size, each with its label (pos = the radius). */
  interface Sized { label: string; r: number; w: number }
  function sizesOf(scale: BC.Scale, spec: BC.GuideSpec, ctx: BC.ChartCtx): Sized[] {
    const ticks = barTicks(scale, spec, 3).filter((t) => isFinite(t.pos) && t.pos > 0);
    return ticks.map((t) => ({ label: t.label, r: t.pos, w: ctx.measure(t.label, FONT).w }));
  }
  const SIZE_STROKE = 'var(--bc-label, var(--bc-text, #888))';
  const sizeWidth = (s: Sized) => 2 * s.r + GAP + s.w;
  /** The width a row key is packed into. Not the plot's: measure sees the plot before the axes take their room and render
   *  after, so the two would wrap differently and the last line would fall outside the room measured. The chart's width
   *  is the same for both. */
  const rowRoom = (ctx: BC.ChartCtx) => Math.max(1, ctx.size.w - 2 * PAD);
  /** A row key packed into lines no wider than the plot (a phone), each as tall as its biggest circle. */
  function sizeLines(sizes: Sized[], width: number): { items: Sized[]; h: number }[] {
    const lines: { items: Sized[]; h: number }[] = [];
    let used = 0;
    for (const s of sizes) {
      const last = lines[lines.length - 1];
      if (!last || (last.items.length && used + ITEM_GAP + sizeWidth(s) > width)) {
        lines.push({ items: [s], h: Math.max(2 * s.r, ROW) + 4 });
        used = sizeWidth(s);
      } else {
        last.items.push(s);
        last.h = Math.max(last.h, Math.max(2 * s.r, ROW) + 4);
        used += ITEM_GAP + sizeWidth(s);
      }
    }
    return lines;
  }

  /** Every category of the scale, also the ones a filter has hidden, so they can be switched back on. */
  function itemsOf(scale: BC.Scale, ctx: BC.ChartCtx): Item[] {
    const visible = new Set(scale.domain());
    const colors = scale.range();
    return scale.baseDomain().map((v, index) => {
      const label = String(v);
      return { label, color: colors[index], w: ctx.measure(label, FONT).w, hidden: !visible.has(v), index };
    });
  }

  /** Labels of a color bar, written the way `format` says. */
  function barTicks(scale: BC.Scale, spec: BC.GuideSpec, count = 4): BC.Tick[] {
    const ticks = scale.ticks ? scale.ticks(count) : [];
    if (spec.format === undefined) return ticks;
    const write = BC.formatter(spec.format as BC.FormatSpec | string, 'number');
    return ticks.map((t) => ({ value: t.value, pos: t.pos, label: write(t.value) }));
  }

  const sideOf = (spec: BC.GuideSpec): Side => spec.position || 'right';
  const isColumn = (side: Side) => side === 'left' || side === 'right';
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const ITEM_GAP = 14; // between two items of a row
  const itemWidth = (it: Item) => SWATCH + GAP + it.w;

  /** Items of a row legend packed into lines no wider than the plot: a long legend wraps instead of running off. */
  function linesOf(items: Item[], width: number): Item[][] {
    const lines: Item[][] = [];
    let line: Item[] = [];
    let used = 0;
    for (const it of items) {
      const w = itemWidth(it);
      if (line.length && used + ITEM_GAP + w > width) {
        lines.push(line);
        line = [];
        used = 0;
      }
      used += (line.length ? ITEM_GAP : 0) + w;
      line.push(it);
    }
    if (line.length) lines.push(line);
    return lines;
  }

  function barLength(column: boolean, ctx: BC.ChartCtx): number {
    return column ? clamp(ctx.plot.h * 0.6, 80, 200) : clamp(ctx.plot.w * 0.4, 100, 240);
  }

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'legend',
    version: 6,
    doc: 'Legend of a color scale. A categorical scale (`color`) lists every value with a swatch, and values a filter hides stay listed, dimmed. A continuous scale (`sequential`) draws a color bar with a few labels; a `size` scale draws a few round values as circles of their size (the key of a bubble chart). On the right or left it is a column, on top or bottom a row that wraps onto more lines when it is wider than the plot. Takes space on its side like an axis, so list it after an axis on the same side to sit outside it.',
    params: {
      scale: { kind: 'scale', required: true, doc: 'A color, sequential or size scale.' },
      position: { kind: 'enum', values: ['top', 'right', 'bottom', 'left'], default: 'right' },
      format: { kind: 'any', doc: 'How to write the labels of a color bar or a size key (a `sequential` or `size` scale): a preset ("percent", "compact", ...) or an object of Intl options; see guide.axis `format`.' },
    },
    measure(spec, ctx) {
      const side = sideOf(spec);
      const scale = scaleOf(spec, ctx);
      const column = isColumn(side);
      const out: Partial<BC.Insets> = {};
      if (scale.kind === 'size') {
        const sizes = sizesOf(scale, spec, ctx);
        const rMax = sizes.reduce((m, s) => Math.max(m, s.r), 0);
        out[side] = !sizes.length ? 0 : column
          ? 2 * rMax + GAP + sizes.reduce((m, s) => Math.max(m, s.w), 0) + 2 * PAD
          : sizeLines(sizes, rowRoom(ctx)).reduce((sum, l) => sum + l.h, 0) + PAD;
        return out;
      }
      if (scale.kind === 'sequential') {
        const labels = barTicks(scale, spec);
        const widest = labels.reduce((m, t) => Math.max(m, ctx.measure(t.label, FONT).w), 0);
        out[side] = column ? BAR + GAP + widest + 2 * PAD : BAR + ctx.measure('0', FONT).h + 2 * PAD;
        return out;
      }
      const items = itemsOf(scale, ctx);
      out[side] = !items.length ? 0 : column ? SWATCH + GAP + items.reduce((m, it) => Math.max(m, it.w), 0) + 2 * PAD : linesOf(items, ctx.plot.w).length * ROW + PAD;
      return out;
    },
    render(spec, ctx, offset) {
      const side = sideOf(spec);
      const scale = scaleOf(spec, ctx);
      const column = isColumn(side);
      const { x, y, w, h } = ctx.plot;
      const prims: BC.Prim[] = [];

      if (scale.kind === 'size') {
        const sizes = sizesOf(scale, spec, ctx);
        const rMax = sizes.reduce((m, s) => Math.max(m, s.r), 0);
        const circle = (cx: number, cy: number, s: Sized, labelX: number) => {
          prims.push({ type: 'circle', cx, cy, r: s.r, style: { fill: 'none', stroke: SIZE_STROKE, strokeWidth: 1 }, cls: 'bc-legend-size' });
          prims.push({ type: 'text', x: labelX, y: cy, text: s.label, size: FONT, baseline: 'middle', style: { fill: TEXT } });
        };
        if (column) {
          const width = 2 * rMax + GAP + sizes.reduce((m, s) => Math.max(m, s.w), 0) + 2 * PAD;
          const left = (side === 'right' ? x + w + offset.right : x - offset.left - width) + PAD;
          // stacked downwards on one center line, each in a slot as tall as the circle (never shorter than a line of
          // text); the labels line up past the biggest circle
          let top = y + 4;
          for (const s of sizes) {
            const slot = Math.max(2 * s.r, ROW) + 4;
            circle(left + rMax, top + slot / 2, s, left + 2 * rMax + GAP);
            top += slot;
          }
        } else {
          // left to right, each label right after its own circle; lines wrap on a narrow plot
          const lines = sizeLines(sizes, rowRoom(ctx));
          let top = side === 'top' ? y - offset.top - (lines.reduce((sum, l) => sum + l.h, 0) + PAD) : y + h + offset.bottom + PAD / 2;
          for (const line of lines) {
            let cx = Math.max(PAD, Math.min(x, ctx.size.w - PAD - line.items.reduce((sum, s, k) => sum + (k ? ITEM_GAP : 0) + sizeWidth(s), 0)));
            for (const s of line.items) {
              circle(cx + s.r, top + line.h / 2, s, cx + 2 * s.r + GAP);
              cx += sizeWidth(s) + ITEM_GAP;
            }
            top += line.h;
          }
        }
        return { axes: prims };
      }

      if (scale.kind === 'sequential') {
        const [d0, d1] = scale.domain() as number[];
        const length = barLength(column, ctx);
        const ticks = barTicks(scale, spec);
        const widest = ticks.reduce((m, t) => Math.max(m, ctx.measure(t.label, FONT).w), 0);
        const boxW = BAR + GAP + widest + 2 * PAD;
        const left = side === 'right' ? x + w + offset.right + PAD : x - offset.left - boxW + PAD;
        const top = side === 'top' ? y - offset.top - (BAR + ctx.measure('0', FONT).h + 2 * PAD) + PAD : y + h + offset.bottom + PAD;
        const slice = (length / STEPS) * 1.05; // a hair of overlap hides seams between slices
        for (let k = 0; k < STEPS; k++) {
          const value = column ? d1 - ((k + 0.5) / STEPS) * (d1 - d0) : d0 + ((k + 0.5) / STEPS) * (d1 - d0);
          const color = scale(value);
          prims.push(column
            ? { type: 'rect', x: left, y: y + 4 + (k * length) / STEPS, w: BAR, h: slice, style: { fill: color }, cls: 'bc-legend-bar' }
            : { type: 'rect', x: x + (k * length) / STEPS, y: top, w: slice, h: BAR, style: { fill: color }, cls: 'bc-legend-bar' });
        }
        for (const t of ticks) {
          prims.push(column
            ? { type: 'text', x: left + BAR + GAP, y: y + 4 + (1 - t.pos) * length, text: t.label, size: FONT, baseline: 'middle', style: { fill: TEXT } }
            : { type: 'text', x: x + t.pos * length, y: top + BAR + 3, text: t.label, size: FONT, anchor: 'middle', baseline: 'hanging', style: { fill: TEXT } });
        }
        return { axes: prims };
      }

      const items = itemsOf(scale, ctx);
      const put = (px: number, py: number, it: Item) => {
        prims.push({
          type: 'g',
          cls: 'bc-legend-item',
          data: { 'bc-legend-scale': String(spec.scale), 'bc-legend-index': String(it.index) },
          style: it.hidden ? { opacity: HIDDEN_OPACITY } : undefined,
          children: [
            { type: 'rect', x: px, y: py + (ROW - SWATCH) / 2, w: SWATCH, h: SWATCH, r: SWATCH / 2, style: { fill: it.color }, cls: 'bc-legend-swatch' },
            { type: 'text', x: px + SWATCH + GAP, y: py + ROW / 2, text: it.label, size: FONT, baseline: 'middle', style: { fill: TEXT } },
          ],
        });
      };

      if (column) {
        const width = SWATCH + GAP + items.reduce((m, it) => Math.max(m, it.w), 0) + 2 * PAD;
        const left = side === 'right' ? x + w + offset.right : x - offset.left - width;
        items.forEach((it, i) => put(left + PAD, y + 4 + i * ROW, it));
      } else {
        const lines = linesOf(items, w);
        const top = side === 'top' ? y - offset.top - (lines.length * ROW + PAD) : y + h + offset.bottom + PAD / 2;
        lines.forEach((line, k) => {
          let cx = x;
          for (const it of line) {
            put(cx, top + k * ROW, it);
            cx += itemWidth(it) + ITEM_GAP;
          }
        });
      }
      return { axes: prims };
    },
  };

  BC.define(def);
})();
