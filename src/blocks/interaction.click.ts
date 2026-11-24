(function (BC: BC.Runtime) {
  /** How far past the plot a click still looks for a datum: as far as the tooltip looks (a dot on the edge sticks out). */
  const EDGE = 12;
  /** A press that moved farther than this, in CSS px, before it was let go was a drag (a pan, a brush), not a click. */
  const SLOP = 4;
  /** data-* attributes a DOM renderer writes of its own (a primitive's ref, its layer): not the `data` of a control. */
  const OWN = ['bc-mark', 'bc-row', 'bc-layer'];

  type Point = { x: number; y: number };
  type Hit = { pick: BC.Pick; mark: BC.MarkSpec; def: BC.MarkDef; index: number };
  type Pointer = {
    toLogical(live: BC.LiveCtx, ev: MouseEvent): Point;
    inPlot(live: BC.LiveCtx, p: Point, margin?: number): boolean;
    pickAt(live: BC.LiveCtx, p: Point): Hit | null;
    follow(live: BC.LiveCtx, show: (ev: PointerEvent) => void, hide: () => void, keepOnPress?: boolean): void;
  };
  /** From lib.pointer, listed in `requires` so it is on the page. */
  const pointer = () => (BC.get('lib.pointer') as BC.LibDef).exports as Pointer;

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'click',
    version: 1,
    requires: ['lib.pointer'],
    events: ['bc-click'],
    doc: "Clicks on the data, for a script of the page: a click or a tap on a bar, a dot, a slice, a line sends a `bc-click` event from the chart's element. It bubbles, and `event.detail` has the row: `row`, `rows`, `values` (every column of the row), `mark`, `markIndex`, `x`, `y`, `table`, and the browser's own `event` (modifier keys). What it hits is what the tooltip shows there. A drag (a pan, a brush) is not a click, a double click sends one, and a legend item stays the legend filter's. A report made from JSON alone has no script to listen: this is for pages and apps with code of their own.",
    params: {
      cursor: { kind: 'boolean', default: true, doc: 'A hand cursor over what can be clicked.' },
    },
    attach(spec, live) {
      const root = live.root as HTMLElement;
      const host = live.host;
      const doc = host.ownerDocument || document;

      /** A click on a control the chart draws (a legend item: a primitive with `data`) is that control's. */
      const onControl = (ev: MouseEvent) => {
        const data = live.dataAt(ev);
        return !!data && Object.keys(data).some((k) => OWN.indexOf(k) < 0);
      };
      const hitAt = (ev: MouseEvent): Hit | null => {
        const p = pointer().toLogical(live, ev);
        if (!pointer().inPlot(live, p, EDGE) || onControl(ev)) return null;
        return pointer().pickAt(live, p);
      };

      let down: { x: number; y: number } | null = null;
      const onDown = (ev: PointerEvent) => {
        down = { x: ev.clientX, y: ev.clientY };
      };
      const onClick = (ev: MouseEvent) => {
        const from = down;
        down = null;
        // the second click of a double click belongs to the double click (a zoom's reset)
        if (ev.detail > 1) return;
        if (from && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > SLOP) return;
        const hit = hitAt(ev);
        if (!hit) return;
        const { pick, mark, index } = hit;
        const table = live.table;
        const values: Record<string, unknown> = {};
        for (const name of Object.keys(table.columns)) values[name] = table.columns[name][pick.row];
        const detail: BC.ClickDetail = {
          row: pick.row,
          rows: pick.rows && pick.rows.length ? pick.rows.slice() : [pick.row],
          values,
          mark,
          markIndex: index,
          x: pick.x,
          y: pick.y,
          table,
          event: ev,
        };
        const view = (doc.defaultView || globalThis) as unknown as { CustomEvent?: typeof CustomEvent };
        if (typeof view.CustomEvent !== 'function' || typeof host.dispatchEvent !== 'function') return;
        host.dispatchEvent(new view.CustomEvent('bc-click', { bubbles: true, detail }));
      };
      root.addEventListener('pointerdown', onDown as EventListener);
      root.addEventListener('click', onClick as EventListener);

      // the hand over what can be clicked; another interaction's cursor (a zoom's grab) is put back when it goes
      let mine = false;
      let saved = '';
      const style = root.style;
      const off = () => {
        if (mine && style.cursor === 'pointer') style.cursor = saved;
        mine = false;
      };
      if (spec.cursor !== false && style)
        pointer().follow(
          live,
          (ev) => {
            if (!hitAt(ev)) return off();
            // a hand someone else put there (the legend filter's, on a canvas) is theirs to take away
            if (mine || style.cursor === 'pointer') return;
            saved = style.cursor || '';
            style.cursor = 'pointer';
            mine = true;
          },
          off,
          true,
        );

      live.cleanup(() => {
        root.removeEventListener('pointerdown', onDown as EventListener);
        root.removeEventListener('click', onClick as EventListener);
        off();
      });
    },
  };

  BC.define(def);
})((globalThis as any).BC);
