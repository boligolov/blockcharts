(function () {
  type Pair = [number, number];
  const OVERLAY_CLASS = 'bc-brush';

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'brush',
    version: 2,
    doc: 'Drag a rectangle over the plot to zoom to it: on the scales in `scales` (default x) the view becomes the selected range, on a category (band) scale the categories under the selection. Shift + drag by default, so it does not fight with the pan of interaction.zoom; Escape cancels while dragging, double-click resets. A drag shorter than `minSize` px is not a selection.',
    params: {
      scales: { kind: 'list', default: ['x'], doc: 'Names of the scales to zoom. One horizontal scale selects a vertical band, one vertical scale a horizontal band, both a box.' },
      modifier: { kind: 'enum', values: ['shift', 'alt', 'ctrl', 'none'], default: 'shift', doc: 'Key that must be held to start a selection. "none" conflicts with the pan of interaction.zoom (turn its `pan` off).' },
      fit: { kind: 'list', doc: 'Scales to refit to the selected window (usually ["y"]).' },
      minSize: { kind: 'number', default: 6, doc: 'Smallest selection, in px, along each selected axis.' },
    },
    attach(spec, live) {
      const requested = Array.isArray(spec.scales) ? (spec.scales as unknown[]).filter((n): n is string => typeof n === 'string') : ['x'];
      const names = requested.filter((n) => {
        const s = live.scales[n];
        const ok = !!s && live.orientation(n) !== null && (!!s.invert || s.bandwidth !== undefined);
        if (!ok) console.warn(`[blockcharts] interaction.brush: scale "${n}" is not a positional scale that can be selected on, ignored`);
        return ok;
      });
      if (!names.length) return;
      const fitNames = (Array.isArray(spec.fit) ? (spec.fit as unknown[]) : []).filter((n): n is string => {
        const ok = typeof n === 'string' && !!live.scales[n] && names.indexOf(n) < 0;
        if (!ok && typeof n === 'string') console.warn(`[blockcharts] interaction.brush: cannot fit scale "${n}"`);
        return ok;
      });
      const modifier = spec.modifier === 'alt' || spec.modifier === 'ctrl' || spec.modifier === 'none' ? spec.modifier : 'shift';
      const minSize = typeof spec.minSize === 'number' && spec.minSize >= 0 ? spec.minSize : 6;
      if (modifier === 'none' && (live.spec.interaction || []).some((i) => i.type === 'zoom' && i.pan !== false)) {
        console.warn('[blockcharts] interaction.brush: without a modifier it drags at the same time as the pan of interaction.zoom; set "modifier" or turn "pan" off');
      }

      const root = live.root as HTMLElement;
      const host = live.host;
      const doc = host.ownerDocument || document;
      const horizontal = names.some((n) => live.orientation(n) === 'horizontal');
      const vertical = names.some((n) => live.orientation(n) === 'vertical');

      // The overlay is positioned against the host, like the tooltip. Claimed only while a drag is in progress.
      let releasePosition: (() => void) | null = null;

      const toLogical = (ev: MouseEvent) => {
        const r = root.getBoundingClientRect();
        return { x: ((ev.clientX - r.left) * live.size.w) / r.width, y: ((ev.clientY - r.top) * live.size.h) / r.height };
      };
      const inPlot = (p: { x: number; y: number }) => {
        const b = live.plot;
        return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      };
      const clampToPlot = (p: { x: number; y: number }) => {
        const b = live.plot;
        return { x: Math.max(b.x, Math.min(b.x + b.w, p.x)), y: Math.max(b.y, Math.min(b.y + b.h, p.y)) };
      };
      const held = (ev: MouseEvent) => modifier === 'none' || (modifier === 'shift' ? ev.shiftKey : modifier === 'alt' ? ev.altKey : ev.ctrlKey || ev.metaKey);

      let drag: { x0: number; y0: number; x1: number; y1: number; box: HTMLElement } | null = null;

      const rectOf = (d: { x0: number; y0: number; x1: number; y1: number }) => {
        const b = live.plot;
        return {
          x0: horizontal ? Math.min(d.x0, d.x1) : b.x,
          x1: horizontal ? Math.max(d.x0, d.x1) : b.x + b.w,
          y0: vertical ? Math.min(d.y0, d.y1) : b.y,
          y1: vertical ? Math.max(d.y0, d.y1) : b.y + b.h,
        };
      };

      const paint = () => {
        if (!drag) return;
        const r = rectOf(drag);
        const box = root.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        const k = box.width / live.size.w;
        Object.assign(drag.box.style, {
          left: box.left - hostBox.left + r.x0 * k + 'px',
          top: box.top - hostBox.top + r.y0 * k + 'px',
          width: (r.x1 - r.x0) * k + 'px',
          height: (r.y1 - r.y0) * k + 'px',
        });
      };

      const end = () => {
        if (!drag) return;
        if (drag.box.parentNode) drag.box.parentNode.removeChild(drag.box);
        drag = null;
        doc.removeEventListener('keydown', onKey);
        if (releasePosition) {
          releasePosition();
          releasePosition = null;
        }
      };

      const select = (r: { x0: number; x1: number; y0: number; y1: number }) => {
        // every selected axis has to be long enough, or the gesture was just a click that moved a little
        if (horizontal && r.x1 - r.x0 < minSize) return;
        if (vertical && r.y1 - r.y0 < minSize) return;
        for (const name of names) {
          const scale = live.scales[name];
          const a = live.orientation(name) === 'horizontal' ? r.x0 : r.y0;
          const b = live.orientation(name) === 'horizontal' ? r.x1 : r.y1;
          if (scale.invert) {
            const v0 = Number(scale.invert(a));
            const v1 = Number(scale.invert(b));
            const lo = Math.min(v0, v1);
            const hi = Math.max(v0, v1);
            const [b0, b1] = scale.baseDomain() as Pair;
            live.setView(name, hi - lo >= (b1 - b0) * (1 - 1e-9) ? null : [lo, hi]);
          } else {
            const bw = scale.bandwidth as number;
            const inside = scale.domain().filter((v) => {
              const edge = scale(v) as number;
              return isFinite(edge) && edge + bw >= a && edge <= b;
            });
            if (!inside.length) continue;
            live.setView(name, inside.length === scale.baseDomain().length ? null : inside);
          }
        }
        for (const f of fitNames) live.setView(f, live.fit(f, names[0]));
      };

      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') end();
      };
      const onDown = (ev: PointerEvent) => {
        if (ev.button !== 0 || !held(ev)) return;
        const p = toLogical(ev);
        if (!inPlot(p)) return;
        const box = doc.createElement('div');
        box.setAttribute('class', OVERLAY_CLASS);
        Object.assign(box.style, {
          position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box', zIndex: '5',
          background: 'var(--bc-brush-fill, rgba(78,121,167,.22))', border: '1px solid var(--bc-brush-line, rgba(78,121,167,.9))',
        });
        releasePosition = live.claimPosition();
        host.appendChild(box);
        drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, box };
        if (root.setPointerCapture) root.setPointerCapture(ev.pointerId);
        doc.addEventListener('keydown', onKey);
        paint();
        ev.preventDefault();
      };
      const onMove = (ev: PointerEvent) => {
        if (!drag) return;
        const p = clampToPlot(toLogical(ev));
        drag.x1 = p.x;
        drag.y1 = p.y;
        paint();
      };
      const onUp = (ev: PointerEvent) => {
        if (!drag) return;
        const p = clampToPlot(toLogical(ev));
        drag.x1 = p.x;
        drag.y1 = p.y;
        const r = rectOf(drag);
        end();
        select(r);
      };
      const onCancel = () => end();
      const onDblClick = (ev: MouseEvent) => {
        if (!inPlot(toLogical(ev))) return;
        for (const name of names) live.setView(name, null);
        for (const f of fitNames) live.setView(f, live.fit(f, names[0]));
      };

      root.addEventListener('pointerdown', onDown as EventListener);
      root.addEventListener('pointermove', onMove as EventListener);
      root.addEventListener('pointerup', onUp as EventListener);
      root.addEventListener('pointercancel', onCancel);
      root.addEventListener('dblclick', onDblClick as EventListener);
      live.cleanup(() => {
        end();
        root.removeEventListener('pointerdown', onDown as EventListener);
        root.removeEventListener('pointermove', onMove as EventListener);
        root.removeEventListener('pointerup', onUp as EventListener);
        root.removeEventListener('pointercancel', onCancel);
        root.removeEventListener('dblclick', onDblClick as EventListener);
      });
    },
  };

  BC.define(def);
})();
