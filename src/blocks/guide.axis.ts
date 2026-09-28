(function () {
  const TICK = 5;
  const PAD = 4;
  const FONT = 11;
  const TITLE_FONT = 12;
  const TITLE_ROOM = TITLE_FONT * 1.2 + PAD + 2; // what a title adds to the space the axis takes
  const COLOR = 'var(--bc-axis, #888)';
  const TEXT = 'var(--bc-text, #444)';

  type Side = 'top' | 'right' | 'bottom' | 'left';

  function sideOf(spec: BC.GuideSpec, ctx: BC.ChartCtx): Side {
    if (spec.position) return spec.position;
    return spec.scale && ctx.orientation(spec.scale) === 'vertical' ? 'left' : 'bottom';
  }

  /** The ticks of the scale with their labels, written the way `format` says (numbers and dates; categories are as they are). */
  function labelled(spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] {
    const ticks = ctx.ticks(spec.scale as string);
    if (spec.format === undefined) return ticks;
    const kind = ctx.scales[spec.scale as string].kind;
    if (kind !== 'linear' && kind !== 'time') return ticks;
    const write = BC.formatter(spec.format as BC.FormatSpec | string, kind === 'time' ? 'date' : 'number');
    return ticks.map((t) => ({ value: t.value, pos: t.pos, label: write(t.value) }));
  }

  const title = (spec: BC.GuideSpec): string => (typeof spec.title === 'string' ? spec.title : '');

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'axis',
    version: 4,
    doc: 'Axis line, ticks and labels for a positional scale. Side defaults from the scale orientation; set `position` for a second axis. `format` writes the tick labels (currency, percent, dates), `title` names the axis.',
    params: {
      scale: { kind: 'scale', required: true },
      position: { kind: 'enum', values: ['top', 'right', 'bottom', 'left'] },
      title: { kind: 'string', doc: 'Text that names the axis (with its unit, for example "Revenue, USD"). Rotated on a vertical axis.' },
      format: { kind: 'any', doc: 'How to write the tick labels of a linear or time scale: a preset ("percent", "compact", "integer", "year", "month", "day", "date", "datetime") or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 } or { "month": "short", "year": "2-digit" }. Also "locale" (default "en-US"), "prefix" and "suffix".' },
    },
    measure(spec, ctx) {
      if (!spec.scale) return {};
      const side = sideOf(spec, ctx);
      const vertical = side === 'left' || side === 'right';
      let label = 0;
      // labels are centered on their tick, so the first and last one can stick out past the plot edge
      const over: Partial<BC.Insets> = { top: 0, right: 0, bottom: 0, left: 0 };
      const p = ctx.plot;
      for (const t of labelled(spec, ctx)) {
        const m = ctx.measure(t.label, FONT);
        label = Math.max(label, vertical ? m.w : m.h);
        if (vertical) {
          over.top = Math.max(over.top!, p.y - (t.pos - m.h / 2));
          over.bottom = Math.max(over.bottom!, t.pos + m.h / 2 - (p.y + p.h));
        } else {
          over.left = Math.max(over.left!, p.x - (t.pos - m.w / 2));
          over.right = Math.max(over.right!, t.pos + m.w / 2 - (p.x + p.w));
        }
      }
      const out: BC.GuideMeasure = { overhang: over };
      out[side] = TICK + PAD + label + PAD + (title(spec) ? TITLE_ROOM : 0);
      return out;
    },
    render(spec, ctx, offset) {
      if (!spec.scale) return {};
      const side = sideOf(spec, ctx);
      const { x, y, w, h } = ctx.plot;
      const ticks = labelled(spec, ctx);
      const texts: BC.Prim[] = [];
      const name = title(spec);
      let d: string;
      let labelSpace = 0; // how far the labels reach from the axis line, for placing the title beyond them

      if (side === 'left' || side === 'right') {
        const dir = side === 'left' ? -1 : 1;
        const x0 = side === 'left' ? x - offset.left : x + w + offset.right;
        d = `M${x0} ${y}V${y + h}`;
        for (const t of ticks) {
          d += `M${x0} ${t.pos}H${x0 + dir * TICK}`;
          labelSpace = Math.max(labelSpace, ctx.measure(t.label, FONT).w);
          texts.push({
            type: 'text', x: x0 + dir * (TICK + PAD), y: t.pos, text: t.label, size: FONT,
            anchor: dir < 0 ? 'end' : 'start', baseline: 'middle', style: { fill: TEXT },
          });
        }
        if (name) {
          const tx = x0 + dir * (TICK + PAD + labelSpace + PAD + TITLE_ROOM / 2);
          texts.push({ type: 'text', x: tx, y: y + h / 2, text: name, size: TITLE_FONT, weight: 600, anchor: 'middle', baseline: 'middle', rotate: dir < 0 ? -90 : 90, style: { fill: TEXT }, cls: 'bc-axis-title' });
        }
      } else {
        const dir = side === 'top' ? -1 : 1;
        const y0 = side === 'top' ? y - offset.top : y + h + offset.bottom;
        d = `M${x} ${y0}H${x + w}`;
        for (const t of ticks) {
          d += `M${t.pos} ${y0}V${y0 + dir * TICK}`;
          labelSpace = Math.max(labelSpace, ctx.measure(t.label, FONT).h);
          texts.push({
            type: 'text', x: t.pos, y: y0 + dir * (TICK + PAD), text: t.label, size: FONT,
            anchor: 'middle', baseline: dir < 0 ? 'auto' : 'hanging', style: { fill: TEXT },
          });
        }
        if (name) {
          const ty = y0 + dir * (TICK + PAD + labelSpace + PAD + 2);
          texts.push({ type: 'text', x: x + w / 2, y: ty, text: name, size: TITLE_FONT, weight: 600, anchor: 'middle', baseline: dir < 0 ? 'auto' : 'hanging', style: { fill: TEXT }, cls: 'bc-axis-title' });
        }
      }

      const line: BC.Prim = { type: 'path', d, cls: 'bc-axis', style: { fill: 'none', stroke: COLOR, strokeWidth: 1 } };
      return { axes: [line, ...texts] };
    },
  };

  BC.define(def);
})();
