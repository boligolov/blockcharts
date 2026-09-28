(function () {
  const LABEL_SIZE = 12;
  const VALUE_SIZE = 30;
  const DELTA_SIZE = 12;
  const GAP = 6;
  const BOTTOM = 10;
  const LABEL = 'var(--bc-label, var(--bc-text, #666))';
  const VALUE = 'var(--bc-kpi, var(--bc-text, #111))';
  const GOOD = 'var(--bc-good, #12a150)';
  const BAD = 'var(--bc-bad, #e5484d)';
  const FLAT = 'var(--bc-label, #888)';
  const AGGREGATES = ['last', 'first', 'sum', 'mean', 'min', 'max', 'count'];

  /** The finite numbers of a column, in row order. */
  function numbers(col: BC.Column | undefined): number[] {
    const out: number[] = [];
    if (!col) return out;
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (typeof v === 'number' && isFinite(v)) out.push(v);
    }
    return out;
  }

  /** One number from a list, the way `aggregate` says; NaN when there is nothing to take it from. */
  function reduce(values: number[], how: string): number {
    if (how === 'count') return values.length;
    if (!values.length) return NaN;
    switch (how) {
      case 'first': return values[0];
      case 'sum': return values.reduce((a, b) => a + b, 0);
      case 'mean': return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min': return Math.min(...values);
      case 'max': return Math.max(...values);
      default: return values[values.length - 1];
    }
  }

  interface Figures {
    value: number;
    /** What the value is compared with; NaN when there is no comparison. */
    base: number;
  }

  function figures(spec: BC.GuideSpec, ctx: BC.ChartCtx): Figures {
    const how = typeof spec.aggregate === 'string' && AGGREGATES.indexOf(spec.aggregate) >= 0 ? spec.aggregate : 'last';
    const values = numbers(ctx.table.columns[spec.field as string]);
    const value = reduce(values, how);
    let base = NaN;
    if (typeof spec.against === 'string') {
      base = reduce(numbers(ctx.table.columns[spec.against]), how);
    } else {
      const compare = spec.compare === 'first' || spec.compare === 'none' || spec.compare === 'previous' ? spec.compare : how === 'last' ? 'previous' : 'none';
      if (compare === 'previous' && values.length > 1) base = values[values.length - 2];
      else if (compare === 'first' && values.length > 1) base = values[0];
    }
    return { value, base };
  }

  const height = (spec: BC.GuideSpec) => {
    const size = typeof spec.size === 'number' && spec.size > 0 ? spec.size : VALUE_SIZE;
    return (typeof spec.label === 'string' && spec.label ? LABEL_SIZE + GAP : 0) + size + GAP + DELTA_SIZE + BOTTOM;
  };

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'kpi',
    version: 1,
    doc: 'A key figure as the heading of a chart: a label, the value in large type, and its change against a comparison, green when it goes the good way and red when not. It takes the room it needs at the top, so a line or an area drawn in the same chart becomes the sparkline under the number. The value is one number from a field: the last row by default (`aggregate`), compared with the row before it; or compare with another field (`against`: a target, last year). A chart may consist of this guide alone (no marks) for a tile with just the number.',
    params: {
      field: { kind: 'field', required: true, doc: 'The numeric field the figure comes from.' },
      label: { kind: 'string', doc: 'What the figure is ("Revenue", "Active users"), above it.' },
      aggregate: { kind: 'enum', values: AGGREGATES, default: 'last', doc: 'How the rows make one number: the last row (the latest period, in data order), the first, or the sum, mean, min, max or count of the field.' },
      compare: { kind: 'enum', values: ['previous', 'first', 'none'], doc: 'What the change is measured against: the row before the last ("previous", the default with aggregate "last"), the first row ("first": change over the period), or nothing.' },
      against: { kind: 'field', doc: 'Compare with another field instead, aggregated the same way (a target, the same period last year).' },
      delta: { kind: 'enum', values: ['percent', 'absolute'], default: 'percent', doc: 'The change as a percentage of the comparison, or as a difference written with `format`.' },
      better: { kind: 'enum', values: ['up', 'down'], default: 'up', doc: 'Which way is good: "down" for costs, churn, response times.' },
      format: { kind: 'any', doc: 'How to write the value (a preset such as "compact" or "percent", or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }).' },
      note: { kind: 'string', doc: 'A few words after the change: "vs last month", "vs target".' },
      size: { kind: 'number', default: VALUE_SIZE, doc: 'Font size of the value, px.' },
    },
    measure(spec) {
      return { top: height(spec) };
    },
    render(spec, ctx, offset) {
      if (typeof spec.field !== 'string' || !ctx.table.columns[spec.field]) return {};
      const size = typeof spec.size === 'number' && spec.size > 0 ? spec.size : VALUE_SIZE;
      const label = typeof spec.label === 'string' ? spec.label : '';
      const left = ctx.plot.x;
      let y = ctx.plot.y - offset.top - height(spec);
      const out: BC.Prim[] = [];
      if (label) {
        out.push({ type: 'text', x: left, y, text: label, size: LABEL_SIZE, weight: 500, baseline: 'hanging', style: { fill: LABEL }, cls: 'bc-kpi-label' });
        y += LABEL_SIZE + GAP;
      }
      const { value, base } = figures(spec, ctx);
      const write = spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : (v: unknown) => BC.formatter('compact')(v);
      out.push({ type: 'text', x: left, y, text: isFinite(value) ? write(value) : '–', size, weight: 650, baseline: 'hanging', style: { fill: VALUE }, cls: 'bc-kpi-value' });
      y += size + GAP;

      if (isFinite(value) && isFinite(base)) {
        const diff = value - base;
        const up = diff > 0;
        const flat = diff === 0;
        const good = spec.better === 'down' ? !up : up;
        const color = flat ? FLAT : good ? GOOD : BAD;
        let text: string;
        if (spec.delta === 'absolute') {
          text = (up ? '+' : '') + write(diff);
        } else {
          // a change from zero has no percentage
          text = base !== 0 ? (up ? '+' : '') + BC.formatter({ style: 'percent', maximumFractionDigits: 1 })(diff / Math.abs(base)) : '';
        }
        const arrow = flat ? '■' : up ? '▲' : '▼';
        const change = `${arrow} ${text}`.trim();
        out.push({ type: 'text', x: left, y, text: change, size: DELTA_SIZE, weight: 600, baseline: 'hanging', style: { fill: color }, cls: 'bc-kpi-delta' });
        if (typeof spec.note === 'string' && spec.note) {
          const w = ctx.measure(change, DELTA_SIZE).w;
          out.push({ type: 'text', x: left + w + 6, y, text: spec.note, size: DELTA_SIZE, baseline: 'hanging', style: { fill: LABEL }, cls: 'bc-kpi-note' });
        }
      }
      return { axes: out };
    },
  };

  BC.define(def);
})();
