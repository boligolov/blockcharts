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
    if (!scale || (scale.kind !== 'color' && scale.kind !== 'sequential')) throw new Error('guide.legend needs a color scale');
    return scale;
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
  function barTicks(scale: BC.Scale, spec: BC.GuideSpec): BC.Tick[] {
    const ticks = scale.ticks ? scale.ticks(4) : [];
    if (spec.format === undefined) return ticks;
    const write = BC.formatter(spec.format as BC.FormatSpec | string, 'number');
    return ticks.map((t) => ({ value: t.value, pos: t.pos, label: write(t.value) }));
  }

  const sideOf = (spec: BC.GuideSpec): Side => spec.position || 'right';
  const isColumn = (side: Side) => side === 'left' || side === 'right';
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  function barLength(column: boolean, ctx: BC.ChartCtx): number {
    return column ? clamp(ctx.plot.h * 0.6, 80, 200) : clamp(ctx.plot.w * 0.4, 100, 240);
  }

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'legend',
    version: 3,
    doc: 'Legend of a color scale. A categorical scale (`color`) lists every value with a swatch, and values a filter hides stay listed, dimmed. A continuous scale (`sequential`) draws a color bar with a few labels. On the right or left it is a column, on top or bottom a row. Takes space on its side like an axis, so list it after an axis on the same side to sit outside it.',
    params: {
      scale: { kind: 'scale', required: true, doc: 'A color or sequential scale.' },
      position: { kind: 'enum', values: ['top', 'right', 'bottom', 'left'], default: 'right' },
      format: { kind: 'any', doc: 'How to write the labels of a color bar (a `sequential` scale): a preset ("percent", "compact", ...) or an object of Intl options; see guide.axis `format`.' },
    },
    measure(spec, ctx) {
      const side = sideOf(spec);
      const scale = scaleOf(spec, ctx);
      const column = isColumn(side);
      const out: Partial<BC.Insets> = {};
      if (scale.kind === 'sequential') {
        const labels = barTicks(scale, spec);
        const widest = labels.reduce((m, t) => Math.max(m, ctx.measure(t.label, FONT).w), 0);
        out[side] = column ? BAR + GAP + widest + 2 * PAD : BAR + ctx.measure('0', FONT).h + 2 * PAD;
        return out;
      }
      const items = itemsOf(scale, ctx);
      out[side] = !items.length ? 0 : column ? SWATCH + GAP + items.reduce((m, it) => Math.max(m, it.w), 0) + 2 * PAD : ROW + PAD;
      return out;
    },
    render(spec, ctx, offset) {
      const side = sideOf(spec);
      const scale = scaleOf(spec, ctx);
      const column = isColumn(side);
      const { x, y, w, h } = ctx.plot;
      const prims: BC.Prim[] = [];

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
            { type: 'rect', x: px, y: py + (ROW - SWATCH) / 2, w: SWATCH, h: SWATCH, r: 2, style: { fill: it.color }, cls: 'bc-legend-swatch' },
            { type: 'text', x: px + SWATCH + GAP, y: py + ROW / 2, text: it.label, size: FONT, baseline: 'middle', style: { fill: TEXT } },
          ],
        });
      };

      if (column) {
        const width = SWATCH + GAP + items.reduce((m, it) => Math.max(m, it.w), 0) + 2 * PAD;
        const left = side === 'right' ? x + w + offset.right : x - offset.left - width;
        items.forEach((it, i) => put(left + PAD, y + 4 + i * ROW, it));
      } else {
        const top = side === 'top' ? y - offset.top - (ROW + PAD) : y + h + offset.bottom + PAD / 2;
        let cx = x;
        for (const it of items) {
          put(cx, top, it);
          cx += SWATCH + GAP + it.w + 14;
        }
      }
      return { axes: prims };
    },
  };

  BC.define(def);
})();
