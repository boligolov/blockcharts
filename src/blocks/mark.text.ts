(function () {
  const TEXT = 'var(--bc-text, #444)';
  const DARK = '#111';
  const LIGHT = '#fff';
  /** Relative luminance of DARK, which is not black: comparing with black favors dark text on mid blues. */
  const DARK_LUMINANCE = 0.0056;

  /** The text color for a background. A palette color can differ per page and theme, and only the browser knows which one
   *  is on, so a page says what reads on it with --bc-on-c<N>; the value worked out from the fallback is for a page that
   *  does not. A renderer resolves it like any variable, also when the theme changes. */
  function inkOn(background: unknown): string | null {
    const ink = readableOn(background);
    const palette = typeof background === 'string' ? /^var\(--bc-c(\d+),/.exec(background) : null;
    return ink && palette ? `var(--bc-on-c${palette[1]}, ${ink})` : ink;
  }

  /** Black or white, whichever reads better on a background color given as #rgb / #rrggbb (also inside var(--x, #hex)). */
  function readableOn(background: unknown): string | null {
    const m = typeof background === 'string' ? /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(background) : null;
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const lin = (i: number) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    // WCAG contrast of each candidate against the background: (L1 + 0.05) / (L2 + 0.05)
    return (lum + 0.05) / (DARK_LUMINANCE + 0.05) >= 1.05 / (lum + 0.05) ? DARK : LIGHT;
  }

  /** Width of a label in px, from the widths of its characters in a sans-serif such as Inter (measured in Chrome),
   *  a little over the real width. ctx.measure() is too generous here: it would shrink or drop labels that fit. */
  function widthOf(text: string, size: number, weight: unknown): number {
    let em = 0;
    for (const ch of text) {
      if (ch === ' ' || "iIl|!.,:;'".indexOf(ch) >= 0) em += 0.28;
      else if ('fjrt()[]-'.indexOf(ch) >= 0) em += 0.4;
      else if (ch === 'M' || ch === 'W' || ch === 'm' || ch === 'w' || ch === '%' || ch === '@') em += 0.95;
      else if (ch >= '0' && ch <= '9') em += 0.6;
      else if (ch >= 'a' && ch <= 'z') em += 0.54;
      else if (ch >= 'A' && ch <= 'Z') em += 0.7;
      else if (ch.charCodeAt(0) < 0x2e80) em += 0.62;
      else em += 1; // CJK and other full-width characters
    }
    const bold =
      weight === 'bold' || (typeof weight === 'number' && weight >= 700) ? 1.08 : typeof weight === 'number' && weight >= 600 ? 1.04 : 1;
    return em * size * bold;
  }

  function format(v: unknown, decimals: number | undefined): string {
    if (v == null) return '';
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      if (decimals !== undefined) return v.toFixed(decimals);
      return Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
    }
    return String(v);
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'text',
    version: 8,
    doc: 'A text label per row at (x, y): value labels on bars, annotations on points. The text comes from the `text` field: numbers are written with `format` (a preset such as "percent" or an object of Intl options), or rounded to `decimals`, or to 6 significant digits. On a band scale the label is centered in its band. Rows without text are skipped. To keep a label readable on a colored cell, give it `on`: the same field as the cell\'s color. A label never runs into its neighbours or out of its cell: on a band x scale (anchor middle) it must fit the step from one category to the next, and with `x2` / `y2` it must fit the box from (x, y) to (x2, y2), keeping `dx` / `dy` as the margin on the far side too (the cells of a treemap); with anchor or baseline "middle" it sits in the middle of the box. A label that does not fit is drawn smaller, down to `minSize`, and is left out below that.',
    params: {
      size: { kind: 'number', default: 11, doc: 'Font size in px.' },
      weight: { kind: 'any', doc: 'Font weight: a number (600) or a word ("bold").' },
      anchor: { kind: 'enum', values: ['start', 'middle', 'end'], default: 'middle', doc: 'Horizontal alignment to the anchor point.' },
      baseline: {
        kind: 'enum',
        values: ['auto', 'middle', 'hanging'],
        default: 'middle',
        doc: '"auto" puts the text above the point, "hanging" below it, "middle" centers it.',
      },
      dx: { kind: 'number', default: 0, doc: 'Move right by this many px.' },
      dy: {
        kind: 'number',
        default: 0,
        doc: 'Move down by this many px (negative moves up, e.g. -4 with baseline "auto" for a label above a bar).',
      },
      rotate: { kind: 'number', default: 0, doc: 'Degrees around the anchor point.' },
      decimals: { kind: 'number', doc: 'Fixed number of decimals for numeric text.' },
      format: {
        kind: 'any',
        doc: 'How to write numbers (and dates): a preset ("percent", "compact", "integer", "date", ...) or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }; also "locale", "prefix", "suffix". Overrides `decimals`.',
      },
      fill: { kind: 'string', doc: 'Any CSS color. Default: the theme text color.' },
      negative: {
        kind: 'enum',
        values: ['same', 'flip'],
        default: 'same',
        doc: '"flip" mirrors the placement of a row whose value is below zero, so that the label of a negative bar sits past its end, not inside it: `baseline` and `dy` on a value y, `anchor` and `dx` on a value x (with a band y, as in horizontal bars).',
      },
      collide: {
        kind: 'enum',
        values: ['show', 'hide'],
        default: 'show',
        doc: '"hide" keeps labels off each other, for names on points: in row order, a label that would touch one already placed tries the other side of its point (mirrored `baseline` and `dy`) and is left out if that is taken too. Sort the rows to choose which labels win.',
      },
      minSize: {
        kind: 'number',
        default: 8,
        doc: 'The smallest font size a label that does not fit may shrink to; a label that would need less is not drawn. Set it to `size` to never shrink.',
      },
    },
    channels: {
      x: { required: true, scales: ['linear', 'log', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'log', 'time', 'band'] },
      x2: {
        scales: ['linear', 'log', 'time'],
        sharesScale: 'x',
        doc: 'The other side of the box the label has to fit in (with y2: the cell it labels).',
      },
      y2: { scales: ['linear', 'log', 'time'], sharesScale: 'y', doc: 'The other side of the box the label has to fit in, vertically.' },
      text: { required: true, unscaled: true, doc: 'Field with the text to show.' },
      color: { scales: ['color', 'sequential'], doc: 'Text color per row, from a color scale.' },
      on: {
        scales: ['color', 'sequential'],
        sharesScale: 'color',
        doc: 'The color the text sits on (the field a heatmap cell is colored by): the text turns dark or light to stay readable. On a palette color a theme can set the text with `--bc-on-c<N>`. Rows with no such color get no text.',
      },
    },
    render(spec, ctx, index) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const labels = ctx.channel(spec, 'text').raw;
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const backgrounds = spec.on !== undefined ? ctx.channel(spec, 'on').mapped : null;
      const write = spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : null;
      const halfX = cx.half;
      const halfY = cy.half;
      const size = typeof spec.size === 'number' ? spec.size : 11;
      const anchor = spec.anchor === 'start' || spec.anchor === 'end' ? spec.anchor : 'middle';
      const baseline = spec.baseline === 'auto' || spec.baseline === 'hanging' ? spec.baseline : 'middle';
      const dx = typeof spec.dx === 'number' ? spec.dx : 0;
      const dy = typeof spec.dy === 'number' ? spec.dy : 0;
      const rotate = typeof spec.rotate === 'number' && spec.rotate !== 0 ? spec.rotate : undefined;
      const decimals = typeof spec.decimals === 'number' && spec.decimals >= 0 ? Math.min(20, Math.floor(spec.decimals)) : undefined;
      const weight = typeof spec.weight === 'number' || typeof spec.weight === 'string' ? spec.weight : undefined;
      const fill = typeof spec.fill === 'string' ? spec.fill : TEXT;
      const minSize = typeof spec.minSize === 'number' && spec.minSize > 0 ? Math.min(spec.minSize, size) : Math.min(8, size);
      const x2 = spec.x2 !== undefined ? ctx.channel(spec, 'x2').mapped : null;
      const y2 = spec.y2 !== undefined ? ctx.channel(spec, 'y2').mapped : null;
      // the room of a label centered in a band: the distance to the next band's center, less a small gap
      let bandRoom = Infinity;
      if (halfX && !x2 && anchor === 'middle' && rotate === undefined && cx.scale) {
        const cats = cx.scale.domain() as unknown[];
        const step = cats.length > 1 ? Math.abs((cx.scale(cats[1]) as number) - (cx.scale(cats[0]) as number)) : ctx.plot.w;
        if (isFinite(step) && step > 0) bandRoom = step - 4;
      }
      /** Room on each axis for a label whose anchor point (dx / dy added) is (x, y); Infinity when nothing bounds it
       *  (no band, no x2 / y2, or a row whose x2 / y2 is missing). */
      const roomAt = (i: number, x: number, y: number): [number, number] => {
        let w = bandRoom;
        let h = Infinity;
        if (x2 && rotate === undefined && isFinite(x2[i])) {
          const lo = Math.min(cx.mapped[i], x2[i]);
          const hi = Math.max(cx.mapped[i], x2[i]);
          const m = Math.abs(dx);
          w = anchor === 'start' ? hi - x - m : anchor === 'end' ? x - lo - m : 2 * Math.min(x - lo, hi - x) - 2 * m;
          if (!(w >= 0)) w = 0;
        }
        if (y2 && rotate === undefined && isFinite(y2[i])) {
          const lo = Math.min(cy.mapped[i], y2[i]);
          const hi = Math.max(cy.mapped[i], y2[i]);
          const m = Math.abs(dy);
          h = baseline === 'hanging' ? hi - y - m : baseline === 'auto' ? y - lo - m : 2 * Math.min(y - lo, hi - y) - 2 * m;
          if (!(h >= 0)) h = 0;
        }
        return [w, h];
      };
      const flipNegative = spec.negative === 'flip';
      const flipX = flipNegative && !!cy.half && !cx.half;
      const values = flipNegative ? (flipX ? cx : cy).raw : null;
      const hideOverlaps = spec.collide === 'hide' && rotate === undefined;
      const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
      /** The box of a label, from its anchor point. */
      const boxOf = (text: string, px: number, py: number, base: string, fontSize: number) => {
        const w = widthOf(text, fontSize, weight);
        const x0 = anchor === 'start' ? px : anchor === 'end' ? px - w : px - w / 2;
        const y0 = base === 'hanging' ? py : base === 'auto' ? py - fontSize : py - fontSize / 2;
        return { x0, x1: x0 + w, y0, y1: y0 + fontSize };
      };
      const free = (b: (typeof placed)[number]) => !placed.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
      const mirrored = (b: 'auto' | 'middle' | 'hanging') => (b === 'auto' ? 'hanging' : b === 'hanging' ? 'auto' : b);
      const { from, to } = ctx.rows(spec);
      const out: BC.Prim[] = [];
      for (let i = from; i < to; i++) {
        const below = values !== null && typeof values[i] === 'number' && (values[i] as number) < 0;
        const rowAnchor = below && flipX ? (anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : anchor) : anchor;
        const rowDx = below && flipX ? -dx : dx;
        let rowBaseline: 'auto' | 'middle' | 'hanging' = below && !flipX ? mirrored(baseline) : baseline;
        let rowDy = below && !flipX ? -dy : dy;
        // centered in its box, or `x` and `x2` would both be edges with no room around the anchor
        const xMid = x2 && !halfX && anchor === 'middle' && rotate === undefined && isFinite(x2[i]);
        const yMid = y2 && !halfY && baseline === 'middle' && rotate === undefined && isFinite(y2[i]);
        const x = (xMid ? (cx.mapped[i] + (x2 as ArrayLike<number>)[i]) / 2 : cx.mapped[i] + halfX) + rowDx;
        let y = (yMid ? (cy.mapped[i] + (y2 as ArrayLike<number>)[i]) / 2 : cy.mapped[i] + halfY) + rowDy;
        const text = write ? write(labels[i]) : format(labels[i], decimals);
        const color = backgrounds ? (backgrounds[i] ? inkOn(backgrounds[i]) || fill : '') : colors ? colors[i] : fill;
        if (!text || !isFinite(x) || !isFinite(y) || !color) continue;
        let fit = size;
        const [w, h] = roomAt(i, x, y);
        if (w < Infinity || h < Infinity) {
          // the glyphs of one line, from the top of a capital to the bottom of a descender, are about the font size tall
          fit = Math.min(size, (size * w) / widthOf(text, size, weight), h);
          if (!(fit >= minSize)) continue;
          fit = Math.floor(fit * 2) / 2;
        }
        if (hideOverlaps) {
          let box = boxOf(text, x, y, rowBaseline, fit);
          if (!free(box)) {
            const otherY = y - 2 * rowDy;
            const other = boxOf(text, x, otherY, mirrored(rowBaseline), fit);
            if (rowBaseline === 'middle' || !free(other)) continue;
            y = otherY;
            rowBaseline = mirrored(rowBaseline);
            rowDy = -rowDy;
            box = other;
          }
          placed.push(box);
        }
        out.push({
          type: 'text',
          x,
          y,
          text,
          size: fit,
          weight,
          anchor: rowAnchor,
          baseline: rowBaseline,
          rotate,
          style: { fill: color },
          ref: { mark: index, row: i },
        });
      }
      // the labels of a row of categories read as one series: they share the size of the smallest (cells keep their own)
      if (bandRoom < Infinity && !y2) {
        let common = size;
        for (const p of out) common = Math.min(common, (p as { size: number }).size);
        for (const p of out) (p as { size: number }).size = common;
      }
      return out;
    },
  };

  BC.define(def);
})();
