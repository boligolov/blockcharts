(function () {
  type Pair = [number, number];

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'zoom',
    version: 2,
    doc: 'Wheel zoom around the cursor, drag to pan, double-click to reset. Works on continuous scales (linear, time) by changing their view through setView; the layout stays frozen.',
    params: {
      scales: { kind: 'list', default: ['x'], doc: 'Names of the scales to control.' },
      wheel: { kind: 'enum', values: ['ctrl', 'always', 'off'], default: 'ctrl', doc: '"ctrl": Ctrl/Cmd + wheel (and trackpad pinch) zooms, so the page still scrolls; "always": plain wheel zooms.' },
      fit: { kind: 'list', doc: 'Scales to auto-fit to the zoomed window (usually ["y"]): their domain is recomputed from the rows that are visible.' },
      pan: { kind: 'boolean', default: true },
      maxZoom: { kind: 'number', default: 50, doc: 'How far in you can go, as a multiple of the full domain.' },
    },
    attach(spec, live) {
      const requested = Array.isArray(spec.scales) ? (spec.scales as unknown[]).filter((n): n is string => typeof n === 'string') : ['x'];
      const names = requested.filter((n) => {
        const ok = !!live.scales[n] && !!live.scales[n].invert && live.orientation(n) !== null;
        if (!ok) console.warn(`[blockcharts] interaction.zoom: scale "${n}" is not a continuous positional scale, ignored`);
        return ok;
      });
      if (!names.length) return;
      const fitNames = (Array.isArray(spec.fit) ? (spec.fit as unknown[]) : []).filter((n): n is string => {
        const ok = typeof n === 'string' && !!live.scales[n] && names.indexOf(n) < 0;
        if (!ok && typeof n === 'string') console.warn(`[blockcharts] interaction.zoom: cannot fit scale "${n}"`);
        return ok;
      });
      // the fitted scales follow the first zoomed one; no visible rows or no zoom = back to the full domain
      const refit = () => {
        for (const f of fitNames) live.setView(f, live.fit(f, names[0]));
      };

      const mode = spec.wheel === 'always' || spec.wheel === 'off' ? spec.wheel : 'ctrl';
      const canPan = spec.pan !== false;
      const maxZoom = typeof spec.maxZoom === 'number' && spec.maxZoom > 1 ? spec.maxZoom : 50;
      const root = live.root as HTMLElement;

      const toLogical = (ev: MouseEvent) => {
        const r = root.getBoundingClientRect();
        return { x: ((ev.clientX - r.left) * live.size.w) / r.width, y: ((ev.clientY - r.top) * live.size.h) / r.height };
      };
      const inPlot = (p: { x: number; y: number }) => {
        const b = live.plot;
        return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      };
      const coord = (name: string, p: { x: number; y: number }) => (live.orientation(name) === 'horizontal' ? p.x : p.y);
      const base = (name: string): Pair => live.scales[name].baseDomain() as Pair;
      const current = (name: string): Pair => {
        const v = live.getView()[name] as Pair;
        return [Number(v[0]), Number(v[1])];
      };

      /** Shift a domain back inside the full one; a view that covers everything is no view. */
      const commit = (name: string, d0: number, d1: number) => {
        const [b0, b1] = base(name);
        if (d1 - d0 >= (b1 - b0) * (1 - 1e-9)) {
          live.setView(name, null);
          return;
        }
        if (d0 < b0) {
          d1 += b0 - d0;
          d0 = b0;
        }
        if (d1 > b1) {
          d0 -= d1 - b1;
          d1 = b1;
        }
        live.setView(name, [d0, d1]);
      };

      const onWheel = (ev: WheelEvent) => {
        if (mode === 'off' || (mode === 'ctrl' && !(ev.ctrlKey || ev.metaKey))) return;
        const p = toLogical(ev);
        if (!inPlot(p)) return;
        ev.preventDefault();
        const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
        const factor = Math.exp(dy * 0.002);
        for (const name of names) {
          const [d0, d1] = current(name);
          const [r0, r1] = live.scales[name].range() as Pair;
          const [b0, b1] = base(name);
          const anchor = d0 + ((coord(name, p) - r0) / (r1 - r0)) * (d1 - d0);
          const span = Math.min(b1 - b0, Math.max((b1 - b0) / maxZoom, (d1 - d0) * factor));
          const f = span / (d1 - d0);
          commit(name, anchor - (anchor - d0) * f, anchor + (d1 - anchor) * f);
        }
        refit();
      };

      let drag: { x: number; y: number; start: Record<string, Pair> } | null = null;
      const onDown = (ev: PointerEvent) => {
        if (ev.button !== 0) return;
        const p = toLogical(ev);
        if (!inPlot(p)) return;
        const start: Record<string, Pair> = {};
        for (const name of names) start[name] = current(name);
        drag = { x: p.x, y: p.y, start };
        if (root.setPointerCapture) root.setPointerCapture(ev.pointerId);
        root.style.cursor = 'grabbing';
      };
      const onMove = (ev: PointerEvent) => {
        if (!drag) return;
        const p = toLogical(ev);
        for (const name of names) {
          const [d0, d1] = drag.start[name];
          const [r0, r1] = live.scales[name].range() as Pair;
          const dpx = live.orientation(name) === 'horizontal' ? p.x - drag.x : p.y - drag.y;
          const shift = (-dpx / (r1 - r0)) * (d1 - d0);
          commit(name, d0 + shift, d1 + shift);
        }
        refit();
      };
      const onUp = () => {
        drag = null;
        root.style.cursor = 'grab';
      };
      const onDblClick = (ev: MouseEvent) => {
        if (!inPlot(toLogical(ev))) return;
        for (const name of names) live.setView(name, null);
        refit();
      };

      root.addEventListener('wheel', onWheel as EventListener, { passive: false });
      root.addEventListener('dblclick', onDblClick as EventListener);
      if (canPan) {
        root.addEventListener('pointerdown', onDown as EventListener);
        root.addEventListener('pointermove', onMove as EventListener);
        root.addEventListener('pointerup', onUp);
        root.addEventListener('pointercancel', onUp);
        root.style.cursor = 'grab';
      }
      live.cleanup(() => {
        root.removeEventListener('wheel', onWheel as EventListener);
        root.removeEventListener('dblclick', onDblClick as EventListener);
        root.removeEventListener('pointerdown', onDown as EventListener);
        root.removeEventListener('pointermove', onMove as EventListener);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onUp);
        root.style.cursor = '';
      });
    },
  };

  BC.define(def);
})();
