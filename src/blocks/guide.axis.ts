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
  const showLine = (spec: BC.GuideSpec, side: Side) =>
    spec.line === 'on' ? true : spec.line === 'off' ? false : side === 'top' || side === 'bottom';

  type Side = 'top' | 'right' | 'bottom' | 'left';

  function sideOf(spec: BC.GuideSpec, ctx: BC.ChartCtx): Side {
    if (spec.position) return spec.position;
    return spec.scale && ctx.orientation(spec.scale) === 'vertical' ? 'left' : 'bottom';
  }

  /** Axes whose categories lie at an angle, as decided when the space was measured: the render has to keep to what was reserved. */
  const slanted = new WeakMap<BC.GuideSpec, number>();
  /** cos 45°: how much of a slanted label's length it takes across and along the axis. */
  const SLANT = 0.71;
  const MIN_SLANT_STEP = 14;
  /** Below this step, labels at 45° lie on each other (a line of text is about 13 px across), so they stand upright. */
  const MIN_TILT_STEP = 19;
  const MAX_SLANT_CHARS = 20;
  /** The least room between two labels of a numeric or date axis. */
  const LABEL_GAP = 6;
  const SEQUENCE = /^\s*-?\d[\d.,:\/-]*(T[\d:.]+Z?)?\s*$/;

  /** Text categories name things, so reading only some of them is no use: when they do not fit, they all go at an angle.
   *  Dates and numbers run in order, so every few of them say enough, and sixty months are never slanted. */
  function slantOf(spec: BC.GuideSpec, ctx: BC.ChartCtx, side: Side): number {
    const scale = spec.scale ? ctx.scales[spec.scale as string] : undefined;
    if (!scale || scale.kind !== 'band' || side === 'left' || side === 'right' || ctx.orientation(spec.scale as string) !== 'horizontal')
      return 0;
    const cats = scale.domain() as unknown[];
    // the plot is not final yet: the vertical axes have still to take their room out of it
    let length = ctx.plot.w;
    for (const g of ctx.spec.guides || []) {
      if (g === spec) continue;
      if (g.type === 'axis') {
        const other = g.scale ? sideOf(g, ctx) : 'top';
        if (other === 'left' || other === 'right') length -= (def.measure as NonNullable<BC.GuideDef['measure']>)(g, ctx)[other] || 0;
      } else {
        const block = BC.get(`guide.${g.type}` as BC.BlockName) as BC.GuideDef | undefined;
        const m = block && block.measure ? block.measure(g, ctx) : {};
        length -= (m.left || 0) + (m.right || 0);
      }
    }
    if (cats.length < 2 || length / cats.length < MIN_SLANT_STEP) return 0;
    if (cats.every((c) => typeof c === 'number' || c instanceof Date || SEQUENCE.test(String(c)))) return 0;
    if (fits(spec, ctx, length) >= cats.length) return 0;
    return length / cats.length < MIN_TILT_STEP ? 90 : 45;
  }

  /** How many categories of the band fit along `length` px. A horizontal axis wraps a long label onto two lines, so what
   *  has to fit is about half of it (or its longest word); a vertical one stacks them a line apart. */
  function fits(spec: BC.GuideSpec, ctx: BC.ChartCtx, length: number): number {
    const name = spec.scale as string;
    const horizontal = ctx.orientation(name) === 'horizontal';
    let widest = 0;
    for (const v of ctx.scales[name].domain() as unknown[]) {
      const text = String(v);
      if (!horizontal) {
        widest = Math.max(widest, ctx.measure(text, FONT).h);
        continue;
      }
      const full = ctx.measure(text, FONT).w;
      // text without spaces in Chinese, Japanese or Korean breaks anywhere, so a word of it is no limit
      const word = text.split(/\s+/).reduce((m, part) => Math.max(m, ctx.measure(part, FONT).w / (ctx.wide(part) ? 2 : 1)), 0);
      widest = Math.max(widest, Math.min(full, Math.max(word, full / 2)));
    }
    // measure() is deliberately generous (layout must never clip), so real labels are narrower than it says: allow for that
    return Math.floor(length / (horizontal ? widest * 0.9 + 4 : widest + 3));
  }

  const shorten = (label: string) => (label.length > MAX_SLANT_CHARS ? label.slice(0, MAX_SLANT_CHARS - 1) + '…' : label);

  /** The ticks of the scale with their labels, written the way `format` says (numbers and dates; categories are as they are). */
  function labelled(spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] {
    return uncrowded(formatted(spec, ctx), spec, ctx);
  }

  /** Ticks along a horizontal numeric or date axis are spaced by count, not by what their labels turn out to say: a format
   *  can write one label many times (years, zoomed in to months) and it can write them wider than the space between them. */
  function uncrowded(ticks: BC.Tick[], spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] {
    if (ctx.scales[spec.scale as string].kind === 'band' || ctx.orientation(spec.scale as string) !== 'horizontal') return ticks;
    const keep = keeper(spec);
    const unique = ticks.filter((t, i) => i === 0 || t.label !== ticks[i - 1].label);
    if (unique.length < 2) return unique;
    let gap = Infinity;
    for (let i = 1; i < unique.length; i++) gap = Math.min(gap, Math.abs(unique[i].pos - unique[i - 1].pos));
    const widest = unique.reduce((m, t) => Math.max(m, ctx.measure(t.label, FONT).w), 0);
    const every = gap > 0 ? Math.ceil((widest + LABEL_GAP) / gap) : 1;
    return every > 1 ? unique.filter((_, i) => keep(i, unique.length, every)) : unique;
  }

  /** Thinning counts from the first label, or from the last with `anchor: "end"`, so a report on December says December. */
  const keeper = (spec: BC.GuideSpec) => (i: number, n: number, every: number) => (spec.anchor === 'end' ? n - 1 - i : i) % every === 0;

  /** How many labels of a horizontal band fit as they will be written: "Jan" is shorter than the "2025-01-01" it stands for. */
  function fitWritten(spec: BC.GuideSpec, ctx: BC.ChartCtx): number {
    if (spec.format === undefined || ctx.orientation(spec.scale as string) !== 'horizontal') return 0;
    const write = BC.formatter(spec.format as BC.FormatSpec | string);
    const cats = ctx.scales[spec.scale as string].domain() as unknown[];
    const widest = cats.reduce<number>((m, c) => Math.max(m, ctx.measure(write(c), FONT).w), 0);
    return Math.min(cats.length, Math.floor(ctx.plot.w / (widest + LABEL_GAP)));
  }

  /** The ticks asked of the scale. `count` is a wish for more or fewer, and a band still shows no more than fit. */
  function requested(spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] {
    const name = spec.scale as string;
    const scale = ctx.scales[name];
    const wish = typeof spec.count === 'number' && spec.count >= 1 ? Math.round(spec.count) : undefined;
    if (scale.kind !== 'band') return wish === undefined ? ctx.ticks(name) : ctx.ticks(name, wish);
    const fit = Math.max(ctx.ticks(name).length, fitWritten(spec, ctx));
    const shown = wish === undefined ? fit : Math.min(wish, fit);
    if (spec.anchor !== 'end') return ctx.ticks(name, shown);
    const all = ctx.ticks(name, (scale.domain() as unknown[]).length);
    const every = Math.max(1, Math.ceil(all.length / Math.max(1, shown)));
    const keep = keeper(spec);
    return all.filter((_, i) => keep(i, all.length, every));
  }

  function formatted(spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] {
    const scale = ctx.scales[spec.scale as string];
    const ticks = slanted.has(spec) ? ctx.ticks(spec.scale as string, (scale.domain() as unknown[]).length) : requested(spec, ctx);
    if (spec.format === undefined) return ticks;
    const kind = ctx.scales[spec.scale as string].kind;
    if (kind !== 'linear' && kind !== 'log' && kind !== 'time' && kind !== 'band') return ticks;
    // a band's categories are written as the format says what it is (a date preset, Intl date options or a number); a
    // category that is not such a value (plain text) stays as it is
    const write = BC.formatter(spec.format as BC.FormatSpec | string, kind === 'time' ? 'date' : kind === 'band' ? undefined : 'number');
    return ticks.map((t) => ({ value: t.value, pos: t.pos, label: write(t.value) }));
  }

  const written = (spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] =>
    slanted.has(spec) ? labelled(spec, ctx).map((t) => ({ ...t, label: shorten(t.label) })) : labelled(spec, ctx);

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
      if (words.length < 2) {
        if (!ctx.wide(label)) return [label];
        // Chinese, Japanese and Korean have no spaces to break at and may break between any two characters
        const chars = Array.from(label);
        let k = 1;
        while (k < chars.length - 1 && ctx.measure(chars.slice(0, k + 1).join(''), FONT).w <= room) k++;
        return [chars.slice(0, k).join(''), chars.slice(k).join('')];
      }
      let first = words[0];
      let k = 1;
      while (k < words.length - 1 && ctx.measure(first + ' ' + words[k], FONT).w <= room) first += ' ' + words[k++];
      return [first, words.slice(k).join(' ')];
    };
  }

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'axis',
    version: 12,
    doc: 'Labels for a positional scale, with an axis line and optional tick marks. Side defaults from the scale orientation; set `position` for a second axis. `format` writes the tick labels (currency, percent, dates), `title` names the axis. The quiet default: no tick marks, a line only along a horizontal axis; pair a value axis with guide.grid. Category labels too wide for their band wrap onto two lines; text categories that still do not fit (a narrow screen) all go at an angle, rather than some of them being left out, while dates and numbers show every few.',
    params: {
      scale: { kind: 'scale', required: true },
      position: { kind: 'enum', values: ['top', 'right', 'bottom', 'left'] },
      title: { kind: 'string', doc: 'Text that names the axis (with its unit, for example "Revenue, USD"). Rotated on a vertical axis.' },
      format: {
        kind: 'any',
        doc: 'How to write the tick labels: numbers and dates on a linear, log or time scale, and on a band scale categories that are dates ("2024-04-01" from an aggregate by quarter) or numbers; text categories stay as they are. A preset ("percent", "compact", "integer", "year", "quarter" (Q2 2024), "month", "day", "date", "datetime") or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 } or { "month": "short", "year": "2-digit" }. Also "locale" (default "en-US"), "prefix" and "suffix".',
      },
      line: {
        kind: 'enum',
        values: ['auto', 'on', 'off'],
        default: 'auto',
        doc: 'The axis line. "auto": drawn along a horizontal axis (the baseline bars stand on), left out on a vertical one, where grid lines do the job.',
      },
      ticks: { kind: 'boolean', default: false, doc: 'Small tick marks at the labels.' },
      count: {
        kind: 'number',
        doc: 'About how many labels to show: 12 for the months of a year. Labels that would not fit are still thinned.',
      },
      anchor: {
        kind: 'enum',
        values: ['start', 'end'],
        default: 'start',
        doc: 'Which end thinned labels count from: "end" keeps the last one, for a report about the latest period.',
      },
    },
    fits,
    measure(spec, ctx) {
      if (!spec.scale) return {};
      const side = sideOf(spec, ctx);
      const vertical = side === 'left' || side === 'right';
      const angle = slantOf(spec, ctx, side);
      if (angle) slanted.set(spec, angle);
      else slanted.delete(spec);
      if (angle) {
        const lean = angle === 90 ? 0 : SLANT;
        const height = angle === 90 ? 1 : SLANT;
        let across = 0;
        let left = 0;
        let right = 0;
        for (const t of written(spec, ctx)) {
          const reachAlong = ctx.measure(t.label, FONT).w * lean;
          across = Math.max(across, ctx.measure(t.label, FONT).w * height);
          // a label ends at its tick and runs away from it, to the left of the tick below the axis and to the right above it
          if (side === 'bottom') left = Math.max(left, ctx.plot.x - (t.pos - reachAlong));
          else right = Math.max(right, t.pos + reachAlong - (ctx.plot.x + ctx.plot.w));
        }
        const out: BC.GuideMeasure = { overhang: { top: 0, right, bottom: 0, left } };
        out[side] = reach(spec) + across + FONT * SLANT + PAD + (title(spec) ? TITLE_ROOM : 0);
        return out;
      }
      let label = 0;
      // labels are centered on their tick, so the first and last one can stick out past the plot edge
      const over: Partial<BC.Insets> = { top: 0, right: 0, bottom: 0, left: 0 };
      const p = ctx.plot;
      const wrap = wrapper(spec, ctx, side);
      for (const t of labelled(spec, ctx)) {
        const lines = wrap(t.label);
        const m = lines.reduce(
          (acc, line) => {
            const lm = ctx.measure(line, FONT);
            return { w: Math.max(acc.w, lm.w), h: acc.h };
          },
          { w: 0, h: lines.length > 1 ? lines.length * LINE : ctx.measure(t.label, FONT).h },
        );
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
      const ticks = written(spec, ctx);
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
            type: 'text',
            x: x0 + dir * r,
            y: t.pos,
            text: t.label,
            size: FONT,
            anchor: dir < 0 ? 'end' : 'start',
            baseline: 'middle',
            style: { fill: LABEL },
            cls: 'bc-axis-label',
          });
        }
        const tx = x0 + dir * (r + labelSpace + PAD + TITLE_ROOM / 2);
        // these scripts are written downwards with the characters upright, not turned on their side
        const upright = !!name && Array.from(name).every((c) => ctx.wide(c)) && name.length * TITLE_FONT * 1.1 <= h;
        if (upright) {
          const chars = Array.from(name);
          chars.forEach((c, k) => {
            texts.push({
              type: 'text',
              x: tx,
              y: y + h / 2 + (k - (chars.length - 1) / 2) * TITLE_FONT * 1.1,
              text: c,
              size: TITLE_FONT,
              weight: 600,
              anchor: 'middle',
              baseline: 'middle',
              style: { fill: TEXT },
              cls: 'bc-axis-title',
            });
          });
        } else if (name) {
          texts.push({
            type: 'text',
            x: tx,
            y: y + h / 2,
            text: name,
            size: TITLE_FONT,
            weight: 600,
            anchor: 'middle',
            baseline: 'middle',
            rotate: dir < 0 ? -90 : 90,
            style: { fill: TEXT },
            cls: 'bc-axis-title',
          });
        }
      } else {
        const dir = side === 'top' ? -1 : 1;
        const y0 = side === 'top' ? y - offset.top : y + h + offset.bottom;
        d = showLine(spec, side) ? `M${x} ${y0}H${x + w}` : '';
        const wrap = wrapper(spec, ctx, side);
        for (const t of ticks) {
          if (marks) d += `M${t.pos} ${y0}V${y0 + dir * TICK}`;
          if (slanted.has(spec)) {
            const angle = slanted.get(spec) as number;
            labelSpace = Math.max(labelSpace, ctx.measure(t.label, FONT).w * (angle === 90 ? 1 : SLANT) + FONT * SLANT);
            texts.push({
              type: 'text',
              x: t.pos,
              y: y0 + dir * r,
              text: t.label,
              size: FONT,
              anchor: dir < 0 ? 'start' : 'end',
              baseline: 'middle',
              rotate: -angle,
              style: { fill: LABEL },
              cls: 'bc-axis-label',
            });
            continue;
          }
          const lines = wrap(t.label);
          labelSpace = Math.max(labelSpace, lines.length > 1 ? lines.length * LINE : ctx.measure(t.label, FONT).h);
          // lines stack away from the axis: downwards below it, upwards above it
          const order = dir < 0 ? lines.slice().reverse() : lines;
          order.forEach((line, k) => {
            texts.push({
              type: 'text',
              x: t.pos,
              y: y0 + dir * (r + k * LINE),
              text: line,
              size: FONT,
              anchor: 'middle',
              baseline: dir < 0 ? 'auto' : 'hanging',
              style: { fill: LABEL },
              cls: 'bc-axis-label',
            });
          });
        }
        if (name) {
          const ty = y0 + dir * (r + labelSpace + PAD + 2);
          texts.push({
            type: 'text',
            x: x + w / 2,
            y: ty,
            text: name,
            size: TITLE_FONT,
            weight: 600,
            anchor: 'middle',
            baseline: dir < 0 ? 'auto' : 'hanging',
            style: { fill: TEXT },
            cls: 'bc-axis-title',
          });
        }
      }

      const line: BC.Prim[] = d ? [{ type: 'path', d, cls: 'bc-axis', style: { fill: 'none', stroke: COLOR, strokeWidth: 1 } }] : [];
      return { axes: [...line, ...texts] };
    },
  };

  BC.define(def);
})();
