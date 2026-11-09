(function () {
  type Point = { x: number; y: number };

  /** Where a mouse or pointer event is, in the chart's own units (those of `size` and `plot`), however the page scales
   *  the chart. */
  function toLogical(live: BC.LiveCtx, ev: MouseEvent): Point {
    const r = (live.root as HTMLElement).getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * live.size.w) / r.width, y: ((ev.clientY - r.top) * live.size.h) / r.height };
  }

  /** Whether a point in the chart's own units is on the plot, its edges included. */
  function inPlot(live: BC.LiveCtx, p: Point): boolean {
    const b = live.plot;
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  function nextFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 0);
  }

  /** Calls `show` with the latest pointer event over the chart, at most once a frame, and `hide` when what it shows
   *  should go. A finger is down whenever it points (buttons is 1 from the first touch on), so for touch a press is the
   *  hover: a tap shows, sliding the finger follows the data, and what it shows stays after the finger lifts (which sends
   *  pointerleave) until the reader touches somewhere else. Dragging with a mouse or a pen is a pan, not a hover, and
   *  hides it; so do leaving the chart, the wheel and a page scroll that starts on the chart. With `keepOnPress` a
   *  mouse press leaves it where it is; otherwise the press hides it too. The listeners go with the chart. */
  function follow(live: BC.LiveCtx, show: (ev: PointerEvent) => void, hide: () => void, keepOnPress?: boolean): void {
    const root = live.root as HTMLElement;
    const host = live.host;
    const doc = host.ownerDocument || document;
    let last: PointerEvent | null = null;
    let scheduled = false;
    let disposed = false;

    const isTouch = (ev: Event) => (ev as PointerEvent).pointerType === 'touch';
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons && !isTouch(ev)) {
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
    const onDown = (ev: PointerEvent) => {
      if (!keepOnPress || isTouch(ev)) onMove(ev);
    };
    const onCancel = () => {
      last = null;
      hide();
    };
    const onLeave = (ev: Event) => {
      if (!isTouch(ev)) onCancel();
    };
    // a touch anywhere outside the chart puts it away (with a mouse, leaving the chart already has)
    const onOutside = (ev: Event) => {
      const target = ev.target as Node | null;
      if (isTouch(ev) && target && typeof host.contains === 'function' && !host.contains(target)) onCancel();
    };

    root.addEventListener('pointermove', onMove as EventListener);
    root.addEventListener('pointerdown', onDown as EventListener);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointercancel', onCancel);
    root.addEventListener('wheel', onCancel);
    if (typeof doc.addEventListener === 'function') doc.addEventListener('pointerdown', onOutside, true);
    live.cleanup(() => {
      disposed = true;
      root.removeEventListener('pointermove', onMove as EventListener);
      root.removeEventListener('pointerdown', onDown as EventListener);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointercancel', onCancel);
      root.removeEventListener('wheel', onCancel);
      if (typeof doc.removeEventListener === 'function') doc.removeEventListener('pointerdown', onOutside, true);
    });
  }

  const def: BC.LibDef = {
    role: 'lib',
    type: 'pointer',
    version: 1,
    doc: 'The pointer over a chart, shared by the tooltip, the crosshair, zoom and brush. `toLogical(live, event)` turns the position of a mouse or pointer event into the units of the chart, however the page scales it, and `inPlot(live, point)` tells whether such a point is on the plot. `follow(live, show, hide, keepOnPress)` calls `show(event)` at most once a frame while the pointer is over the chart, and `hide()` when it leaves, drags, scrolls or a finger touches outside the chart; on a touch screen a tap is the hover and stays after the finger lifts. A spec never names it.',
    exports: { toLogical, inPlot, follow },
  };

  BC.define(def);
})();
