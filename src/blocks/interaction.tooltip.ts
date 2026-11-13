(function (BC: BC.Runtime) {
  const OFFSET = 12;
  /** The narrowest a card is made, however little of the chart is seen. */
  const MIN_CARD = 120;
  /** How far past the plot the pointer still looks for a datum: the radius of a dot, and the slack its pick allows. */
  const EDGE = 12;
  const MAX_TEXT = 80;

  /** A value a row does not have: it gets no line on the card. */
  const missing = (v: unknown) => v == null || v === '' || (typeof v === 'number' && isNaN(v));
  /** A field name as code writes it (avg7, quarterTotal, value_1), which a reader should not have to decode. */
  const CODE_NAME = /\d|[a-z][A-Z]|_/;

  function format(v: unknown): string {
    if (v == null) return '–';
    if (typeof v === 'number') return isNaN(v) ? '–' : Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
    const s = String(v);
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '…' : s;
  }

  type Pointer = {
    toLogical(live: BC.LiveCtx, ev: MouseEvent): { x: number; y: number };
    inPlot(live: BC.LiveCtx, p: { x: number; y: number }, margin?: number): boolean;
  };
  /** From lib.pointer, listed in `requires` so it is on the page. */
  const pointer = () => (BC.get('lib.pointer') as BC.LibDef).exports as Pointer;

  type Follow = (live: BC.LiveCtx, show: (ev: PointerEvent) => void, hide: () => void, keepOnPress?: boolean) => void;
  /** From lib.pointer, listed in `requires` so it is on the page. */
  const follow: Follow = (live, show, hide, keepOnPress) =>
    ((BC.get('lib.pointer') as BC.LibDef).exports.follow as Follow)(live, show, hide, keepOnPress);

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'tooltip',
    version: 23,
    requires: ['lib.pointer'],
    doc: "Shows the datum under the pointer: a marker plus a card with the fields behind it — the category or date as its heading, then one line per value. Every mark finds its own datum (MarkDef.pick); the closest one wins. The default content is written with textContent only; `content` replaces it with what a function returns. On a touch screen a tap shows the card and sliding the finger moves it along the data; it stays after the finger lifts, until the reader touches somewhere else. For a vertical line that follows the pointer, add interaction.crosshair. A value the row does not have (null, NaN) has no line. A field is shown under its name in `labels`, else under the name the transform that made it gives it (quartiles: Q1, Median…), else under its own; the composer warns about a name written like code (avg7, quarterTotal). A bar from x to x2 (or y to y2) on one number or time scale with no category to name it, a histogram's bin, is headed by its range (140–145). A shape that stands for several rows (a line through a total repeated on each row of its quarter) shows only the fields they share. The dot by the heading has the color of the first value on the card: the color of the shape under the pointer, or, when `fields` puts first a value only another mark draws, of that mark (the card of a bullet chart has its bar's color over the bands behind it).",
    params: {
      fields: { kind: 'fields', doc: 'Fields to show. Default: the fields the mark reads (its channels and group).' },
      formats: {
        kind: 'formats',
        doc: 'How to write values, per field: { "revenue": { "style": "currency", "currency": "USD" }, "share": "percent", "date": "date" }. Each is a preset or an object of Intl options (see guide.axis `format`). Fields without one are written as they are (numbers to 6 significant digits).',
      },
      labels: {
        kind: 'any',
        doc: 'What to call the fields, per field: { "median": "Median, ms", "rev": "Revenue" }. Fields without one are shown under the name their transform gives them (Q1, Count…) or their own.',
      },
      content: {
        kind: 'any',
        doc: 'Name of a function registered with BC.defineFn (or, in a spec built in JS, the function itself). It gets a TooltipDatum and returns what to show: a string (text), { html }, a DOM Node, an array of those, null/false to hide the tooltip, or undefined for the default content. { html } is set with innerHTML and is not escaped — build it from trusted strings, never straight from a row value the data may contain.',
      },
      heading: {
        kind: 'field',
        doc: 'The field at the head of the card. Default: the category or date the datum stands on. Give it when that is not what names the datum, as in a calendar, where x is the week and the row is a day.',
      },
      marker: {
        kind: 'enum',
        values: ['auto', 'dot', 'box', 'none'],
        default: 'auto',
        doc: '"dot" draws a small circle at the point; "box" highlights the whole shape (used automatically for rect marks like bar/heatmap, where a dot would land on an edge); "auto" picks box when the mark reports its bounds and dot otherwise; "none" shows the tooltip text without a marker.',
      },
    },
    attach(spec, live) {
      const host = live.host;
      const root = live.root as HTMLElement;
      const doc = host.ownerDocument || document;
      // per-field formats; one that cannot work is reported once and dropped, so the tooltip still shows the value
      const formats: Record<string, (v: unknown) => string> = {};
      if (spec.formats && typeof spec.formats === 'object' && !Array.isArray(spec.formats)) {
        const given = spec.formats as Record<string, BC.FormatSpec | string>;
        for (const field of Object.keys(given)) {
          try {
            formats[field] = live.format(given[field]);
          } catch (e) {
            console.warn(`[blockcharts] interaction.tooltip: format of "${field}" ignored: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else if (spec.formats !== undefined) {
        console.warn('[blockcharts] interaction.tooltip: "formats" must be an object of field name to format; ignored');
      }
      const writeDate = live.format('date');
      // the names the transforms give the columns they make come first; the tooltip's own labels win
      const labels: Record<string, string> = {};
      for (const t of Array.isArray(live.spec.transforms) ? live.spec.transforms : []) {
        const made = t && (BC.get(`transform.${t.type}` as BC.BlockName) as BC.TransformDef | undefined);
        if (!made || typeof made.labels !== 'function') continue;
        try {
          Object.assign(labels, made.labels(t));
        } catch (e) {
          // a transform whose spec is wrong has said so already
        }
      }
      if (spec.labels && typeof spec.labels === 'object' && !Array.isArray(spec.labels)) {
        const given = spec.labels as Record<string, unknown>;
        for (const field of Object.keys(given)) {
          if (!live.table.columns[field]) console.warn(`[blockcharts] interaction.tooltip: label of "${field}" ignored: no such field`);
          else if (typeof given[field] !== 'string')
            console.warn(`[blockcharts] interaction.tooltip: label of "${field}" must be text; ignored`);
          else labels[field] = given[field] as string;
        }
      } else if (spec.labels !== undefined) {
        console.warn('[blockcharts] interaction.tooltip: "labels" must be an object of field name to text; ignored');
      }
      const only = Array.isArray(spec.fields) ? (spec.fields as unknown[]).filter((f): f is string => typeof f === 'string') : null;

      // The tip is positioned against the host, so the host has to be a positioning context.
      const releasePosition = live.claimPosition();

      const tip = doc.createElement('div');
      tip.setAttribute('class', 'bc-tooltip');
      tip.setAttribute('role', 'tooltip');
      // a card: the page's own font, figures that line up, a soft shadow; every color is a variable a theme can set
      Object.assign(tip.style, {
        position: 'absolute',
        display: 'none',
        pointerEvents: 'none',
        zIndex: '10',
        boxSizing: 'border-box',
        // long text wraps (a URL anywhere) once the card is as wide as the reader can see; short text keeps to a line
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        fontSize: '12px',
        lineHeight: '1.45',
        fontVariantNumeric: 'tabular-nums',
        padding: '8px 11px',
        borderRadius: '10px',
        background: 'var(--bc-tooltip-bg, #fff)',
        color: 'var(--bc-text, #333)',
        border: '1px solid var(--bc-tooltip-border, rgba(127,127,127,.22))',
        boxShadow: 'var(--bc-tooltip-shadow, 0 10px 28px rgba(15,23,42,.14), 0 2px 6px rgba(15,23,42,.08))',
      });
      const dot = doc.createElement('div');
      dot.setAttribute('class', 'bc-tooltip-dot');
      Object.assign(dot.style, {
        position: 'absolute',
        display: 'none',
        pointerEvents: 'none',
        width: '12px',
        height: '12px',
        marginLeft: '-6px',
        marginTop: '-6px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: '2.5px solid var(--bc-tooltip-bg, #fff)',
        background: 'var(--bc-text, #333)',
        boxShadow: '0 1px 4px rgba(15,23,42,.3)',
      });
      const highlight = doc.createElement('div');
      highlight.setAttribute('class', 'bc-tooltip-highlight');
      Object.assign(highlight.style, {
        position: 'absolute',
        display: 'none',
        pointerEvents: 'none',
        boxSizing: 'border-box',
        borderRadius: '3px',
        background: 'var(--bc-tooltip-highlight-fill, rgba(127,127,127,.14))',
        outline: '1.5px solid var(--bc-tooltip-highlight-line, rgba(127,127,127,.45))',
        outlineOffset: '-1.5px',
      });
      // the flows a hovered shape lights up: over the chart, so it works the same on SVG and canvas
      const flows = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
      flows.setAttribute('class', 'bc-tooltip-flows');
      Object.assign(flows.style, { position: 'absolute', display: 'none', pointerEvents: 'none' });
      host.appendChild(flows);
      host.appendChild(dot);
      host.appendChild(highlight);
      host.appendChild(tip);
      const markerMode = spec.marker === 'dot' || spec.marker === 'box' || spec.marker === 'none' ? spec.marker : 'auto';

      // The function is looked up at hover time, so it may be registered after the chart was built.
      let warnedMissing = false;
      let warnedThrow = false;
      const contentFn = (): ((d: BC.TooltipDatum) => BC.TooltipContent) | undefined => {
        const c = spec.content;
        if (typeof c === 'function') return c as (d: BC.TooltipDatum) => BC.TooltipContent;
        if (typeof c !== 'string') return undefined;
        const fn = BC.getFn(c);
        if (!fn && !warnedMissing) {
          warnedMissing = true;
          console.warn(`[blockcharts] interaction.tooltip: no function "${c}" is registered (BC.defineFn); showing the default content`);
        }
        return fn as ((d: BC.TooltipDatum) => BC.TooltipContent) | undefined;
      };
      const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && typeof (v as Node).nodeType === 'number';
      const insert = (c: BC.TooltipContent): void => {
        if (c == null || c === false) return;
        if (typeof c === 'string' || typeof c === 'number') {
          if (c === '') return;
          const line = doc.createElement('div');
          line.textContent = String(c);
          tip.appendChild(line);
        } else if (Array.isArray(c)) {
          c.forEach(insert);
        } else if (isNode(c)) {
          tip.appendChild(c);
        } else if (typeof (c as { html?: unknown }).html === 'string') {
          const box = doc.createElement('div');
          box.innerHTML = (c as { html: string }).html;
          tip.appendChild(box);
        }
      };

      const hide = () => {
        tip.style.display = 'none';
        dot.style.display = 'none';
        highlight.style.display = 'none';
        flows.style.display = 'none';
      };

      const write = (field: string, row: number): string => {
        const v = live.table.columns[field][row];
        return formats[field] ? formats[field](v) || '–' : format(v);
      };

      /** The field that names the datum — the category (band) or the date (time) its x (or y) is on — or null. Shown
       *  as the card's heading rather than as a line, also when `fields` lists what else to show. */
      function headingField(mark: BC.MarkSpec): string | null {
        if (typeof spec.heading === 'string' && live.table.columns[spec.heading]) return spec.heading;
        // a category names the datum before a date does: a Gantt bar is its task, from one date to another
        for (const input of ['category', 'date'])
          for (const ch of ['x', 'y']) {
            try {
              const c = live.channel(mark, ch);
              if (c.field && c.scale && c.scale.input === input && live.table.columns[c.field]) return c.field;
            } catch (e) {
              // not a channel of this mark
            }
          }
        return null;
      }

      /** A bar from x to x2 (or y to y2) on one number or time scale, both ends among the fields the card shows: a
       *  histogram's bin. Unless a category or date names the datum, the card is headed by the range and the two ends
       *  are not lines of it. */
      function rangeOf(mark: BC.MarkSpec, shown: string[]): { from: string; to: string; date: boolean } | null {
        for (const [a, b] of [
          ['x', 'x2'],
          ['y', 'y2'],
        ]) {
          try {
            const from = live.channel(mark, a);
            const to = live.channel(mark, b);
            if (!from.field || !to.field || from.field === to.field || !from.scale || from.scale !== to.scale) continue;
            if (from.scale.input === 'category' || !live.table.columns[from.field] || !live.table.columns[to.field]) continue;
            if (shown.indexOf(from.field) < 0 || shown.indexOf(to.field) < 0) continue;
            return { from: from.field, to: to.field, date: from.scale.input === 'date' };
          } catch (e) {
            // not a channel of this mark
          }
        }
        return null;
      }

      const markDef = (mark: BC.MarkSpec) => BC.get(`mark.${mark.type}` as BC.BlockName) as BC.MarkDef | undefined;

      /** The color `mark` draws `row` in, as the mark itself says (MarkDef.color); '' when it does not say. */
      function colorOf(mark: BC.MarkSpec, index: number, row: number): string {
        const def = markDef(mark);
        if (!def || typeof def.color !== 'function') return '';
        try {
          const c = def.color(mark, live, index, row);
          return typeof c === 'string' ? c : '';
        } catch (e) {
          return '';
        }
      }

      /** The fields a mark draws: those its channels read, and its group. */
      function drawn(mark: BC.MarkSpec, def: BC.MarkDef): string[] {
        const out: string[] = [];
        for (const ch of Object.keys(def.channels)) {
          try {
            const c = live.channel(mark, ch);
            if (c.field) out.push(c.field);
          } catch (e) {
            // a channel that cannot be resolved draws nothing
          }
        }
        if (typeof mark.group === 'string') out.push(mark.group);
        return out;
      }

      /** The color of the dot by the heading: that of the first value on the card. The mark under the pointer draws it,
       *  unless `fields` puts first a value only other marks draw: on the band behind a bullet chart's bar the card
       *  says the result, and the dot has the bar's color, not the band's grey. */
      function swatchOf(mark: BC.MarkSpec, def: BC.MarkDef, index: number, row: number, first: string | null): string {
        const own = colorOf(mark, index, row);
        if (first === null || drawn(mark, def).includes(first)) return own;
        const marks = live.spec.marks;
        // the mark drawn last is on top
        for (let i = marks.length - 1; i >= 0; i--) {
          const other = markDef(marks[i]);
          if (i === index || !other || !drawn(marks[i], other).includes(first)) continue;
          const c = colorOf(marks[i], i, row);
          if (c) return c;
        }
        return own;
      }

      /** The lines of a datum, and the field of each. A shape that stands for several rows (Pick.rows) shows only what
       *  they have in common: a line through a quarter's total says the total, not the product of whichever row of the
       *  quarter came first. */
      /** How a mark writes its values: as `formats` says, else a field one of its channels puts on a time scale as a
       *  date, not as the ISO string it was given as, else as it is. */
      function writer(mark: BC.MarkSpec, def: BC.MarkDef): (field: string, row: number) => string {
        const dates = new Set<string>();
        for (const ch of Object.keys(def.channels)) {
          try {
            const c = live.channel(mark, ch);
            if (c.field && c.scale && c.scale.input === 'date') dates.add(c.field);
          } catch (e) {
            // a channel that cannot be resolved draws nothing
          }
        }
        return (field, row) =>
          !formats[field] && dates.has(field) ? writeDate(live.table.columns[field][row]) || write(field, row) : write(field, row);
      }

      function lines(
        mark: BC.MarkSpec,
        def: BC.MarkDef,
        row: number,
        rows: number[],
        skip: string[],
      ): { lines: [string, string][]; fields: string[] } {
        const out: [string, string][] = [];
        const fields: string[] = [];
        const seen = new Set<string>(skip);
        const written = writer(mark, def);
        const add = (field: string) => {
          const col = live.table.columns[field];
          if (!col || seen.has(field)) return;
          seen.add(field);
          // a value the row does not have (the summary and outlier rows of transform.quartiles do not share their fields)
          if (missing(col[row])) return;
          const text = written(field, row);
          if (rows.some((r) => written(field, r) !== text)) return;
          out.push([labels[field] || field, text]);
          fields.push(field);
        };
        (only || drawn(mark, def)).forEach(add);
        return { lines: out, fields };
      }

      function show(ev: PointerEvent): void {
        const p = pointer().toLogical(live, ev);
        // a dot on the edge of the plot sticks out of it: the reader pointing at that half of it means it too
        if (!pointer().inPlot(live, p, EDGE)) return hide();

        let best: { pick: BC.Pick; mark: BC.MarkSpec; def: BC.MarkDef; index: number } | null = null;
        live.spec.marks.forEach((mark, i) => {
          const def = BC.get(`mark.${mark.type}` as BC.BlockName) as BC.MarkDef | undefined;
          if (!def || !def.pick) return;
          let pick: BC.Pick | null = null;
          try {
            pick = def.pick(mark, live, i, p.x, p.y);
          } catch (e) {
            return;
          }
          // later marks are drawn on top, so they win ties
          if (pick && isFinite(pick.dist) && (!best || pick.dist <= best.pick.dist)) best = { pick, mark, def, index: i };
        });
        if (!best) return hide();
        const { pick, mark, def, index } = best as { pick: BC.Pick; mark: BC.MarkSpec; def: BC.MarkDef; index: number };

        const card = pick.card;
        const same = pick.rows && pick.rows.length > 1 ? pick.rows : [pick.row];
        const named = card ? null : headingField(mark);
        // a range heads the card when nothing else names the datum, or when it would be headed by one of its ends (a bar
        // from one date to another); a heading given in `heading` is not replaced
        const given = typeof spec.heading === 'string' && !!live.table.columns[spec.heading];
        const range = card || given ? null : rangeOf(mark, only || drawn(mark, def));
        const spans = range && (!named || named === range.from || named === range.to) ? range : null;
        const writeEnd = card ? write : writer(mark, def);
        const ranged =
          spans &&
          same.every(
            (r) => writeEnd(spans.from, r) === writeEnd(spans.from, pick.row) && writeEnd(spans.to, r) === writeEnd(spans.to, pick.row),
          )
            ? spans
            : null;
        const heading = !spans && named && same.every((r) => write(named, r) === write(named, pick.row)) ? named : null;
        const listed = card
          ? { lines: card.lines, fields: [] as string[] }
          : lines(mark, def, pick.row, same, ranged ? [ranged.from, ranged.to] : []);
        const rows = listed.lines;
        const headingLabel = heading ? labels[heading] || heading : null;
        let custom: BC.TooltipContent;
        const fn = card ? undefined : contentFn();
        if (fn) {
          const values: Record<string, unknown> = {};
          for (const name of Object.keys(live.table.columns)) values[name] = live.table.columns[name][pick.row];
          try {
            custom = fn({
              row: pick.row,
              values,
              rows: same,
              lines: rows,
              mark,
              markIndex: index,
              x: pick.x,
              y: pick.y,
              table: live.table,
            });
          } catch (e) {
            if (!warnedThrow) {
              warnedThrow = true;
              console.error('[blockcharts] interaction.tooltip: the content function threw, showing the default content:', e);
            }
            custom = undefined;
          }
        }
        if (custom === null || custom === false) return hide();

        tip.textContent = '';
        // the marker stands on the shape under the pointer, in its color
        const color = colorOf(mark, index, pick.row);
        const first = listed.fields.find((_, k) => rows[k][0] !== headingLabel);
        const swatch = card ? card.color || '' : swatchOf(mark, def, index, pick.row, only && first !== undefined ? first : null);
        if (custom === undefined) {
          if (heading || card || ranged) {
            const head = doc.createElement('div');
            head.setAttribute('class', 'bc-tooltip-heading');
            if (heading) head.setAttribute('data-bc-field', heading);
            else if (ranged) head.setAttribute('data-bc-field', `${ranged.from} ${ranged.to}`);
            Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '7px', fontWeight: '600', marginBottom: '4px' });
            if (swatch) {
              const sw = doc.createElement('span');
              sw.setAttribute('class', 'bc-tooltip-swatch');
              // a ring keeps in sight a color as light or as dark as the card: a pale band, a dark cell on a dark card
              Object.assign(sw.style, {
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: swatch,
                boxShadow: 'inset 0 0 0 1px var(--bc-tooltip-highlight-line, rgba(127,127,127,.45))',
                flex: 'none',
              });
              head.appendChild(sw);
            }
            const t = doc.createElement('span');
            // a date heading without a format of its own is written as a date, not as the ISO string it was given as
            const col = live.table.columns[heading as string];
            const isTime = ((): boolean => {
              for (const ch of ['x', 'y']) {
                try {
                  const c = live.channel(mark, ch);
                  if (c.field === heading && c.scale && c.scale.input === 'date') return true;
                } catch (e) {
                  /* not a channel */
                }
              }
              return false;
            })();
            const field = heading as string;
            if (card) t.textContent = card.title;
            else if (ranged) {
              const ends = [writeEnd(ranged.from, pick.row), writeEnd(ranged.to, pick.row)];
              // 140–145, but Jan 5 – Jan 30
              t.textContent = ends.join(ends.some((e) => e.indexOf(' ') >= 0) ? ' – ' : '–');
            } else t.textContent = !formats[field] && isTime ? writeDate(col[pick.row]) || write(field, pick.row) : write(field, pick.row);
            head.appendChild(t);
            tip.appendChild(head);
          }
          const grid = doc.createElement('div');
          grid.setAttribute('class', 'bc-tooltip-lines');
          Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'auto auto', columnGap: '16px', rowGap: '1px' });
          for (const [label, value] of rows) {
            if (label === headingLabel) continue;
            const name = doc.createElement('span');
            name.textContent = label;
            name.style.opacity = '0.68';
            const val = doc.createElement('span');
            val.textContent = value;
            Object.assign(val.style, { textAlign: 'right', fontWeight: '600' });
            grid.appendChild(name);
            grid.appendChild(val);
          }
          if (grid.children.length) tip.appendChild(grid);
        } else {
          insert(custom);
        }
        // real DOM: childNodes also counts bare text nodes a custom content may consist of.
        // fake DOM (tests): childNodes does not exist, so children (elements only) is what is checked.
        const filled = tip.childNodes ? tip.childNodes.length > 0 : tip.children.length > 0;
        if (!filled) return hide();

        const rect = root.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        const k = rect.width / live.size.w;
        const ax = rect.left - hostBox.left + pick.x * k;
        const ay = rect.top - hostBox.top + pick.y * k;
        flows.textContent = '';
        for (const f of pick.flows || []) {
          const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', f.d);
          path.setAttribute('fill', f.fill);
          path.setAttribute('fill-opacity', '0.5');
          flows.appendChild(path);
        }
        if (pick.flows && pick.flows.length) {
          flows.setAttribute('viewBox', `0 0 ${live.size.w} ${live.size.h}`);
          Object.assign(flows.style, {
            left: rect.left - hostBox.left + 'px',
            top: rect.top - hostBox.top + 'px',
            width: rect.width + 'px',
            height: rect.height + 'px',
            display: 'block',
          });
        } else flows.style.display = 'none';
        const useBox = markerMode === 'box' || (markerMode === 'auto' && !!pick.box);
        if (useBox && pick.box) {
          Object.assign(highlight.style, {
            left: rect.left - hostBox.left + pick.box.x * k + 'px',
            top: rect.top - hostBox.top + pick.box.y * k + 'px',
            width: Math.max(0, pick.box.w * k) + 'px',
            height: Math.max(0, pick.box.h * k) + 'px',
            display: 'block',
          });
          dot.style.display = 'none';
        } else if (markerMode !== 'none') {
          dot.style.left = ax + 'px';
          dot.style.top = ay + 'px';
          dot.style.background = color || 'var(--bc-text, #333)';
          dot.style.display = 'block';
          highlight.style.display = 'none';
        } else {
          dot.style.display = 'none';
          highlight.style.display = 'none';
        }
        // a chart wider than its scrolling card reaches past the screen: what counts is the part the reader sees
        const view = (doc.defaultView || globalThis) as { innerWidth?: number };
        const seenLeft = Math.max(0, -hostBox.left);
        const seenRight =
          typeof view.innerWidth === 'number' && view.innerWidth > 0
            ? Math.min(hostBox.width, view.innerWidth - hostBox.left)
            : hostBox.width;
        // no wider than what is seen: a long text wraps rather than reaching off the screen
        tip.style.display = 'block';
        tip.style.maxWidth = Math.max(MIN_CARD, seenRight - seenLeft) + 'px';
        // measured at the left of what is seen: a card left where the last one stood, on the right, would be squeezed by
        // the edge and wrap where it need not
        tip.style.left = seenLeft + 'px';
        const w = tip.offsetWidth || 0;
        const h = tip.offsetHeight || 0;
        const left = ax + OFFSET + w > seenRight ? ax - OFFSET - w : ax + OFFSET;
        const top = ay - OFFSET - h >= 0 ? ay - OFFSET - h : ay + OFFSET;
        tip.style.left = Math.max(seenLeft, left) + 'px';
        tip.style.top = Math.max(0, top) + 'px';
      }

      // a field shown under a name written like code (avg7, quarterTotal) means nothing to a reader: say so once, while
      // the page is made (the composer reports it), with the names to give in `labels`
      if (spec.content === undefined && live.table) {
        const coded: string[] = [];
        for (const mark of live.spec.marks) {
          const d = markDef(mark);
          if (!d || !d.pick) continue;
          const shown = only || drawn(mark, d);
          const head = headingField(mark);
          const range = typeof spec.heading === 'string' ? null : rangeOf(mark, shown);
          for (const field of shown) {
            if (field === head || (range && (field === range.from || field === range.to))) continue;
            if (!labels[field] && CODE_NAME.test(field) && live.table.columns[field] && coded.indexOf(field) < 0) coded.push(field);
          }
        }
        if (coded.length)
          console.warn(
            `[blockcharts] interaction.tooltip: the card shows ${coded.map((f) => `"${f}"`).join(', ')} under ${
              coded.length > 1 ? 'their own names; give them names' : 'its own name; give it a name'
            } a reader knows in "labels"`,
          );
      }

      // a tap shows the card and it stays after the finger lifts; a mouse press (a pan starts) puts it away
      follow(live, show, hide);
      live.cleanup(() => {
        for (const el of [tip, dot, highlight, flows]) if (el.parentNode) el.parentNode.removeChild(el);
        releasePosition();
      });
    },
  };

  BC.define(def);
})((globalThis as any).BC);
