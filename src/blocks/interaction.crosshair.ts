(function () {
  function nextFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 0);
  }

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'crosshair',
    version: 1,
    doc: 'A vertical line across the plot that follows the pointer, so the reader can read a date off several series at once. It snaps to the nearest datum of a line or area (or of every mark, with `snap: "all"`); `snap: "off"` follows the pointer freely. Works with or without the tooltip.',
    params: {
      snap: { kind: 'enum', values: ['lines', 'all', 'off'], default: 'lines', doc: 'What the line jumps to: the nearest point of a line or area ("lines"), of any mark ("all"), or nothing (it follows the pointer).' },
      horizontal: { kind: 'boolean', default: false, doc: 'Also a horizontal line through the datum.' },
    },
    attach(spec, live) {
      const host = live.host;
      const root = live.root as HTMLElement;
      const doc = host.ownerDocument || document;
      const release = live.claimPosition();
      const snap = spec.snap === 'all' || spec.snap === 'off' ? spec.snap : 'lines';
      const line = (cls: string, vertical: boolean) => {
        const el = doc.createElement('div');
        el.setAttribute('class', cls);
        Object.assign(el.style, vertical
          ? { position: 'absolute', display: 'none', pointerEvents: 'none', width: '0', marginLeft: '-0.5px', borderLeft: '1px dashed var(--bc-crosshair, var(--bc-axis, #999))' }
          : { position: 'absolute', display: 'none', pointerEvents: 'none', height: '0', marginTop: '-0.5px', borderTop: '1px dashed var(--bc-crosshair, var(--bc-axis, #999))' });
        host.appendChild(el);
        return el;
      };
      const vline = line('bc-crosshair', true);
      const hline = spec.horizontal === true ? line('bc-crosshair-h', false) : null;

      const hide = () => {
        vline.style.display = 'none';
        if (hline) hline.style.display = 'none';
      };

      /** The datum to snap to: the row whose x is nearest the pointer's, at any height, among the marks that qualify
       *  (a crosshair is about x; a mark's own pick only reaches a few px around its shape). null when there is none. */
      const nearest = (x: number, y: number): { x: number; y: number } | null => {
        let best: { x: number; y: number; d: number } | null = null;
        for (const mark of live.spec.marks) {
          if (snap === 'lines' && mark.type !== 'line' && mark.type !== 'area') continue;
          let xs: ArrayLike<number>;
          let ys: ArrayLike<number> | null = null;
          let half = 0;
          try {
            const cx = live.channel(mark, 'x');
            if (!cx.scale) continue;
            xs = cx.mapped;
            half = cx.scale.bandwidth !== undefined ? cx.scale.bandwidth / 2 : 0;
            const cy = live.channel(mark, 'y');
            if (cy.scale) ys = cy.mapped;
          } catch (e) {
            continue; // a mark without an x on a scale has no position to snap to
          }
          const { from, to } = live.rows(mark);
          for (let i = from; i < to; i++) {
            const px = xs[i] + half;
            if (!isFinite(px)) continue;
            const d = Math.abs(px - x);
            if (!best || d < best.d) best = { x: px, y: ys && isFinite(ys[i]) ? ys[i] : y, d };
          }
        }
        return best;
      };

      let last: PointerEvent | null = null;
      let scheduled = false;
      let disposed = false;
      const show = (ev: PointerEvent) => {
        const r = root.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        if (!r.width) return hide();
        const k = r.width / live.size.w;
        const x = (ev.clientX - r.left) / k;
        const y = (ev.clientY - r.top) / k;
        const p = live.plot;
        if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) return hide();
        const at = snap === 'off' ? { x, y } : nearest(x, y);
        if (!at) return hide();
        Object.assign(vline.style, { left: r.left - hostBox.left + at.x * k + 'px', top: r.top - hostBox.top + p.y * k + 'px', height: p.h * k + 'px', display: 'block' });
        if (hline) Object.assign(hline.style, { top: r.top - hostBox.top + at.y * k + 'px', left: r.left - hostBox.left + p.x * k + 'px', width: p.w * k + 'px', display: 'block' });
      };
      const onMove = (ev: PointerEvent) => {
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
      root.addEventListener('pointermove', onMove as EventListener);
      root.addEventListener('pointerleave', hide);
      root.addEventListener('wheel', hide);
      live.cleanup(() => {
        disposed = true;
        root.removeEventListener('pointermove', onMove as EventListener);
        root.removeEventListener('pointerleave', hide);
        root.removeEventListener('wheel', hide);
        for (const el of [vline, hline]) if (el && el.parentNode) el.parentNode.removeChild(el);
        release();
      });
    },
  };

  BC.define(def);
})();
