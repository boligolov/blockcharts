(function () {
  const ATTR_SCALE = 'bc-legend-scale';
  const ATTR_INDEX = 'bc-legend-index';
  const CLASS = 'bc-legend-filter';

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'legend-filter',
    version: 1,
    doc: 'Click an item of a categorical legend to hide or show that category; double-click isolates it (double-click again shows everything). Hidden categories are drawn by no mark and stay in the legend, dimmed. The visible set is the view of the color scale, so it can also be set with setView. Hiding everything shows everything.',
    params: {
      scale: { kind: 'scale', doc: 'The color scale to filter. Default: the scale of the first legend.' },
      fit: { kind: 'list', doc: 'Scales to refit to the visible rows after a change (usually ["y"]); by default they keep their domain.' },
    },
    attach(spec, live) {
      const legends = (live.spec.guides || []).filter((g) => g.type === 'legend' && typeof g.scale === 'string');
      const name = typeof spec.scale === 'string' ? spec.scale : legends.length ? (legends[0].scale as string) : undefined;
      const scale = name ? live.scales[name] : undefined;
      if (!name || !scale || scale.kind !== 'color') {
        console.warn('[blockcharts] interaction.legend-filter: needs a categorical color scale (set "scale", or add a legend guide for one); ignored');
        return;
      }
      const fitNames = (Array.isArray(spec.fit) ? (spec.fit as unknown[]) : []).filter((n): n is string => {
        const ok = typeof n === 'string' && !!live.scales[n] && n !== name;
        if (!ok && typeof n === 'string') console.warn(`[blockcharts] interaction.legend-filter: cannot fit scale "${n}"`);
        return ok;
      });
      const root = live.root as Element;
      const base = scale.baseDomain();

      // Stateless: what is visible is whatever the view of the scale says, so setView and clicks agree.
      const visible = (): unknown[] => live.getView()[name] as unknown[];
      const apply = (next: unknown[]) => {
        // everything or nothing visible = no filter (hiding the last category would leave an empty chart)
        live.setView(name, next.length === 0 || next.length === base.length ? null : next);
        for (const f of fitNames) live.setView(f, live.fit(f, name));
      };
      const itemOf = (ev: Event): { value: unknown } | null => {
        const data = live.dataAt(ev as MouseEvent);
        if (!data || data[ATTR_SCALE] !== name) return null;
        const index = Number(data[ATTR_INDEX]);
        return Number.isInteger(index) && index >= 0 && index < base.length ? { value: base[index] } : null;
      };

      // A browser sends click, click, dblclick. The first click has already toggled something when the double-click
      // arrives, so a double-click is decided from what was visible before that click.
      let before: { shown: unknown[]; at: number } | null = null;
      const onClick = (ev: Event) => {
        // the second click of a double-click belongs to the double-click
        if ((ev as MouseEvent).detail > 1) return;
        const item = itemOf(ev);
        if (!item) return;
        const shown = visible();
        before = { shown: shown.slice(), at: Date.now() };
        apply(base.filter((v) => (v === item.value ? shown.indexOf(v) < 0 : shown.indexOf(v) >= 0)));
      };
      const onDblClick = (ev: Event) => {
        const item = itemOf(ev);
        if (!item) return;
        ev.preventDefault();
        const shown = before && Date.now() - before.at < 700 ? before.shown : visible();
        before = null;
        apply(shown.length === 1 && shown[0] === item.value ? base.slice() : [item.value]);
      };

      root.addEventListener('click', onClick);
      root.addEventListener('dblclick', onDblClick);
      // a canvas has no legend elements for a stylesheet to give a pointer cursor: it is set while the pointer is over an item
      let savedCursor: string | null = null;
      const onMove = (ev: Event) => {
        const style = (root as HTMLElement).style;
        const over = !!itemOf(ev);
        if (over && savedCursor === null) {
          savedCursor = style.cursor;
          style.cursor = 'pointer';
        } else if (!over && savedCursor !== null) {
          style.cursor = savedCursor;
          savedCursor = null;
        }
      };
      const isCanvas = typeof (root as HTMLCanvasElement).getContext === 'function';
      if (isCanvas) root.addEventListener('pointermove', onMove);
      // lets a stylesheet show a pointer cursor on legend items only when they can be clicked
      const previousClass = root.getAttribute('class');
      root.setAttribute('class', ((previousClass || '') + ' ' + CLASS).trim());
      live.cleanup(() => {
        root.removeEventListener('click', onClick);
        root.removeEventListener('dblclick', onDblClick);
        if (isCanvas) root.removeEventListener('pointermove', onMove);
        if (previousClass === null) root.removeAttribute ? root.removeAttribute('class') : root.setAttribute('class', '');
        else root.setAttribute('class', previousClass);
      });
    },
  };

  BC.define(def);
})();
