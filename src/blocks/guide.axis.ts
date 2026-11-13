(function (BC: BC.Runtime) {
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
  /** How far a line of text set on its middle reaches above it, in em: its box in the system sans-serif of Windows
   *  (Segoe UI) is 0.84 above and 0.52 below, more than the half of measure()'s height (0.6) above. */
  const ABOVE_MIDDLE = 0.85;
  const SEQUENCE = /^\s*-?\d[\d.,:\/-]*(T[\d:.]+Z?)?\s*$/;

  /** Text categories name things, so reading only some of them is no use: when they do not fit, they all go at an angle.
   *  Dates and numbers run in order, so every few of them say enough, and sixty months are never slanted. */
  /** Where the plot will run across the chart once the vertical axes (and other guides at the sides) have taken their
   *  room out of it: while guides are measured, the plot is not final yet. */
  function plotAlong(spec: BC.GuideSpec, ctx: BC.ChartCtx): { x: number; w: number } {
    let left = 0;
    let right = 0;
    for (const g of ctx.spec.guides || []) {
      if (g === spec) continue;
      if (g.type === 'axis') {
        const other = g.scale ? sideOf(g, ctx) : 'top';
        const m = other === 'left' || other === 'right' ? (def.measure as NonNullable<BC.GuideDef['measure']>)(g, ctx)[other] || 0 : 0;
        if (other === 'left') left += m;
        else if (other === 'right') right += m;
      } else {
        const block = BC.get(`guide.${g.type}` as BC.BlockName) as BC.GuideDef | undefined;
        const m = block && block.measure ? block.measure(g, ctx) : {};
        left += m.left || 0;
        right += m.right || 0;
      }
    }
    return { x: ctx.plot.x + left, w: ctx.plot.w - left - right };
  }

  function slantOf(spec: BC.GuideSpec, ctx: BC.ChartCtx, side: Side): number {
    const scale = spec.scale ? ctx.scales[spec.scale as string] : undefined;
    if (
      !scale ||
      scale.input !== 'category' ||
      side === 'left' ||
      side === 'right' ||
      ctx.orientation(spec.scale as string) !== 'horizontal'
    )
      return 0;
    const cats = scale.domain() as unknown[];
    const length = plotAlong(spec, ctx).w;
    if (cats.length < 2 || length / cats.length < MIN_SLANT_STEP) return 0;
    if (cats.every((c) => typeof c === 'number' || c instanceof Date || SEQUENCE.test(String(c)))) return 0;
    if (fits(spec, ctx, length) >= cats.length) return 0;
    return length / cats.length < MIN_TILT_STEP ? 90 : 45;
  }

  // Chinese and Japanese break between characters, but not anywhere: a line starts after a wide character, never with a
  // mark that closes (、。」ー and small kana) nor ends with one that opens (「); a number keeps the word before it that it
  // belongs to (第1四半期, the 1st quarter) unless a number stands before that word too (年 in 2024年1月 ends the year)
  const NO_START = /[、。，．・：；？！）」』】〕》〉ーゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;
  const NO_END = /[（「『【〔《〈]/;
  const DIGIT = /\d/;
  function breaksOf(chars: string[], ctx: BC.ChartCtx): number[] {
    const out: number[] = [];
    for (let k = 1; k < chars.length; k++) {
      const before = chars[k - 1];
      const next = chars[k];
      if (!ctx.wide(before) || NO_START.test(next) || NO_END.test(before)) continue;
      if (DIGIT.test(next) && !(k >= 2 && DIGIT.test(chars[k - 2]))) continue;
      out.push(k);
    }
    return out;
  }

  /** A label without spaces in Chinese or Japanese on two lines: of the places it may break, the one whose first line
   *  fits `room` and whose lines are the most even (2024年 / 1月, not 2024 / 年1月). One line when it may not break. */
  function splitWide(label: string, room: number, ctx: BC.ChartCtx): string[] {
    const chars = Array.from(label);
    const width = (from: number, to: number) => ctx.measure(chars.slice(from, to).join(''), FONT).w;
    let best = -1;
    let widest = Infinity;
    for (const k of breaksOf(chars, ctx)) {
      const first = width(0, k);
      if (first > room) break;
      const m = Math.max(first, width(k, chars.length));
      if (m < widest) {
        widest = m;
        best = k;
      }
    }
    if (best < 0) {
      // not even the shortest first line fits: break there anyway, and let the labels go at an angle if it is too long
      const at = breaksOf(chars, ctx);
      if (!at.length) return [label];
      best = at[0];
    }
    return [chars.slice(0, best).join(''), chars.slice(best).join('')];
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
      // text without spaces in Chinese or Japanese breaks where it may: its two lines are what has to fit
      const parts = text.split(/\s+/).filter(Boolean);
      const word =
        parts.length === 1 && ctx.wide(text)
          ? Math.max(...splitWide(text, Infinity, ctx).map((line) => ctx.measure(line, FONT).w))
          : parts.reduce((m, part) => Math.max(m, ctx.measure(part, FONT).w), 0);
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
    if (ctx.scales[spec.scale as string].input === 'category' || ctx.orientation(spec.scale as string) !== 'horizontal') return ticks;
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
    if (scale.input !== 'category') return wish === undefined ? ctx.ticks(name) : ctx.ticks(name, wish);
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
    if (scale.output !== 'position') return ticks;
    const { input } = scale;
    // a band's categories are written as the format says what it is (a date preset, Intl date options or a number); a
    // category that is not such a value (plain text) stays as it is
    const write = BC.formatter(
      spec.format as BC.FormatSpec | string,
      input === 'date' ? 'date' : input === 'category' ? undefined : 'number',
    );
    return ticks.map((t) => ({ value: t.value, pos: t.pos, label: write(t.value) }));
  }

  const written = (spec: BC.GuideSpec, ctx: BC.ChartCtx): BC.Tick[] =>
    slanted.has(spec) ? labelled(spec, ctx).map((t) => ({ ...t, label: shorten(t.label) })) : labelled(spec, ctx);

  const title = (spec: BC.GuideSpec): string => (typeof spec.title === 'string' ? spec.title : '');
  const LINE = FONT * 1.25;

  /** The most of the chart's width the labels of a vertical axis may take: long names of categories (a ranking of
   *  products) would leave the plot a sliver on a phone. */
  const VERTICAL_SHARE = 0.3;

  /** The text cut to at most `room` wide, ending in an ellipsis when it had to be cut; whole characters only. */
  function cut(text: string, room: number, ctx: BC.ChartCtx): string {
    if (ctx.measure(text, FONT).w <= room) return text;
    const chars = Array.from(text);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measure(chars.slice(0, mid).join('') + '\u2026', FONT).w <= room) lo = mid;
      else hi = mid - 1;
    }
    return chars.slice(0, lo).join('').trimEnd() + '\u2026';
  }

  /** The first line of a label broken to `room`: as many words as fit (characters, in a script without spaces); the rest
   *  goes on. Null when not even the first word fits. */
  function firstLine(label: string, room: number, ctx: BC.ChartCtx): [string, string] | null {
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      if (!ctx.wide(label)) return null;
      const chars = Array.from(label);
      let k = 0;
      while (k < chars.length - 1 && ctx.measure(chars.slice(0, k + 1).join(''), FONT).w <= room) k++;
      return k ? [chars.slice(0, k).join(''), chars.slice(k).join('')] : null;
    }
    if (ctx.measure(words[0], FONT).w > room) return null;
    let first = words[0];
    let k = 1;
    while (k < words.length - 1 && ctx.measure(first + ' ' + words[k], FONT).w <= room) first += ' ' + words[k++];
    return [first, words.slice(k).join(' ')];
  }

  /** Labels of a vertical axis are kept to a share of the chart's width: one too long breaks onto a second line when its
   *  band has room for two, and what still does not fit is cut with an ellipsis. */
  function stacker(spec: BC.GuideSpec, ctx: BC.ChartCtx): (label: string) => string[] {
    const scale = ctx.scales[spec.scale as string];
    const n = scale.input === 'category' ? scale.domain().length : 0;
    const room = Math.max(4 * FONT, ctx.size.w * VERTICAL_SHARE);
    const two = n > 0 && ctx.plot.h / n >= 2 * LINE + 2;
    return (label) => {
      if (ctx.measure(label, FONT).w <= room) return [label];
      const lines = two ? firstLine(label, room, ctx) : null;
      return lines ? [lines[0], cut(lines[1], room, ctx)] : [cut(label, room, ctx)];
    };
  }

  /** Category labels on a horizontal axis that are wider than their band break at spaces onto a second line (a third
   *  line never: the rest stays on the second). Labels of a vertical axis are kept to their room (see stacker). Other
   *  labels are one line. */
  function wrapper(spec: BC.GuideSpec, ctx: BC.ChartCtx, side: Side): (label: string) => string[] {
    if (spec.scale && (side === 'left' || side === 'right')) return stacker(spec, ctx);
    const scale = spec.scale ? ctx.scales[spec.scale as string] : undefined;
    const n = scale && scale.input === 'category' ? scale.domain().length : 0;
    if (!n) return (label) => [label];
    const room = ctx.plot.w / n - 6;
    return (label) => wrapTo(label, room, ctx);
  }

  /** A label wider than `room` broken at a space onto a second line (or where Chinese and Japanese may break); one line
   *  when it has no such place. */
  function wrapTo(label: string, room: number, ctx: BC.ChartCtx): string[] {
    if (ctx.measure(label, FONT).w <= room) return [label];
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length < 2) return ctx.wide(label) ? splitWide(label, room, ctx) : [label];
    let first = words[0];
    let k = 1;
    while (k < words.length - 1 && ctx.measure(first + ' ' + words[k], FONT).w <= room) first += ' ' + words[k++];
    return [first, words.slice(k).join(' ')];
  }

  // ── Spans: an axis that names stretches of the data (the columns of a Marimekko) rather than the ticks of its scale ──

  /** A stretch of the axis with its name, in px: `mid` is where the name belongs. */
  type Span = { label: string; lo: number; hi: number; mid: number };
  /** A name as it is written: its lines, how wide the widest is, and the middle it is set on (`x`), which may be off the
   *  middle of its span to keep clear of the names beside it. */
  /** A span's name as laid out: its lines, how wide they are drawn (w: what names are spaced by), the room they keep from
   *  the edges of the chart and the plot (room: measure's, so no ink is cut off there in any font), and its middle (x). */
  type Named = Span & { lines: string[]; w: number; room: number; x: number };

  /** Axes that name spans, and the angle their names were measured at (0: upright, in their lines). */
  const spanned = new WeakMap<BC.GuideSpec, number>();

  /** The fields that name spans, or null for an axis of ticks. */
  function spanFields(spec: BC.GuideSpec, ctx: BC.ChartCtx): { text: string; from: string; to: string } | null {
    const { text, from, to } = spec as { text?: unknown; from?: unknown; to?: unknown };
    if (text === undefined && from === undefined && to === undefined) return null;
    if (typeof text !== 'string' || typeof from !== 'string' || typeof to !== 'string')
      throw new Error('an axis that names spans needs all three of "text", "from" and "to"');
    const side = sideOf(spec, ctx);
    if (side === 'left' || side === 'right') throw new Error('"text", "from" and "to" name spans along a horizontal axis (top or bottom)');
    return { text, from, to };
  }

  /** The named spans of the data, left to right, where `along` says the plot runs (the plot itself when drawing). A row
   *  without a name or a span, or whose middle is out of the plot (zoomed), names nothing; the same name over the same
   *  span (each cell of a column carries its column's span) is one. */
  function spansOf(spec: BC.GuideSpec, ctx: BC.ChartCtx, along: { x: number; w: number }): Span[] {
    const f = spanFields(spec, ctx) as NonNullable<ReturnType<typeof spanFields>>;
    const cols = ctx.table.columns;
    const texts = cols[f.text];
    const froms = cols[f.from];
    const tos = cols[f.to];
    const scale = ctx.scales[spec.scale as string];
    if (!texts || !froms || !tos || !scale) return [];
    const write = spec.format !== undefined ? BC.formatter(spec.format as BC.FormatSpec | string) : null;
    const p = ctx.plot;
    const at = (v: number) => along.x + ((v - p.x) * along.w) / p.w;
    const out: Span[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < ctx.table.length; i++) {
      const t = texts[i];
      if (t === null || t === undefined || t === '') continue;
      const label = write ? write(t) : String(t);
      const a = scale(froms[i]) as number;
      const b = scale(tos[i]) as number;
      if (!label || typeof a !== 'number' || typeof b !== 'number' || !isFinite(a) || !isFinite(b)) continue;
      const mid = (a + b) / 2;
      if (mid < p.x - 0.5 || mid > p.x + p.w + 0.5) continue;
      const key = `${a},${b}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lo = at(Math.min(a, b));
      const hi = at(Math.max(a, b));
      out.push({ label, lo, hi, mid: (lo + hi) / 2 });
    }
    return out.sort((s, t) => s.mid - t.mid);
  }

  /** The names written upright over their spans: a name wider than its span breaks onto a second line at a space, and
   *  names move apart as little as they can (pool adjacent violators: the least squares off their middles) until there is
   *  LABEL_GAP between any two, and they keep within `lo`..`hi`. `ok` is false when that cannot be done with every name
   *  still over the middle of its span: then they go at an angle. */
  function spread(spans: Span[], ctx: BC.ChartCtx, lo: number, hi: number): { named: Named[]; ok: boolean } {
    const named: Named[] = spans.map((s) => {
      const lines = wrapTo(s.label, s.hi - s.lo - LABEL_GAP, ctx);
      const w = lines.reduce((m, line) => Math.max(m, ctx.textWidth(line, FONT)), 0);
      const room = lines.reduce((m, line) => Math.max(m, ctx.measure(line, FONT).w), w);
      return { ...s, lines, w, room, x: s.mid };
    });
    const n = named.length;
    if (!n) return { named, ok: true };
    // offsets of each name from the first when packed tight; the names then share one free position per block
    const off: number[] = [0];
    for (let i = 1; i < n; i++) off.push(off[i - 1] + (named[i - 1].w + named[i].w) / 2 + LABEL_GAP);
    const blocks: { first: number; last: number; sum: number }[] = [];
    for (let i = 0; i < n; i++) {
      let b = { first: i, last: i, sum: named[i].mid - off[i] };
      while (blocks.length) {
        const prev = blocks[blocks.length - 1];
        if (prev.sum / (prev.last - prev.first + 1) < b.sum / (b.last - b.first + 1)) break;
        blocks.pop();
        b = { first: prev.first, last: b.last, sum: prev.sum + b.sum };
      }
      blocks.push(b);
    }
    for (const b of blocks) for (let i = b.first; i <= b.last; i++) named[i].x = b.sum / (b.last - b.first + 1) + off[i];
    // into the chart, by the room a name keeps from its edges: back from its right edge, then on from its left
    const sep = (i: number) => off[i] - off[i - 1];
    named[n - 1].x = Math.min(named[n - 1].x, hi - named[n - 1].room / 2);
    for (let i = n - 2; i >= 0; i--) named[i].x = Math.min(named[i].x, named[i + 1].x - sep(i + 1));
    named[0].x = Math.max(named[0].x, lo + named[0].room / 2);
    for (let i = 1; i < n; i++) named[i].x = Math.max(named[i].x, named[i - 1].x + sep(i));
    const ok = named[n - 1].x + named[n - 1].room / 2 <= hi + 0.5 && named.every((s) => Math.abs(s.x - s.mid) <= s.w / 2);
    return { named, ok };
  }

  /** A span narrower than this is no column a reader can see, and gets no name. */
  const MIN_SPAN = 2;

  /** The names of the spans as they are measured (`along` estimated) or drawn (the plot as it is). Upright when they fit;
   *  when they do not, without the names of the narrowest spans, as few as it takes, or at 45° (names at least
   *  MIN_TILT_STEP apart: of two closer ones, that of the wider span) when that leaves out fewer. Unlike a band, whose
   *  categories are all as wide, a narrow span is the least of the whole, and its name is still in the tooltip.
   *  Drawing keeps to the angle that was measured. */
  function spanLayout(spec: BC.GuideSpec, ctx: BC.ChartCtx, measuring: boolean): { angle: number; named: Named[] } {
    const along = measuring ? plotAlong(spec, ctx) : { x: ctx.plot.x, w: ctx.plot.w };
    const spans = spansOf(spec, ctx, along).filter((s) => s.hi - s.lo >= MIN_SPAN);
    const decided = measuring ? undefined : spanned.get(spec);
    const tilted: Span[] = [];
    for (const s of spans) {
      const last = tilted[tilted.length - 1];
      if (last && s.mid - last.mid < MIN_TILT_STEP) {
        if (s.hi - s.lo > last.hi - last.lo) tilted[tilted.length - 1] = s;
        continue;
      }
      tilted.push(s);
    }
    if (!decided) {
      const fit = (list: Span[]) => spread(list, ctx, 0, ctx.size.w);
      let upright = fit(spans);
      if (!upright.ok) {
        // the fewest of the narrowest names to leave out (more left out never makes the rest fit worse): a binary search
        const narrowest = spans.map((_, i) => i).sort((a, b) => spans[a].hi - spans[a].lo - (spans[b].hi - spans[b].lo));
        const without = (k: number) => {
          const out = new Set(narrowest.slice(0, k));
          return spans.filter((_, i) => !out.has(i));
        };
        let lo = 1;
        let hi = spans.length;
        while (lo < hi) {
          const k = (lo + hi) >> 1;
          if (fit(without(k)).ok) hi = k;
          else lo = k + 1;
        }
        upright = fit(without(lo));
      }
      // drawn the way it was measured: a plot a few px narrower than estimated still draws them upright
      if (decided === 0 || upright.named.length >= tilted.length) return { angle: 0, named: upright.named };
    }
    return { angle: 45, named: tilted.map((s) => ({ ...s, label: shorten(s.label), lines: [shorten(s.label)], w: 0, room: 0, x: s.mid })) };
  }

  /** The room labels at an angle take below or above the plot, and how far past its ends the first and last reach. */
  function slantRoom(
    spec: BC.GuideSpec,
    ctx: BC.ChartCtx,
    side: Side,
    angle: number,
    ticks: { pos: number; label: string }[],
  ): BC.GuideMeasure {
    const lean = angle === 90 ? 0 : SLANT;
    const height = angle === 90 ? 1 : SLANT;
    let across = 0;
    let left = 0;
    let right = 0;
    for (const t of ticks) {
      // the length of a slanted label is what shows as an empty band under it when overestimated: measure() is generous
      // by a quarter on Latin text, and a label that ran a little longer has the chart's padding below it
      const length = ctx.textWidth(t.label, FONT);
      // and the corner of its line, which stands most of a font size above the middle it is set on: turned, that is
      // the corner farthest out, as the one below is farthest down (FONT * SLANT under the plot)
      const reachAlong = (length + FONT) * lean;
      across = Math.max(across, length * height);
      // a label ends at its tick and runs away from it, to the left of the tick below the axis and to the right above it
      if (side === 'bottom') left = Math.max(left, ctx.plot.x - (t.pos - reachAlong));
      else right = Math.max(right, t.pos + reachAlong - (ctx.plot.x + ctx.plot.w));
    }
    const out: BC.GuideMeasure = { overhang: { top: 0, right, bottom: 0, left } };
    out[side] = reach(spec) + across + FONT * SLANT + PAD + (title(spec) ? TITLE_ROOM : 0);
    return out;
  }

  const def: BC.GuideDef = {
    role: 'guide',
    type: 'axis',
    version: 20,
    doc: 'Labels for a positional scale, with an axis line and optional tick marks. Side defaults from the scale orientation; set `position` for a second axis. `format` writes the tick labels (currency, percent, dates), `title` names the axis. The quiet default: no tick marks, a line only along a horizontal axis; pair a value axis with guide.grid. Category labels too wide for their band wrap onto two lines; text categories that still do not fit (a narrow screen) all go at an angle, rather than some of them being left out, while dates and numbers show every few. On a vertical axis the labels take at most 30% of the width of the chart: a longer one breaks onto two lines when its band has room, and the rest is cut with an ellipsis and shown whole on hover. With `text`, `from` and `to` a horizontal axis names stretches of the data instead of writing its ticks: the columns of a Marimekko, which are as wide as their shares.',
    params: {
      scale: { kind: 'scale', required: true },
      position: { kind: 'enum', values: ['top', 'right', 'bottom', 'left'] },
      title: { kind: 'string', doc: 'Text that names the axis (with its unit, for example "Revenue, USD"). Rotated on a vertical axis.' },
      format: {
        kind: 'format',
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
      text: {
        kind: 'field',
        doc: 'Name spans of the data instead of writing the ticks: each row with a value in this field has it written over the middle of its span, from `from` to `to` (values on the scale of this axis), once however many rows share the name and the span. A Marimekko names its columns with `"text": "label", "from": "x0", "to": "x1"`. A name wider than its span breaks onto a second line at a space, and moves a little off the middle (it still stands over the middle of its span) to keep clear of the names beside it; when that is not enough, they all go at an angle. `format` writes the names. A horizontal axis only.',
      },
      from: { kind: 'field', doc: 'With `text`: where each span starts.' },
      to: { kind: 'field', doc: 'With `text`: where each span ends.' },
    },
    fits,
    measure(spec, ctx) {
      if (!spec.scale) return {};
      const side = sideOf(spec, ctx);
      const vertical = side === 'left' || side === 'right';
      if (spanFields(spec, ctx)) {
        const { angle, named } = spanLayout(spec, ctx, true);
        spanned.set(spec, angle);
        if (angle)
          return slantRoom(
            spec,
            ctx,
            side,
            angle,
            named.map((s) => ({ pos: s.x, label: s.label })),
          );
        const along = plotAlong(spec, ctx);
        let label = 0;
        let left = 0;
        let right = 0;
        for (const s of named) {
          label = Math.max(label, s.lines.length > 1 ? s.lines.length * LINE : ctx.measure(s.label, FONT).h);
          left = Math.max(left, along.x - (s.x - s.room / 2));
          right = Math.max(right, s.x + s.room / 2 - (along.x + along.w));
        }
        // how far a name reaches past the plot as it will be: the margin the chart needs on that side
        const out: BC.GuideMeasure = { overhang: { top: 0, right, bottom: 0, left } };
        out[side] = reach(spec) + label + PAD + (title(spec) ? TITLE_ROOM : 0);
        return out;
      }
      const angle = slantOf(spec, ctx, side);
      if (angle) slanted.set(spec, angle);
      else slanted.delete(spec);
      if (angle) return slantRoom(spec, ctx, side, angle, written(spec, ctx));
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
          // the first line is written above the tick by half the others
          const first = t.pos - ((lines.length - 1) / 2) * LINE;
          over.top = Math.max(over.top!, p.y - (t.pos - m.h / 2), p.y - (first - ABOVE_MIDDLE * FONT));
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
      const spans = spanFields(spec, ctx);
      const ticks = spans ? [] : written(spec, ctx);
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
        const wrap = wrapper(spec, ctx, side);
        for (const t of ticks) {
          if (marks) d += `M${x0} ${t.pos}H${x0 + dir * TICK}`;
          const lines = wrap(t.label);
          const whole = lines.length === 1 && lines[0] === t.label ? undefined : t.label;
          lines.forEach((line, k) => {
            labelSpace = Math.max(labelSpace, ctx.measure(line, FONT).w);
            texts.push({
              type: 'text',
              x: x0 + dir * r,
              y: t.pos + (k - (lines.length - 1) / 2) * LINE,
              text: line,
              size: FONT,
              anchor: dir < 0 ? 'end' : 'start',
              baseline: 'middle',
              style: { fill: LABEL },
              cls: 'bc-axis-label',
              title: whole,
            });
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
        const atAngle = (pos: number, label: string, angle: number) => {
          labelSpace = Math.max(labelSpace, ctx.textWidth(label, FONT) * (angle === 90 ? 1 : SLANT) + FONT * SLANT);
          texts.push({
            type: 'text',
            x: pos,
            y: y0 + dir * r,
            text: label,
            size: FONT,
            anchor: dir < 0 ? 'start' : 'end',
            baseline: 'middle',
            rotate: -angle,
            style: { fill: LABEL },
            cls: 'bc-axis-label',
          });
        };
        const inLines = (pos: number, label: string, lines: string[]) => {
          labelSpace = Math.max(labelSpace, lines.length > 1 ? lines.length * LINE : ctx.measure(label, FONT).h);
          // lines stack away from the axis: downwards below it, upwards above it
          const order = dir < 0 ? lines.slice().reverse() : lines;
          order.forEach((line, k) => {
            texts.push({
              type: 'text',
              x: pos,
              y: y0 + dir * (r + k * LINE),
              text: line,
              size: FONT,
              anchor: 'middle',
              baseline: dir < 0 ? 'auto' : 'hanging',
              style: { fill: LABEL },
              cls: 'bc-axis-label',
            });
          });
        };
        if (spans) {
          const { angle, named } = spanLayout(spec, ctx, false);
          for (const s of named) {
            if (marks) d += `M${s.mid} ${y0}V${y0 + dir * TICK}`;
            if (angle) atAngle(s.mid, s.label, angle);
            else inLines(s.x, s.label, s.lines);
          }
        } else {
          const wrap = wrapper(spec, ctx, side);
          for (const t of ticks) {
            if (marks) d += `M${t.pos} ${y0}V${y0 + dir * TICK}`;
            if (slanted.has(spec)) atAngle(t.pos, t.label, slanted.get(spec) as number);
            else inLines(t.pos, t.label, wrap(t.label));
          }
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
})((globalThis as any).BC);
