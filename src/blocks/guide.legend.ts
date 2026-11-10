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
  interface Item {
    label: string;
    full: string;
    color: string;
    w: number;
    hidden: boolean;
    index: number;
  }

  /** A swatch per category for a scale that colors categories; a color bar for one that colors numbers or dates. */
  const swatches = (scale: BC.Scale) => scale.output === 'color' && scale.input === 'category';

  function scaleOf(spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Scale {
    const scale = spec.scale ? ctx.scales[spec.scale] : undefined;
    if (!scale || !(scale.output === 'color' || (scale.output === 'size' && scale.input === 'number')))
      throw new Error('guide.legend needs a scale of colors, or of sizes for numbers');
    return scale;
  }

  /** A size legend: a few round values as circles of their size, each with its label (pos = the radius). */
  interface Sized {
    label: string;
    r: number;
    w: number;
  }
  function sizesOf(scale: BC.Scale, spec: BC.GuideSpec, ctx: BC.ChartCtx): Sized[] {
    const ticks = barTicks(scale, spec, 3).filter((t) => isFinite(t.pos) && t.pos > 0);
    return ticks.map((t) => ({ label: t.label, r: t.pos, w: ctx.measure(t.label, FONT).w }));
  }
  const SIZE_STROKE = 'var(--bc-label, var(--bc-text, #888))';
  const sizeWidth = (s: Sized) => 2 * s.r + GAP + s.w;
  /** The width a row legend (categories or a size key) is packed into. Not the plot's: measure sees the plot before the axes take their room and render
   *  after, so the two would wrap differently and the last line would fall outside the room measured. The chart's width
   *  is the same for both. */
  const rowRoom = (ctx: BC.ChartCtx, side: Side) => {
    const t = taken(ctx, side);
    return Math.max(1, ctx.size.w - Math.max(PAD, t.left) - Math.max(PAD, t.right));
  };
  /** What an overlay in a corner (the zoom buttons) keeps of the edge this row sits on. */
  const taken = (ctx: BC.ChartCtx, side: Side) => (side === 'top' || side === 'bottom' ? ctx.edgeTaken(side) : { left: 0, right: 0 });
  /** Where a row of this width starts: under the plot's left edge, unless that runs it into something. */
  const rowStart = (ctx: BC.ChartCtx, side: Side, x: number, width: number) => {
    const t = taken(ctx, side);
    return Math.max(Math.max(PAD, t.left), Math.min(x, ctx.size.w - Math.max(PAD, t.right) - width));
  };
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

  /** Every category of the scale, also the ones a filter has hidden, so they can be switched back on. A label wider than
   *  `room` (a row on a phone) is cut short with an ellipsis; `full` keeps it for the item's title. */
  function itemsOf(scale: BC.Scale, ctx: BC.ChartCtx, room = Infinity): Item[] {
    const visible = new Set(scale.domain());
    const colors = scale.range();
    return scale.baseDomain().map((v, index) => {
      const full = String(v);
      const label = fit(full, room - SWATCH - GAP, ctx);
      return { label, full, color: colors[index], w: ctx.measure(label, FONT).w, hidden: !visible.has(v), index };
    });
  }

  /** The text cut to at most `room` wide, ending in an ellipsis when it had to be cut; whole characters only. */
  function fit(text: string, room: number, ctx: BC.ChartCtx): string {
    if (!(room < Infinity) || ctx.measure(text, FONT).w <= room) return text;
    const chars = Array.from(text);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measure(chars.slice(0, mid).join('') + '…', FONT).w <= room) lo = mid;
      else hi = mid - 1;
    }
    return chars.slice(0, lo).join('').trimEnd() + '…';
  }

  /** Labels of a color bar, written the way `format` says. */
  function barTicks(scale: BC.Scale, spec: BC.GuideSpec, count = 4): BC.Tick[] {
    const ticks = scale.ticks ? scale.ticks(count) : [];
    if (spec.format === undefined) return ticks;
    const write = BC.formatter(spec.format as BC.FormatSpec | string, 'number');
    return ticks.map((t) => ({ value: t.value, pos: t.pos, label: write(t.value) }));
  }

  const titleOf = (spec: BC.GuideSpec) => (typeof spec.title === 'string' && spec.title ? spec.title : '');
  /** Height of the title's line, when there is one. */
  const headOf = (spec: BC.GuideSpec) => (titleOf(spec) ? ROW : 0);
  /** A column has to be as wide as its title. */
  const titleWidth = (spec: BC.GuideSpec, ctx: BC.ChartCtx) => (titleOf(spec) ? ctx.measure(titleOf(spec), FONT).w : 0);
  /** The most of the chart's width a column may take: past a fifth it squeezes the plot (a phone, long labels). */
  const COLUMN_SHARE = 0.2;
  /** `auto`: a row on top while it takes one or two lines, else a column on the right. */
  function autoSide(scale: BC.Scale, ctx: BC.ChartCtx): Side {
    if (!swatches(scale)) return 'right';
    const room = rowRoom(ctx, 'top');
    return linesOf(itemsOf(scale, ctx, room), room).length <= 2 ? 'top' : 'right';
  }
  /** Width and height of the legend as a column. */
  function columnBox(spec: BC.GuideSpec, scale: BC.Scale, ctx: BC.ChartCtx): { w: number; h: number } {
    const title = titleWidth(spec, ctx);
    const head = headOf(spec);
    if (scale.output === 'size') {
      const sizes = sizesOf(scale, spec, ctx);
      const rMax = sizes.reduce((m, s) => Math.max(m, s.r), 0);
      return {
        w: Math.max(2 * rMax + GAP + sizes.reduce((m, s) => Math.max(m, s.w), 0), title) + 2 * PAD,
        h: 4 + head + sizes.reduce((sum, s) => sum + Math.max(2 * s.r, ROW) + 4, 0),
      };
    }
    if (!swatches(scale)) {
      // the bar is as long as the plot lets it be, so only its width counts
      const widest = barTicks(scale, spec).reduce((m, t) => Math.max(m, ctx.measure(t.label, FONT).w), 0);
      return { w: Math.max(BAR + GAP + widest, title) + 2 * PAD, h: 0 };
    }
    const items = itemsOf(scale, ctx);
    return {
      w: Math.max(SWATCH + GAP + items.reduce((m, it) => Math.max(m, it.w), 0), title) + 2 * PAD,
      h: 4 + head + items.length * ROW + 4,
    };
  }
  /** Where the legend goes. A column wider than a fifth of the chart, or taller than the chart, is a row on top instead: it
   *  would leave the plot a sliver on a phone, or run past the bottom with many categories. */
  function sideOf(spec: BC.GuideSpec, scale: BC.Scale, ctx: BC.ChartCtx): Side {
    const asked: Side = (spec.position as string) === 'auto' ? autoSide(scale, ctx) : spec.position || 'right';
    if (!isColumn(asked)) return asked;
    const box = columnBox(spec, scale, ctx);
    return box.w <= ctx.size.w * COLUMN_SHARE && box.h <= ctx.size.h ? asked : 'top';
  }
  const isColumn = (side: Side) => side === 'left' || side === 'right';
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const ITEM_GAP = 14; // between two items of a row
  const itemWidth = (it: Item) => SWATCH + GAP + it.w;

  /** Items of a row legend packed into lines no wider than `width` (see rowRoom): a long legend wraps instead of running off. */
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
    version: 13,
    shownOnce: true,
    doc: 'Legend of a color scale. A categorical scale (`color`) lists every value with a swatch, and values a filter hides stay listed, dimmed. A continuous scale (`sequential`) draws a color bar with a few labels; a `size` scale draws a few round values as circles of their size (the key of a bubble chart). On the right or left it is a column, on top or bottom a row that wraps onto more lines when it is wider than the plot. A column that would take more than a fifth of the width of the chart (a phone, long labels) or more than its height (many categories) is drawn as a row on top instead; a label too long for a row is cut with an ellipsis and shown whole on hover. Takes space on its side like an axis, so list it after an axis on the same side to sit outside it.',
    params: {
      scale: { kind: 'scale', required: true, doc: 'A color, sequential or size scale.' },
      position: {
        kind: 'enum',
        values: ['top', 'right', 'bottom', 'left', 'auto'],
        default: 'right',
        doc: '"auto" is a row on top while the items fit on two lines, and a column on the right when long labels would need more; it is decided again when the chart changes width.',
      },
      title: { kind: 'string', doc: 'What the legend shows, on a line above it: "Region", "Revenue, $M".' },
      format: {
        kind: 'format',
        doc: 'How to write the labels of a color bar or a size key (a `sequential` or `size` scale): a preset ("percent", "compact", ...) or an object of Intl options; see guide.axis `format`.',
      },
    },
    measure(spec, ctx) {
      const scale = scaleOf(spec, ctx);
      const side = sideOf(spec, scale, ctx);
      const column = isColumn(side);
      const head = headOf(spec);
      const out: Partial<BC.Insets> = {};
      if (scale.output === 'size') {
        const sizes = sizesOf(scale, spec, ctx);
        out[side] = !sizes.length
          ? 0
          : column
            ? columnBox(spec, scale, ctx).w
            : sizeLines(sizes, rowRoom(ctx, side)).reduce((sum, l) => sum + l.h, 0) + PAD + head;
        return out;
      }
      if (!swatches(scale)) {
        out[side] = column ? columnBox(spec, scale, ctx).w : BAR + ctx.measure('0', FONT).h + 2 * PAD + head;
        return out;
      }
      const room = rowRoom(ctx, side);
      const items = itemsOf(scale, ctx, column ? Infinity : room);
      out[side] = !items.length ? 0 : column ? columnBox(spec, scale, ctx).w : linesOf(items, room).length * ROW + PAD + head;
      return out;
    },
    render(spec, ctx, offset) {
      const scale = scaleOf(spec, ctx);
      const side = sideOf(spec, scale, ctx);
      const column = isColumn(side);
      const { x, y, w, h } = ctx.plot;
      const prims: BC.Prim[] = [];
      const head = headOf(spec);
      // on a row the title is cut to the row, as the labels are
      const titleText = column ? titleOf(spec) : fit(titleOf(spec), rowRoom(ctx, side), ctx);
      const title = titleText ? ctx.measure(titleText, FONT).w : 0;
      const writeTitle = (px: number, py: number) => {
        if (head)
          prims.push({
            type: 'text',
            x: px,
            y: py + ROW / 2,
            text: titleText,
            size: FONT,
            weight: 600,
            baseline: 'middle',
            style: { fill: TEXT },
            cls: 'bc-legend-title',
          });
      };

      if (scale.output === 'size') {
        const sizes = sizesOf(scale, spec, ctx);
        const rMax = sizes.reduce((m, s) => Math.max(m, s.r), 0);
        const circle = (cx: number, cy: number, s: Sized, labelX: number) => {
          prims.push({
            type: 'circle',
            cx,
            cy,
            r: s.r,
            style: { fill: 'none', stroke: SIZE_STROKE, strokeWidth: 1 },
            cls: 'bc-legend-size',
          });
          prims.push({ type: 'text', x: labelX, y: cy, text: s.label, size: FONT, baseline: 'middle', style: { fill: TEXT } });
        };
        if (column) {
          const width = Math.max(2 * rMax + GAP + sizes.reduce((m, s) => Math.max(m, s.w), 0), title) + 2 * PAD;
          const left = (side === 'right' ? x + w + offset.right : x - offset.left - width) + PAD;
          writeTitle(left, y + 4);
          // stacked downwards on one center line, each in a slot as tall as the circle (never shorter than a line of
          // text); the labels line up past the biggest circle
          let top = y + 4 + head;
          for (const s of sizes) {
            const slot = Math.max(2 * s.r, ROW) + 4;
            circle(left + rMax, top + slot / 2, s, left + 2 * rMax + GAP);
            top += slot;
          }
        } else {
          // left to right, each label right after its own circle; lines wrap on a narrow plot
          const lines = sizeLines(sizes, rowRoom(ctx, side));
          let top =
            side === 'top' ? y - offset.top - (lines.reduce((sum, l) => sum + l.h, 0) + PAD + head) : y + h + offset.bottom + PAD / 2;
          writeTitle(rowStart(ctx, side, x, title), top);
          top += head;
          for (const line of lines) {
            let cx = rowStart(
              ctx,
              side,
              x,
              line.items.reduce((sum, s, k) => sum + (k ? ITEM_GAP : 0) + sizeWidth(s), 0),
            );
            for (const s of line.items) {
              circle(cx + s.r, top + line.h / 2, s, cx + 2 * s.r + GAP);
              cx += sizeWidth(s) + ITEM_GAP;
            }
            top += line.h;
          }
        }
        return { axes: prims };
      }

      if (!swatches(scale)) {
        const [d0, d1] = scale.domain() as number[];
        const length = barLength(column, ctx);
        const ticks = barTicks(scale, spec);
        const widest = ticks.reduce((m, t) => Math.max(m, ctx.measure(t.label, FONT).w), 0);
        const boxW = Math.max(BAR + GAP + widest, title) + 2 * PAD;
        const left = side === 'right' ? x + w + offset.right + PAD : x - offset.left - boxW + PAD;
        const start =
          side === 'top' ? y - offset.top - (BAR + ctx.measure('0', FONT).h + 2 * PAD + head) + PAD : y + h + offset.bottom + PAD;
        const top = start + head;
        const barTop = y + 4 + head;
        if (column) writeTitle(left, y + 4);
        else writeTitle(rowStart(ctx, side, x, title), start);
        const slice = (length / STEPS) * 1.05; // a hair of overlap hides seams between slices
        for (let k = 0; k < STEPS; k++) {
          const value = column ? d1 - ((k + 0.5) / STEPS) * (d1 - d0) : d0 + ((k + 0.5) / STEPS) * (d1 - d0);
          const color = scale(value);
          prims.push(
            column
              ? { type: 'rect', x: left, y: barTop + (k * length) / STEPS, w: BAR, h: slice, style: { fill: color }, cls: 'bc-legend-bar' }
              : { type: 'rect', x: x + (k * length) / STEPS, y: top, w: slice, h: BAR, style: { fill: color }, cls: 'bc-legend-bar' },
          );
        }
        for (const t of ticks) {
          prims.push(
            column
              ? {
                  type: 'text',
                  x: left + BAR + GAP,
                  y: barTop + (1 - t.pos) * length,
                  text: t.label,
                  size: FONT,
                  baseline: 'middle',
                  style: { fill: TEXT },
                }
              : {
                  type: 'text',
                  x: x + t.pos * length,
                  y: top + BAR + 3,
                  text: t.label,
                  size: FONT,
                  anchor: 'middle',
                  baseline: 'hanging',
                  style: { fill: TEXT },
                },
          );
        }
        return { axes: prims };
      }

      const items = itemsOf(scale, ctx, column ? Infinity : rowRoom(ctx, side));
      const put = (px: number, py: number, it: Item) => {
        prims.push({
          type: 'g',
          cls: 'bc-legend-item',
          data: { 'bc-legend-scale': String(spec.scale), 'bc-legend-index': String(it.index) },
          style: it.hidden ? { opacity: HIDDEN_OPACITY } : undefined,
          title: it.label !== it.full ? it.full : undefined,
          children: [
            {
              type: 'rect',
              x: px,
              y: py + (ROW - SWATCH) / 2,
              w: SWATCH,
              h: SWATCH,
              r: SWATCH / 2,
              style: { fill: it.color },
              cls: 'bc-legend-swatch',
            },
            { type: 'text', x: px + SWATCH + GAP, y: py + ROW / 2, text: it.label, size: FONT, baseline: 'middle', style: { fill: TEXT } },
          ],
        });
      };

      if (column) {
        const width = Math.max(SWATCH + GAP + items.reduce((m, it) => Math.max(m, it.w), 0), title) + 2 * PAD;
        const left = side === 'right' ? x + w + offset.right : x - offset.left - width;
        writeTitle(left + PAD, y + 4);
        items.forEach((it, i) => put(left + PAD, y + 4 + head + i * ROW, it));
      } else {
        const lines = linesOf(items, rowRoom(ctx, side));
        const start = side === 'top' ? y - offset.top - (lines.length * ROW + PAD + head) : y + h + offset.bottom + PAD / 2;
        const top = start + head;
        writeTitle(rowStart(ctx, side, x, title), start);
        lines.forEach((line, k) => {
          let cx = rowStart(
            ctx,
            side,
            x,
            line.reduce((sum, it, j) => sum + (j ? ITEM_GAP : 0) + itemWidth(it), 0),
          );
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
