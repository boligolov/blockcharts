(function (BC: BC.Runtime) {
  const LABEL_SIZE = 12;
  const VALUE_SIZE = 30;
  const DELTA_SIZE = 12;
  const GAP = 6;
  const BOTTOM = 10;
  /** Between the change and the note after it. */
  const NOTE_GAP = 6;
  /** Kept free at the right of the chart: a font a little wider than the widths text is fitted by stays inside. */
  const EDGE = 2;
  /** The label and the line under the value are made no smaller than this to fit a narrow tile; past it they are cut. */
  const MIN_TEXT = 10;
  /** The value is made as much smaller as it takes (a number is never cut short), down to this. */
  const MIN_VALUE = 8;
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
      case 'first':
        return values[0];
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'mean':
        return values.reduce((a, b) => a + b, 0) / values.length;
      // a loop, not Math.min(...values): spreading a long series overflows the call stack
      case 'min':
        return values.reduce((a, b) => (b < a ? b : a));
      case 'max':
        return values.reduce((a, b) => (b > a ? b : a));
      default:
        return values[values.length - 1];
    }
  }

  interface Figures {
    value: number;
    /** What the value is compared with; NaN when there is no comparison. */
    base: number;
  }

  /** A field of every row: before decimate thins the rows for the sparkline (a field made after it only exists after it). */
  const column = (ctx: BC.ChartCtx, field: string): BC.Column | undefined => ctx.baseTable.columns[field] || ctx.table.columns[field];

  function figures(spec: BC.GuideSpec, ctx: BC.ChartCtx): Figures {
    const how = typeof spec.aggregate === 'string' && AGGREGATES.indexOf(spec.aggregate) >= 0 ? spec.aggregate : 'last';
    const values = numbers(column(ctx, spec.field as string));
    const value = reduce(values, how);
    let base = NaN;
    if (typeof spec.against === 'string') {
      base = reduce(numbers(column(ctx, spec.against)), how);
    } else {
      const compare =
        spec.compare === 'first' || spec.compare === 'none' || spec.compare === 'previous'
          ? spec.compare
          : how === 'last'
            ? 'previous'
            : 'none';
      if (compare === 'previous' && values.length > 1) base = values[values.length - 2];
      else if (compare === 'first' && values.length > 1) base = values[0];
    }
    return { value, base };
  }

  const noteOf = (spec: BC.GuideSpec) => (typeof spec.note === 'string' ? spec.note : '');

  /** The size a line of text is written at in `room` px: its own, or smaller when it is wider, down to `least`. */
  function fitted(ctx: BC.ChartCtx, text: string, size: number, weight: number, room: number, least: number): number {
    const w = ctx.textWidth(text, size, weight);
    if (w <= room) return size;
    return Math.max(Math.min(least, size), Math.floor(((size * room) / w) * 2) / 2);
  }

  /** The text cut to at most `room` wide, ending in an ellipsis when it had to be cut; whole characters only. */
  function cut(ctx: BC.ChartCtx, text: string, size: number, weight: number, room: number): string {
    if (ctx.textWidth(text, size, weight) <= room) return text;
    const chars = Array.from(text);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.textWidth(chars.slice(0, mid).join('') + '…', size, weight) <= room) lo = mid;
      else hi = mid - 1;
    }
    return lo ? chars.slice(0, lo).join('').trimEnd() + '…' : '';
  }

  interface Tile {
    /** There is a label, so its slot is kept, also when not a letter of it fits. */
    labelled: boolean;
    label: string;
    labelSize: number;
    value: string;
    valueSize: number;
    /** The arrow and the change; '' when there is no comparison. */
    change: string;
    changeColor: string;
    note: string;
    /** The size of the line under the value, the change and the note alike. */
    lineSize: number;
    height: number;
    /** What a screen reader hears: the label, the value, and the change with its note, whole and without the arrow. */
    spoken: string[];
  }

  /** What the tile writes and how large, in the width it has: from the left of the plot to the right of the chart. Every
   *  line keeps its size where it fits; in a narrow tile (two to a row on a phone) the value is made as much smaller as
   *  it takes, and the label and the line under the value down to MIN_TEXT, then cut with an ellipsis (the note before
   *  the change). Only the value's size changes the height: the other lines keep their slots. */
  function lay(spec: BC.GuideSpec, ctx: BC.ChartCtx): Tile {
    const room = Math.max(1, ctx.size.w - ctx.plot.x - EDGE);
    const own = typeof spec.size === 'number' && spec.size > 0 && isFinite(spec.size) ? spec.size : VALUE_SIZE;
    const row = rowName(spec, ctx);
    const named = typeof spec.label === 'string' ? spec.label : '';
    const fullLabel = named && row ? `${named}: ${row}` : named || row;
    const labelSize = fitted(ctx, fullLabel, LABEL_SIZE, 500, room, MIN_TEXT);
    const label = cut(ctx, fullLabel, labelSize, 500, room);

    const { value, base } = figures(spec, ctx);
    const write =
      spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : (v: unknown) => BC.formatter('compact')(v);
    const valueText = isFinite(value) ? write(value) : '–';
    const valueSize = fitted(ctx, valueText, own, 650, room, MIN_VALUE);

    let change = '';
    let changeSaid = '';
    let changeColor = FLAT;
    if (isFinite(value) && isFinite(base)) {
      const diff = value - base;
      const up = diff > 0;
      const flat = diff === 0;
      const good = spec.better === 'down' ? !up : up;
      changeColor = flat ? FLAT : good ? GOOD : BAD;
      const given = spec.deltaFormat !== undefined ? BC.formatter(spec.deltaFormat as BC.FormatSpec | string) : null;
      // a format may write the sign itself (signDisplay)
      const signed = (s: string) => (up && !/^[+]/.test(s) ? '+' + s : s);
      let text: string;
      if (spec.delta === 'absolute') {
        text = signed((given || write)(diff * (typeof spec.deltaScale === 'number' && isFinite(spec.deltaScale) ? spec.deltaScale : 1)));
      } else {
        // a change from zero has no percentage
        const percent = given || BC.formatter({ style: 'percent', maximumFractionDigits: 1 });
        text = base !== 0 ? signed(percent(diff / Math.abs(base))) : '';
      }
      const arrow = flat ? '■' : up ? '▲' : '▼';
      change = `${arrow} ${text}`.trim();
      changeSaid = text;
    }
    // the change and the note are one line at one size, the note NOTE_GAP after the change; the width is linear in the size
    const fullNote = noteOf(spec);
    const gap = change && fullNote ? NOTE_GAP : 0;
    const text = (s: number) => (change ? ctx.textWidth(change, s, 600) : 0) + (fullNote ? ctx.textWidth(fullNote, s, 400) : 0);
    const wide = text(DELTA_SIZE);
    const lineSize =
      gap + wide <= room ? DELTA_SIZE : Math.max(MIN_TEXT, Math.floor(((DELTA_SIZE * Math.max(0, room - gap)) / wide) * 2) / 2);
    if (change) change = cut(ctx, change, lineSize, 600, room);
    const note = fullNote ? cut(ctx, fullNote, lineSize, 400, room - (change ? ctx.textWidth(change, lineSize, 600) + gap : 0)) : '';

    // the slots go by what there is to say, not by what was left of it in the width
    const line = change || fullNote ? GAP + DELTA_SIZE : 0;
    const height = (fullLabel ? LABEL_SIZE + GAP : 0) + valueSize + line + BOTTOM;
    const spoken = [fullLabel, valueText, [changeSaid, fullNote].filter(Boolean).join(' ')];
    return { labelled: !!fullLabel, label, labelSize, value: valueText, valueSize, change, changeColor, note, lineSize, height, spoken };
  }

  /** What the row of the figure is called: the month of a maximum. An aggregate of many rows has no row of its own. */
  function rowName(spec: BC.GuideSpec, ctx: BC.ChartCtx): string {
    if (typeof spec.rowField !== 'string') return '';
    const names = column(ctx, spec.rowField);
    const col = column(ctx, spec.field as string);
    if (!names || !col) return '';
    const how = typeof spec.aggregate === 'string' ? spec.aggregate : 'last';
    let at = -1;
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      const best = at < 0 ? NaN : (col[at] as number);
      if (at < 0 || how === 'last' || (how === 'max' && v > best) || (how === 'min' && v < best)) at = i;
      if (how === 'first') break;
    }
    const name = at < 0 ? null : names[at];
    if (name === null || name === undefined || name !== name) return '';
    return spec.rowFormat !== undefined ? BC.formatter(spec.rowFormat as BC.FormatSpec | string)(names[at]) : String(names[at]);
  }

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'kpi',
    version: 10,
    // it fits its text to the width itself, so a tile is laid out at its card's width however narrow
    narrow: true,
    doc: 'A key figure as the heading of a chart: a label, the value in large type, and its change against a comparison, green when it goes the good way and red when not. It takes the room it needs at the top, so a line or an area drawn in the same chart becomes the sparkline under the number. The value is one number from a field: the last row by default (`aggregate`), compared with the row before it; or compare with another field (`against`: a target, last year). A chart may consist of this guide alone (no marks) for a tile with just the number. A tile is laid out at the width of its card, also two to a row on a phone: a value too wide for it is written smaller, and so are the label and the change, down to 10 px, then cut with an ellipsis. A screen reader hears the label, the value and the change after the name of the chart.',
    params: {
      field: { kind: 'field', required: true, doc: 'The numeric field the figure comes from.' },
      label: { kind: 'string', doc: 'What the figure is ("Revenue", "Active users"), above it.' },
      aggregate: {
        kind: 'enum',
        values: AGGREGATES,
        default: 'last',
        doc: 'How the rows make one number: the last row (the latest period, in data order), the first, or the sum, mean, min, max or count of the field.',
      },
      compare: {
        kind: 'enum',
        values: ['previous', 'first', 'none'],
        doc: 'What the change is measured against: the row before the last ("previous", the default with aggregate "last"), the first row ("first": change over the period), or nothing. "previous" and "first" compare single rows, so they go with aggregate "last" only; a sum or a mean is compared through `against`.',
      },
      against: { kind: 'field', doc: 'Compare with another field instead, aggregated the same way (a target, the same period last year).' },
      delta: {
        kind: 'enum',
        values: ['percent', 'absolute'],
        default: 'percent',
        doc: 'The change as a percentage of the comparison, or as a difference written with `format` (or `deltaFormat`).',
      },
      deltaFormat: {
        kind: 'format',
        doc: 'How to write the change when it is not in the same unit as the value: a share of 66.4% that moved by 1.8 points is { "maximumFractionDigits": 1, "suffix": " pp" }. A preset or an object of Intl options, as in `format`. With delta "percent" it gets the change as a fraction (0.12 for 12%). It writes the difference in the units of the field, so a share kept as 0..1 needs `deltaScale`.',
      },
      deltaScale: {
        kind: 'number',
        default: 1,
        doc: 'What an absolute change is multiplied by before it is written: 100 for a share kept as 0..1 that moved by 0.093 and is to read "+9.3 pp".',
      },
      better: { kind: 'enum', values: ['up', 'down'], default: 'up', doc: 'Which way is good: "down" for costs, churn, response times.' },
      format: {
        kind: 'format',
        doc: 'How to write the value (a preset such as "compact" or "percent", or an object of Intl options, e.g. { "style": "currency", "currency": "USD", "maximumFractionDigits": 0 }).',
      },
      note: {
        kind: 'string',
        doc: 'A few words after the change ("vs last month", "vs target"), or in its place when there is no change.',
      },
      rowField: {
        kind: 'field',
        doc: 'Names the row the figure comes from, after the label: with aggregate "max" and field "month", "Best month: 2025-09". For aggregate last, first, min and max: a sum has no row of its own.',
      },
      rowFormat: { kind: 'format', doc: 'How to write `rowField`, as in `format`: "month" for a date.' },
      size: { kind: 'number', default: VALUE_SIZE, doc: 'Font size of the value, px.' },
    },
    measure(spec, ctx) {
      // compare compares single rows; next to a sum or a mean that is a change against one row, which means nothing
      const how = typeof spec.aggregate === 'string' ? spec.aggregate : 'last';
      if ((spec.compare === 'previous' || spec.compare === 'first') && how !== 'last' && typeof spec.against !== 'string') {
        throw new Error(
          `guide.kpi: compare "${spec.compare}" compares one row with another, so it needs aggregate "last" (not "${how}"); to compare a ${how} with something, give "against" a field`,
        );
      }
      if (typeof spec.rowField === 'string' && ['last', 'first', 'min', 'max'].indexOf(how) < 0)
        throw new Error(`guide.kpi: rowField names one row, and aggregate "${how}" comes from many; use last, first, min or max`);
      return { top: lay(spec, ctx).height };
    },
    render(spec, ctx, offset) {
      if (typeof spec.field !== 'string' || !column(ctx, spec.field)) return {};
      const t = lay(spec, ctx);
      const left = ctx.plot.x;
      let y = ctx.plot.y - offset.top - t.height;
      const out: BC.Prim[] = [];
      const line = (text: string, x: number, size: number, weight: number, fill: string, cls: string) =>
        out.push({ type: 'text', x, y, text, size, weight, baseline: 'hanging', style: { fill }, cls });
      if (t.label) line(t.label, left, t.labelSize, 500, LABEL, 'bc-kpi-label');
      if (t.labelled) y += LABEL_SIZE + GAP;
      line(t.value, left, t.valueSize, 650, VALUE, 'bc-kpi-value');
      y += t.valueSize + GAP;
      let noteAt = left;
      if (t.change) {
        line(t.change, left, t.lineSize, 600, t.changeColor, 'bc-kpi-delta');
        noteAt = left + ctx.textWidth(t.change, t.lineSize, 600) + NOTE_GAP;
      }
      if (t.note) line(t.note, noteAt, t.lineSize, 400, LABEL, 'bc-kpi-note');
      // the chart is an image to a screen reader, its text unread: the figure goes into its name
      for (const words of t.spoken) ctx.say(words);
      return { axes: out };
    },
  };

  BC.define(def);
})((globalThis as any).BC);
