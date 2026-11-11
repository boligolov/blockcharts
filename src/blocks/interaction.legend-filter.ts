(function () {
  const ATTR_SCALE = 'bc-legend-scale';
  const ATTR_INDEX = 'bc-legend-index';
  const CLASS = 'bc-legend-filter';
  /** Only categories can be hidden one by one: the scale has to color categories. */
  const ofCategories = (scale: BC.Scale) => scale.output === 'color' && scale.input === 'category';
  /** The scale it filters: `scale`, else that of the first guide of a categorical color scale (the legend that shows its
   *  categories); undefined when it is not one of categories. */
  const scaleOf = (spec: BC.InteractionSpec, chart: BC.ChartSpec, scales: Readonly<Record<string, BC.Scale>>) => {
    const shown = (chart.guides || []).find((g) => typeof g.scale === 'string' && !!scales[g.scale] && ofCategories(scales[g.scale]));
    const name = typeof spec.scale === 'string' ? spec.scale : shown ? (shown.scale as string) : undefined;
    return name && scales[name] && ofCategories(scales[name]) ? name : undefined;
  };
  /** Keys on a legend item: Enter or Space shows or hides its category, with Shift they show it alone (as a double-click). */
  const pressing = (ev: KeyboardEvent) => ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar';

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'legend-filter',
    version: 6,
    outerLegend: true,
    doc: 'Click an item of a categorical legend to hide or show that category; double-click isolates it (double-click again shows everything). From the keyboard each item is a switch: Tab reaches it, Enter or Space hides or shows its category, Shift+Enter isolates it (on a canvas there are no items to reach). Hidden categories are drawn by no mark and stay in the legend, dimmed. The visible set is the view of the color scale, so it can also be set with setView. Hiding everything shows everything.',
    params: {
      scale: { kind: 'scale', doc: 'The color scale to filter. Default: the scale of the first legend.' },
      legend: {
        kind: 'string',
        doc: 'The id of a legend outside the chart, in the page, shared by several charts. Its items are elements with `data-bc-legend-index`. The composer writes this for facets; there is no need to set it by hand.',
      },
      fit: { kind: 'list', doc: 'Scales to refit to the visible rows after a change (usually ["y"]); by default they keep their domain.' },
    },
    // the legend in the chart, unless the page draws one outside it
    toggles: (spec, ctx) => (typeof spec.legend === 'string' ? undefined : scaleOf(spec, ctx.spec, ctx.scales)),
    attach(spec, live) {
      const outer = typeof spec.legend === 'string' ? spec.legend : null;
      const name = scaleOf(spec, live.spec, live.scales);
      const scale = name ? live.scales[name] : undefined;
      if (!name || !scale) {
        console.warn(
          '[blockcharts] interaction.legend-filter: needs a categorical color scale (set "scale", or add a legend guide for one); ignored',
        );
        return;
      }
      const fitNames = (Array.isArray(spec.fit) ? (spec.fit as unknown[]) : []).filter((n): n is string => {
        const ok = typeof n === 'string' && !!live.scales[n] && n !== name;
        if (!ok && typeof n === 'string') console.warn(`[blockcharts] interaction.legend-filter: cannot fit scale "${n}"`);
        return ok;
      });
      const root = live.root as Element;
      const base = scale.baseDomain();
      const doc = live.host.ownerDocument || document;
      const shared = outer ? doc.getElementById(outer) : null;
      if (outer && !shared) return; // the composer's dry run has no page, and without the legend there is nothing to click

      // Stateless: what is visible is whatever the view of the scale says, so setView and clicks agree.
      const visible = (): unknown[] => live.getView()[name] as unknown[];
      const apply = (next: unknown[]) => {
        // everything or nothing visible = no filter (hiding the last category would leave an empty chart)
        live.setView(name, next.length === 0 || next.length === base.length ? null : next);
        for (const f of fitNames) live.setView(f, live.fit(f, name));
        if (shared) {
          const shown = next.length ? next : base;
          shared.querySelectorAll('[data-bc-legend-index]').forEach((el) => {
            const on = shown.indexOf(base[Number(el.getAttribute('data-bc-legend-index'))]) >= 0;
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
        }
      };
      const itemOf = (ev: Event): { value: unknown } | null => {
        if (shared) {
          const el = (ev.target as Element | null)?.closest?.('[data-bc-legend-index]');
          const at = el ? Number(el.getAttribute('data-bc-legend-index')) : NaN;
          return Number.isInteger(at) && at >= 0 && at < base.length ? { value: base[at] } : null;
        }
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

      // A key on an item does what a click and a double-click do, on the page's own buttons too (a facet's legend): the
      // key is taken before the button clicks on it. A key held down does it once.
      const onKey = (ev: Event) => {
        const key = ev as KeyboardEvent;
        if (!pressing(key) || key.altKey || key.ctrlKey || key.metaKey) return;
        const item = itemOf(ev);
        if (!item) return;
        ev.preventDefault(); // Space would scroll the page, Enter would click the button
        if (key.repeat) return;
        const shown = visible();
        before = null;
        if (key.shiftKey) apply(shown.length === 1 && shown[0] === item.value ? base.slice() : [item.value]);
        else apply(base.filter((v) => (v === item.value ? shown.indexOf(v) < 0 : shown.indexOf(v) >= 0)));
      };

      const target: EventTarget = shared || root;
      target.addEventListener('click', onClick);
      target.addEventListener('dblclick', onDblClick);
      target.addEventListener('keydown', onKey);
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
      const isCanvas = !shared && typeof (root as HTMLCanvasElement).getContext === 'function';
      if (isCanvas) root.addEventListener('pointermove', onMove);
      // lets a stylesheet show a pointer cursor on legend items only when they can be clicked
      const previousClass = root.getAttribute('class');
      root.setAttribute('class', ((previousClass || '') + ' ' + CLASS).trim());
      live.cleanup(() => {
        target.removeEventListener('click', onClick);
        target.removeEventListener('dblclick', onDblClick);
        target.removeEventListener('keydown', onKey);
        if (isCanvas) root.removeEventListener('pointermove', onMove);
        if (previousClass === null) root.removeAttribute ? root.removeAttribute('class') : root.setAttribute('class', '');
        else root.setAttribute('class', previousClass);
      });
    },
  };

  BC.define(def);
})();
