(function () {
  const UP = 'var(--bc-good, #12a150)';
  const DOWN = 'var(--bc-bad, #e5484d)';
  const WIDTH = 0.7;
  /** How far from a candle the pointer can be, on a chart where they are far apart. */
  const REACH = 12;

  interface Candle {
    row: number;
    /** Center in px. */
    x: number;
    open: number;
    high: number;
    low: number;
    close: number;
    up: boolean;
  }

  /** The distance between the two nearest candles; 0 with fewer than two. */
  function smallestStep(xs: number[]): number {
    const sorted = xs.slice().sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < sorted.length; i++) {
      const d = sorted[i] - sorted[i - 1];
      if (d > 1e-6 && d < step) step = d;
    }
    return step === Infinity ? 0 : step;
  }

  /** The candles in px and their width, shared by render and pick so that what is drawn is what is hit. A row with a
   *  value missing has no candle: half a candle would look like a real price. */
  function geometry(spec: BC.MarkSpec, ctx: BC.ChartCtx): { candles: Candle[]; width: number; step: number } {
    const x = ctx.channel(spec, 'x');
    const open = ctx.channel(spec, 'open');
    const high = ctx.channel(spec, 'high');
    const low = ctx.channel(spec, 'low');
    const close = ctx.channel(spec, 'close');
    const band = x.scale && x.scale.bandwidth !== undefined ? x.scale.bandwidth : 0;
    const { from, to } = ctx.rows(spec);
    const candles: Candle[] = [];
    for (let row = from; row < to; row++) {
      const c = {
        row,
        x: x.mapped[row] + band / 2,
        open: open.mapped[row],
        high: high.mapped[row],
        low: low.mapped[row],
        close: close.mapped[row],
      };
      // the prices are read as they were given: a scale turns an empty one into 0, which would be a price
      const given = [open, high, low, close].every((p) => typeof p.raw[row] === 'number');
      if (!given || ![c.x, c.open, c.high, c.low, c.close].every(isFinite)) continue;
      // on a chart y grows downwards: a price that rose ends above where it began. A flat one counts as up.
      candles.push({ ...c, up: c.close <= c.open });
    }
    const step = band || smallestStep(candles.map((c) => c.x)) || ctx.plot.w * 0.1;
    const share = typeof spec.width === 'number' && spec.width > 0 ? Math.min(1, spec.width) : WIDTH;
    return { candles, width: Math.max(1, step * share), step };
  }

  const def: BC.MarkDef = {
    role: 'mark',
    type: 'candlestick',
    version: 3,
    doc: 'Open-high-low-close candles, one per row: a body from `open` to `close`, a thin wick from `low` to `high`, in one color when the price rose and in another when it fell. `x` is a date on a time scale (candles as wide as the nearest two allow) or a category on a band scale; the four prices share the scale of `y`. A row with one of its prices missing has no candle.',
    params: {
      width: { kind: 'number', default: WIDTH, doc: 'Width of a body, as a share (0-1) of the step between candles.' },
      up: { kind: 'color', default: UP, doc: 'Color of a candle whose close is not below its open.' },
      down: { kind: 'color', default: DOWN, doc: 'Color of a candle whose close is below its open.' },
      strokeWidth: { kind: 'number', default: 1, doc: 'Width of the wick.' },
      opacity: { kind: 'number', default: 1 },
    },
    channels: {
      x: { required: true, accepts: { output: 'position' } },
      open: {
        required: true,
        accepts: { output: 'position', input: ['number'] },
        sharesScale: 'y',
        doc: 'Price at the start of the period.',
      },
      high: { required: true, accepts: { output: 'position', input: ['number'] }, sharesScale: 'y', doc: 'Highest price of the period.' },
      low: { required: true, accepts: { output: 'position', input: ['number'] }, sharesScale: 'y', doc: 'Lowest price of the period.' },
      close: {
        required: true,
        accepts: { output: 'position', input: ['number'] },
        sharesScale: 'y',
        doc: 'Price at the end of the period.',
      },
    },
    render(spec, ctx, index) {
      const { candles, width } = geometry(spec, ctx);
      const opacity = typeof spec.opacity === 'number' ? spec.opacity : undefined;
      const strokeWidth = typeof spec.strokeWidth === 'number' && spec.strokeWidth > 0 ? spec.strokeWidth : 1;
      const up = typeof spec.up === 'string' ? spec.up : UP;
      const down = typeof spec.down === 'string' ? spec.down : DOWN;
      const out: BC.Prim[] = [];
      for (const c of candles) {
        const color = c.up ? up : down;
        out.push({ type: 'path', d: `M${c.x} ${c.high}L${c.x} ${c.low}`, style: { stroke: color, strokeWidth, opacity } });
        out.push({
          type: 'rect',
          x: c.x - width / 2,
          y: Math.min(c.open, c.close),
          w: width,
          // an open equal to the close still has to show
          h: Math.max(1, Math.abs(c.open - c.close)),
          style: { fill: color, opacity },
          ref: { mark: index, row: c.row },
        });
      }
      return out;
    },
    pick(spec, ctx, _index, px) {
      const { candles, width, step } = geometry(spec, ctx);
      const reach = Math.max(width / 2, Math.min(step / 2, REACH));
      let best: Candle | null = null;
      let dist = Infinity;
      for (const c of candles) {
        const d = Math.abs(c.x - px);
        if (d <= reach && d < dist) {
          best = c;
          dist = d;
        }
      }
      if (!best) return null;
      const top = Math.min(best.open, best.close);
      const h = Math.max(1, Math.abs(best.open - best.close));
      return { row: best.row, x: best.x, y: top, dist, box: { x: best.x - width / 2, y: top, w: width, h } };
    },
  };

  BC.define(def);
})();
