(function () {
  const TICK = 5;
  const PAD = 4;
  /** Distance from the axis line to its labels when there are no tick marks: the labels breathe instead. */
  const GAP = 8;
  const FONT = 11;
  const TITLE_FONT = 12;
  const TITLE_ROOM = TITLE_FONT * 1.2 + PAD + 2; // what a title adds to the space the axis takes
  const COLOR = 'var(--bc-axis, #888)';
  const TEXT = 'var(--bc-text, #444)';
  /** Tick labels are quieter than titles and data labels. */
  const LABEL = 'var(--bc-label, var(--bc-text, #444))';

  /** How far the labels sit from the axis line: past the tick marks when there are any. */
  const reach = (spec: BC.GuideSpec) => (spec.ticks === true ? TICK + PAD : GAP);
  /** The axis line: shown on horizontal axes (the baseline the bars stand on), not on vertical ones, unless told. */
  const showLine = (spec: BC.GuideSpec, side: Side) => (spec.line === 'on' ? true : spec.line === 'off' ? false : side === 'top' || side === 'bottom');

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
  const LINE = FONT * 1.25;

  /** Category labels on a horizontal axis that are wider than their band break at spaces onto a second line (a third
   *  line never: the rest stays on the second). Other labels are one line. */
  function wrapper(spec: BC.GuideSpec, ctx: BC.ChartCtx, side: Side): (label: string) => string[] {
    const scale = spec.scale ? ctx.scales[spec.scale as string] : undefined;
    const n = scale && scale.kind === 'band' ? scale.domain().length : 0;
    if (!n || side === 'left' || side === 'right') return (label) => [label];
    const room = ctx.plot.w / n - 6;
    return (label) => {
      if (ctx.measure(label, FONT).w <= room) return [label];
      const words = label.split(/\s+/).filter(Boolean);
      if (words.length < 2) return [label];
      let first = words[0];
      let k = 1;
      while (k < words.length - 1 && ctx.measure(first + ' ' + words[k], FONT).w <= room) first += ' ' + words[k++];
      return [first, words.slice(k).join(' ')];
    };
  }

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'axis',
    version: 6,
    doc: 'Labels for a positional scale, with an axis line and optional tick marks. Side defaults from the scale orientation; set `position` for a second axis. `format` writes the tick labels (currency, percent, dates), `title` names the axis. The quiet default: no tick marks, a line only along a horizontal axis; pair a value axis with guide.grid. Category labels too wide for their band wrap onto two lines.',
    params: {
      scale: { kind: 'scale', required: true },
      position: { kind: 'enum', values: ['top', 'right', 'bottom', 'left'] },
      title: { kind: 'string', doc: 'Text that names the axis (with its unit, for example "Revenue, USD"). Rotated on a vertical axis.' },
      format: { kind: 'any', doc: 'How to write the tick labels of a linear or time scale: a preset ("percent", "compact", "integer", "year", "month", "day", "date", "datetime") or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 } or { "month": "short", "year": "2-digit" }. Also "locale" (default "en-US"), "prefix" and "suffix".' },
      line: { kind: 'enum', values: ['auto', 'on', 'off'], default: 'auto', doc: 'The axis line. "auto": drawn along a horizontal axis (the baseline bars stand on), left out on a vertical one, where grid lines do the job.' },
      ticks: { kind: 'boolean', default: false, doc: 'Small tick marks at the labels.' },
    },
    measure(spec, ctx) {
      if (!spec.scale) return {};
      const side = sideOf(spec, ctx);
      const vertical = side === 'left' || side === 'right';
      let label = 0;
      // labels are centered on their tick, so the first and last one can stick out past the plot edge
      const over: Partial<BC.Insets> = { top: 0, right: 0, bottom: 0, left: 0 };
      const p = ctx.plot;
      const wrap = wrapper(spec, ctx, side);
      for (const t of labelled(spec, ctx)) {
        const lines = wrap(t.label);
        const m = lines.reduce((acc, line) => { const lm = ctx.measure(line, FONT); return { w: Math.max(acc.w, lm.w), h: acc.h }; }, { w: 0, h: lines.length > 1 ? lines.length * LINE : ctx.measure(t.label, FONT).h });
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
      out[side] = reach(spec) + label + PAD + (title(spec) ? TITLE_ROOM : 0);
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
      const r = reach(spec);
      const marks = spec.ticks === true;

      if (side === 'left' || side === 'right') {
        const dir = side === 'left' ? -1 : 1;
        const x0 = side === 'left' ? x - offset.left : x + w + offset.right;
        d = showLine(spec, side) ? `M${x0} ${y}V${y + h}` : '';
        for (const t of ticks) {
          if (marks) d += `M${x0} ${t.pos}H${x0 + dir * TICK}`;
          labelSpace = Math.max(labelSpace, ctx.measure(t.label, FONT).w);
          texts.push({
            type: 'text', x: x0 + dir * r, y: t.pos, text: t.label, size: FONT,
            anchor: dir < 0 ? 'end' : 'start', baseline: 'middle', style: { fill: LABEL }, cls: 'bc-axis-label',
          });
        }
        if (name) {
          const tx = x0 + dir * (r + labelSpace + PAD + TITLE_ROOM / 2);
          texts.push({ type: 'text', x: tx, y: y + h / 2, text: name, size: TITLE_FONT, weight: 600, anchor: 'middle', baseline: 'middle', rotate: dir < 0 ? -90 : 90, style: { fill: TEXT }, cls: 'bc-axis-title' });
        }
      } else {
        const dir = side === 'top' ? -1 : 1;
        const y0 = side === 'top' ? y - offset.top : y + h + offset.bottom;
        d = showLine(spec, side) ? `M${x} ${y0}H${x + w}` : '';
        const wrap = wrapper(spec, ctx, side);
        for (const t of ticks) {
          if (marks) d += `M${t.pos} ${y0}V${y0 + dir * TICK}`;
          const lines = wrap(t.label);
          labelSpace = Math.max(labelSpace, lines.length > 1 ? lines.length * LINE : ctx.measure(t.label, FONT).h);
          // lines stack away from the axis: downwards below it, upwards above it
          const order = dir < 0 ? lines.slice().reverse() : lines;
          order.forEach((line, k) => {
            texts.push({
              type: 'text', x: t.pos, y: y0 + dir * (r + k * LINE), text: line, size: FONT,
              anchor: 'middle', baseline: dir < 0 ? 'auto' : 'hanging', style: { fill: LABEL }, cls: 'bc-axis-label',
            });
          });
        }
        if (name) {
          const ty = y0 + dir * (r + labelSpace + PAD + 2);
          texts.push({ type: 'text', x: x + w / 2, y: ty, text: name, size: TITLE_FONT, weight: 600, anchor: 'middle', baseline: dir < 0 ? 'auto' : 'hanging', style: { fill: TEXT }, cls: 'bc-axis-title' });
        }
      }

      const line: BC.Prim[] = d ? [{ type: 'path', d, cls: 'bc-axis', style: { fill: 'none', stroke: COLOR, strokeWidth: 1 } }] : [];
      return { axes: [...line, ...texts] };
    },
  };

  BC.define(def);
})();
