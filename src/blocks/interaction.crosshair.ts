(function () {
  type Pointer = {
    toLogical(live: BC.LiveCtx, ev: MouseEvent): { x: number; y: number };
    inPlot(live: BC.LiveCtx, p: { x: number; y: number }): boolean;
  };
  /** From lib.pointer, listed in `requires` so it is on the page. */
  const pointer = () => (BC.get('lib.pointer') as BC.LibDef).exports as Pointer;

  type Follow = (live: BC.LiveCtx, show: (ev: PointerEvent) => void, hide: () => void, keepOnPress?: boolean) => void;
  /** From lib.pointer, listed in `requires` so it is on the page. */
  const follow: Follow = (live, show, hide, keepOnPress) =>
    ((BC.get('lib.pointer') as BC.LibDef).exports.follow as Follow)(live, show, hide, keepOnPress);

  /** A mark that draws its series as one shape each (a line, an area): what "lines" snaps to. */
  function isSeries(mark: BC.MarkSpec): boolean {
    const def = BC.get(`mark.${mark.type}`) as BC.MarkDef | undefined;
    return !!(def && def.series);
  }

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'crosshair',
    version: 6,
    requires: ['lib.pointer'],
    alongX: true,
    doc: 'A vertical line across the plot that follows the pointer, so the reader can read a date off several series at once. It snaps to the nearest datum of a line or area (or of every mark, with `snap: "all"`); `snap: "off"` follows the pointer freely. On a touch screen it follows a tap and the sliding finger, and stays until the reader touches somewhere else. Works with or without the tooltip.',
    params: {
      snap: {
        kind: 'enum',
        values: ['lines', 'all', 'off'],
        default: 'lines',
        doc: 'What the line jumps to: the nearest point of a line or area ("lines"), of any mark ("all"), or nothing (it follows the pointer).',
      },
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
        Object.assign(
          el.style,
          vertical
            ? {
                position: 'absolute',
                display: 'none',
                pointerEvents: 'none',
                width: '0',
                marginLeft: '-0.5px',
                borderLeft: '1px dashed var(--bc-crosshair, var(--bc-axis, #999))',
              }
            : {
                position: 'absolute',
                display: 'none',
                pointerEvents: 'none',
                height: '0',
                marginTop: '-0.5px',
                borderTop: '1px dashed var(--bc-crosshair, var(--bc-axis, #999))',
              },
        );
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
          if (snap === 'lines' && !isSeries(mark)) continue;
          let xs: ArrayLike<number>;
          let ys: ArrayLike<number> | null = null;
          let half = 0;
          try {
            const cx = live.channel(mark, 'x');
            if (!cx.scale) continue;
            xs = cx.mapped;
            half = cx.half;
            const cy = live.channel(mark, 'y');
            if (cy.scale) ys = cy.mapped;
          } catch (e) {
            continue; // a mark without an x on a scale has no position to snap to
          }
          const { from, to } = live.rows(mark);
          const { x: left, w } = live.plot;
          for (let i = from; i < to; i++) {
            const px = xs[i] + half;
            // zoomed, the rows drawn reach a point past each edge: not one the line can stand on
            if (!isFinite(px) || px < left - 0.5 || px > left + w + 0.5) continue;
            const d = Math.abs(px - x);
            if (!best || d < best.d) best = { x: px, y: ys && isFinite(ys[i]) ? ys[i] : y, d };
          }
        }
        return best;
      };

      const show = (ev: PointerEvent) => {
        const r = root.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        if (!r.width) return hide();
        const k = r.width / live.size.w;
        const { x, y } = pointer().toLogical(live, ev);
        const p = live.plot;
        if (!pointer().inPlot(live, { x, y })) return hide();
        const at = snap === 'off' ? { x, y } : nearest(x, y);
        if (!at) return hide();
        Object.assign(vline.style, {
          left: r.left - hostBox.left + at.x * k + 'px',
          top: r.top - hostBox.top + p.y * k + 'px',
          height: p.h * k + 'px',
          display: 'block',
        });
        if (hline)
          Object.assign(hline.style, {
            top: r.top - hostBox.top + at.y * k + 'px',
            left: r.left - hostBox.left + p.x * k + 'px',
            width: p.w * k + 'px',
            display: 'block',
          });
      };
      // a mouse press keeps the line where it is; a touch is where the finger points
      follow(live, show, hide, true);
      live.cleanup(() => {
        for (const el of [vline, hline]) if (el && el.parentNode) el.parentNode.removeChild(el);
        release();
      });
    },
  };

  BC.define(def);
})();
