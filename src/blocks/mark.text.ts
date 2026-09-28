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
    version: 2,
    doc: 'A text label per row at (x, y): value labels on bars, annotations on points. The text comes from the `text` field: numbers are written with `format` (a preset such as "percent" or an object of Intl options), or rounded to `decimals`, or to 6 significant digits. On a band scale the label is centered in its band. Rows without text are skipped. To keep a label readable on a colored cell, give it `on`: the same field as the cell\'s color.',
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
    },
    channels: {
      x: { required: true, scales: ['linear', 'time', 'band'] },
      y: { required: true, scales: ['linear', 'time', 'band'] },
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
      const { from, to } = ctx.rows(spec);
      const out: BC.Prim[] = [];
      for (let i = from; i < to; i++) {
        const x = cx.mapped[i] + halfX + dx;
        const y = cy.mapped[i] + halfY + dy;
        const text = write ? write(labels[i]) : format(labels[i], decimals);
        const color = backgrounds ? (backgrounds[i] ? readableOn(backgrounds[i]) || fill : '') : colors ? colors[i] : fill;
        if (!text || !isFinite(x) || !isFinite(y) || !color) continue;
        out.push({ type: 'text', x, y, text, size, weight, anchor, baseline, rotate, style: { fill: color }, ref: { mark: index, row: i } });
      }
      return out;
    },
  };

  BC.define(def);
})();
