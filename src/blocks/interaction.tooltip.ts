(function () {
  const OFFSET = 12;
  const MAX_TEXT = 80;

  function format(v: unknown): string {
    if (v == null) return '–';
    if (typeof v === 'number') return isNaN(v) ? '–' : Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
    const s = String(v);
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '…' : s;
  }

  function nextFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 0);
  }

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'tooltip',
    version: 4,
    doc: 'Shows the datum under the pointer: a marker plus a box with the fields behind it. Every mark finds its own datum (MarkDef.pick); the closest one wins. The default content is written with textContent only; `content` replaces it with what a function returns.',
    params: {
      fields: { kind: 'list', doc: 'Fields to show. Default: the fields the mark reads (its channels and group).' },
      formats: { kind: 'any', doc: 'How to write values, per field: { "revenue": { "style": "currency", "currency": "USD" }, "share": "percent", "date": "date" }. Each is a preset or an object of Intl options (see guide.axis `format`). Fields without one are written as they are (numbers to 6 significant digits).' },
      content: { kind: 'any', doc: 'Name of a function registered with BC.defineFn (or, in a spec built in JS, the function itself). It gets a TooltipDatum and returns what to show: a string (text), { html }, a DOM Node, an array of those, null/false to hide the tooltip, or undefined for the default content. { html } is set with innerHTML and is not escaped — build it from trusted strings, never straight from a row value the data may contain.' },
      marker: { kind: 'enum', values: ['auto', 'dot', 'box', 'none'], default: 'auto', doc: '"dot" draws a small circle at the point; "box" highlights the whole shape (used automatically for rect marks like bar/heatmap, where a dot would land on an edge); "auto" picks box when the mark reports its bounds and dot otherwise; "none" shows the tooltip text without a marker.' },
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
            formats[field] = BC.formatter(given[field]);
          } catch (e) {
            console.warn(`[blockcharts] interaction.tooltip: format of "${field}" ignored: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else if (spec.formats !== undefined) {
        console.warn('[blockcharts] interaction.tooltip: "formats" must be an object of field name to format; ignored');
      }
      const only = Array.isArray(spec.fields) ? (spec.fields as unknown[]).filter((f): f is string => typeof f === 'string') : null;

      // The tip is positioned against the host, so the host has to be a positioning context.
      const releasePosition = live.claimPosition();

      const tip = doc.createElement('div');
      tip.setAttribute('class', 'bc-tooltip');
      tip.setAttribute('role', 'tooltip');
      Object.assign(tip.style, {
        position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '10', whiteSpace: 'nowrap',
        font: '12px/1.4 system-ui, sans-serif', padding: '6px 8px', borderRadius: '6px',
        background: 'var(--bc-tooltip-bg, #fff)', color: 'var(--bc-text, #333)',
        border: '1px solid var(--bc-axis, #ccc)', boxShadow: '0 2px 8px rgba(0,0,0,.18)',
      });
      const dot = doc.createElement('div');
      dot.setAttribute('class', 'bc-tooltip-dot');
      Object.assign(dot.style, {
        position: 'absolute', display: 'none', pointerEvents: 'none', width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px',
        boxSizing: 'border-box', borderRadius: '50%', border: '2px solid var(--bc-text, #333)', background: 'transparent',
      });
      const highlight = doc.createElement('div');
      highlight.setAttribute('class', 'bc-tooltip-highlight');
      Object.assign(highlight.style, {
        position: 'absolute', display: 'none', pointerEvents: 'none', boxSizing: 'border-box',
        background: 'var(--bc-tooltip-highlight-fill, rgba(127,127,127,.25))',
        outline: '1.5px solid var(--bc-tooltip-highlight-line, var(--bc-text, #333))', outlineOffset: '-1.5px',
      });
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

      let disposed = false;
      let scheduled = false;
      let last: PointerEvent | null = null;

      const hide = () => {
        tip.style.display = 'none';
        dot.style.display = 'none';
        highlight.style.display = 'none';
      };

      const toLogical = (ev: MouseEvent) => {
        const r = root.getBoundingClientRect();
        return { x: ((ev.clientX - r.left) * live.size.w) / r.width, y: ((ev.clientY - r.top) * live.size.h) / r.height };
      };
      const inPlot = (p: { x: number; y: number }) => {
        const b = live.plot;
        return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      };

      function lines(mark: BC.MarkSpec, def: BC.MarkDef, row: number): [string, string][] {
        const out: [string, string][] = [];
        const seen = new Set<string>();
        const add = (field: string) => {
          const col = live.table.columns[field];
          if (!col || seen.has(field)) return;
          seen.add(field);
          out.push([field, formats[field] ? formats[field](col[row]) || '–' : format(col[row])]);
        };
        if (only) {
          only.forEach(add);
          return out;
        }
        for (const ch of Object.keys(def.channels)) {
          try {
            const c = live.channel(mark, ch);
            if (c.field) add(c.field);
          } catch (e) {
            // a channel that cannot be resolved has nothing to show
          }
        }
        if (typeof mark.group === 'string') add(mark.group);
        return out;
      }

      function show(ev: PointerEvent): void {
        const p = toLogical(ev);
        if (!inPlot(p)) return hide();

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

        const rows = lines(mark, def, pick.row);
        let custom: BC.TooltipContent;
        const fn = contentFn();
        if (fn) {
          const values: Record<string, unknown> = {};
          for (const name of Object.keys(live.table.columns)) values[name] = live.table.columns[name][pick.row];
          try {
            custom = fn({ row: pick.row, values, lines: rows, mark, markIndex: index, x: pick.x, y: pick.y, table: live.table });
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
        if (custom === undefined) {
          for (const [label, value] of rows) {
            const line = doc.createElement('div');
            const name = doc.createElement('span');
            name.textContent = label + ': ';
            name.style.opacity = '0.65';
            const val = doc.createElement('span');
            val.textContent = value;
            line.appendChild(name);
            line.appendChild(val);
            tip.appendChild(line);
          }
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
          dot.style.display = 'block';
          highlight.style.display = 'none';
        } else {
          dot.style.display = 'none';
          highlight.style.display = 'none';
        }
        tip.style.display = 'block';
        const w = tip.offsetWidth || 0;
        const h = tip.offsetHeight || 0;
        const left = ax + OFFSET + w > hostBox.width ? ax - OFFSET - w : ax + OFFSET;
        const top = ay - OFFSET - h >= 0 ? ay - OFFSET - h : ay + OFFSET;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = Math.max(0, top) + 'px';
      }

      const onMove = (ev: PointerEvent) => {
        // dragging is a pan, not a hover
        if (ev.buttons) {
          last = null;
          return hide();
        }
        last = ev;
        if (scheduled) return;
        scheduled = true;
        nextFrame(() => {
          scheduled = false;
          if (disposed || !last) return;
          const e = last;
          last = null;
          try {
            show(e);
          } catch (err) {
            hide();
          }
        });
      };
      const onLeave = () => {
        last = null;
        hide();
      };

      root.addEventListener('pointermove', onMove as EventListener);
      root.addEventListener('pointerdown', onMove as EventListener);
      root.addEventListener('pointerleave', onLeave);
      root.addEventListener('pointercancel', onLeave);
      root.addEventListener('wheel', onLeave);
      live.cleanup(() => {
        disposed = true;
        root.removeEventListener('pointermove', onMove as EventListener);
        root.removeEventListener('pointerdown', onMove as EventListener);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointercancel', onLeave);
        root.removeEventListener('wheel', onLeave);
        for (const el of [tip, dot, highlight]) if (el.parentNode) el.parentNode.removeChild(el);
        releasePosition();
      });
    },
  };

  BC.define(def);
})();
