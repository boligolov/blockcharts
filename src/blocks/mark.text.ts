(function () {
  const TEXT = 'var(--bc-text, #444)';
  const DARK = '#111';
  const LIGHT = '#fff';

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
    return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? DARK : LIGHT;
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
    const bold = weight === 'bold' || (typeof weight === 'number' && weight >= 700) ? 1.08 : typeof weight === 'number' && weight >= 600 ? 1.04 : 1;
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
    version: 3,
    doc: 'A text label per row at (x, y): value labels on bars, annotations on points. The text comes from the `text` field: numbers are written with `format` (a preset such as "percent" or an object of Intl options), or rounded to `decimals`, or to 6 significant digits. On a band scale the label is centered in its band. Rows without text are skipped. To keep a label readable on a colored cell, give it `on`: the same field as the cell\'s color. A label never runs into its neighbours or out of its cell: on a band x scale (anchor middle) it must fit the step from one category to the next, and with `x2` / `y2` it must fit the box from (x, y) to (x2, y2), keeping `dx` / `dy` as the margin on the far side too (the cells of a treemap). A label that does not fit is drawn smaller, down to `minSize`, and is left out below that.',
    params: {
      size: { kind: 'number', default: 11, doc: 'Font size in px.' },
      weight: { kind: 'any', doc: 'Font weight: a number (600) or a word ("bold").' },
      anchor: { kind: 'enum', values: ['start', 'middle', 'end'], default: 'middle', doc: 'Horizontal alignment to the anchor point.' },
      baseline: { kind: 'enum', values: ['auto', 'middle', 'hanging'], default: 'middle', doc: '"auto" puts the text above the point, "hanging" below it, "middle" centers it.' },
      dx: { kind: 'number', default: 0, doc: 'Move right by this many px.' },
      dy: { kind: 'number', default: 0, doc: 'Move down by this many px (negative moves up, e.g. -4 with baseline "auto" for a label above a bar).' },
      rotate: { kind: 'number', default: 0, doc: 'Degrees around the anchor point.' },
      decimals: { kind: 'number', doc: 'Fixed number of decimals for numeric text.' },
      format: { kind: 'any', doc: 'How to write numbers (and dates): a preset ("percent", "compact", "integer", "date", ...) or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }; also "locale", "prefix", "suffix". Overrides `decimals`.' },
      fill: { kind: 'string', doc: 'Any CSS color. Default: the theme text color.' },
      minSize: { kind: 'number', default: 8, doc: 'The smallest font size a label that does not fit may shrink to; a label that would need less is not drawn. Set it to `size` to never shrink.' },
    },
    channels: {
      x: { required: true, scales: ['linear', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'time', 'band'] },
      x2: { scales: ['linear', 'time'], sharesScale: 'x', doc: 'The other side of the box the label has to fit in (with y2: the cell it labels).' },
      y2: { scales: ['linear', 'time'], sharesScale: 'y', doc: 'The other side of the box the label has to fit in, vertically.' },
      text: { required: true, unscaled: true, doc: 'Field with the text to show.' },
      color: { scales: ['color', 'sequential'], doc: 'Text color per row, from a color scale.' },
      on: { scales: ['color', 'sequential'], sharesScale: 'color', doc: 'The color the text sits on (the field a heatmap cell is colored by): the text turns dark or light to stay readable. Rows with no such color get no text.' },
    },
    render(spec, ctx, index) {
      const cx = ctx.channel(spec, 'x');
      const cy = ctx.channel(spec, 'y');
      const labels = ctx.channel(spec, 'text').raw;
      const colors = spec.color !== undefined ? ctx.channel(spec, 'color').mapped : null;
      const backgrounds = spec.on !== undefined ? ctx.channel(spec, 'on').mapped : null;
      const write = spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : null;
      const halfX = cx.scale && cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
      const halfY = cy.scale && cy.scale.bandwidth !== undefined ? cy.scale.bandwidth / 2 : 0;
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
      const { from, to } = ctx.rows(spec);
      const out: BC.Prim[] = [];
      for (let i = from; i < to; i++) {
        const x = cx.mapped[i] + halfX + dx;
        const y = cy.mapped[i] + halfY + dy;
        const text = write ? write(labels[i]) : format(labels[i], decimals);
        const color = backgrounds ? (backgrounds[i] ? readableOn(backgrounds[i]) || fill : '') : colors ? colors[i] : fill;
        if (!text || !isFinite(x) || !isFinite(y) || !color) continue;
        let fit = size;
        const [w, h] = roomAt(i, x, y);
        if (w < Infinity || h < Infinity) {
          // the glyphs of one line, from the top of a capital to the bottom of a descender, are about the font size tall
          fit = Math.min(size, (size * w) / widthOf(text, size, weight), h);
          if (!(fit >= minSize)) continue;
          fit = Math.floor(fit * 2) / 2;
        }
        out.push({ type: 'text', x, y, text, size: fit, weight, anchor, baseline, rotate, style: { fill: color }, ref: { mark: index, row: i } });
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
