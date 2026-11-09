(function () {
  type Pointer = {
    toLogical(live: BC.LiveCtx, ev: MouseEvent): { x: number; y: number };
    inPlot(live: BC.LiveCtx, p: { x: number; y: number }): boolean;
  };
  /** From lib.pointer, listed in `requires` so it is on the page. */
  const pointer = () => (BC.get('lib.pointer') as BC.LibDef).exports as Pointer;

  type View = {
    current(live: BC.LiveCtx, name: string): [number, number];
    show(live: BC.LiveCtx, name: string, d0: number, d1: number): void;
    zoom(live: BC.LiveCtx, name: string, factor: number, maxZoom: number, anchor?: number): void;
  };
  /** From lib.view, listed in `requires` so it is on the page. */
  const view = () => (BC.get('lib.view') as BC.LibDef).exports as View;

  type Pair = [number, number];

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'zoom',
    version: 7,
    requires: ['lib.pointer', 'lib.view'],
    doc: 'Wheel zoom around the cursor, drag to pan, double-click to reset. A drag another interaction claims (interaction.brush, with its modifier held) is left to it. Works on continuous scales (linear, log, time; a log scale zooms by ratios) by changing their view through setView; the layout stays frozen.',
    params: {
      scales: { kind: 'list', default: ['x'], doc: 'Names of the scales to control.' },
      wheel: {
        kind: 'enum',
        values: ['ctrl', 'always', 'off'],
        default: 'ctrl',
        doc: '"ctrl": Ctrl/Cmd + wheel (and trackpad pinch) zooms, so the page still scrolls; "always": plain wheel zooms.',
      },
      fit: {
        kind: 'list',
        doc: 'Scales to auto-fit to the zoomed window (usually ["y"]): their domain is recomputed from the rows that are visible.',
      },
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

      const toLogical = (ev: MouseEvent) => pointer().toLogical(live, ev);
      const inPlot = (p: { x: number; y: number }) => pointer().inPlot(live, p);
      const coord = (name: string, p: { x: number; y: number }) => (live.orientation(name) === 'horizontal' ? p.x : p.y);
      // zoom and pan are even on the screen: lib.view runs on the logarithms of the values of a log scale
      const current = (name: string): Pair => view().current(live, name);

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
          view().zoom(live, name, factor, maxZoom, d0 + ((coord(name, p) - r0) / (r1 - r0)) * (d1 - d0));
        }
        refit();
      };

      let drag: { x: number; y: number; start: Record<string, Pair> } | null = null;
      const onDown = (ev: PointerEvent) => {
        // a drag another interaction claimed (a brush selection) is not a pan: both would move at once, and the
        // selection would be read off a view that slid away under it
        if (ev.button !== 0 || live.dragClaimed(ev)) return;
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
          view().show(live, name, d0 + shift, d1 + shift);
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
