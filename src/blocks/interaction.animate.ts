(function () {
  type Effect = 'grow' | 'wipe' | 'pop' | 'fade';
  /** When each chart began to play in, by its host. A chart built again while it plays (its web font has come, its width
   *  changed) goes on from where it was; one built again after that (a new width, an update) does not play again. */
  const started = typeof WeakMap === 'function' ? new WeakMap<object, number>() : null;
  const now = () =>
    typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : Date.now();

  /** How a mark asks to be brought in (MarkDef.enter), if it does. */
  function enterOf(mark: BC.MarkSpec): Effect | undefined {
    const def = BC.get(`mark.${mark.type}`) as BC.MarkDef | undefined;
    return def && def.enter;
  }

  /** The effect that suits the marks: a pie opens, bars grow (unless series are drawn over them), series are drawn left
   *  to right, the rest fades in. */
  function auto(spec: BC.ChartSpec): Effect {
    const asked = spec.marks.map(enterOf);
    if (asked.indexOf('pop') >= 0) return 'pop';
    if (asked.indexOf('grow') >= 0 && asked.indexOf('wipe') < 0) return 'grow';
    if (asked.indexOf('wipe') >= 0) return 'wipe';
    return 'fade';
  }

  /** Where bars stand: the y (or, for horizontal bars, the x) of the value 0 if it is in view, else the plot's edge. */
  function baseline(live: BC.LiveCtx): { horizontal: boolean; at: number } {
    const rect = live.spec.marks.find((m) => enterOf(m) === 'grow');
    let horizontal = false;
    if (rect) {
      try {
        const cy = live.channel(rect, 'y');
        horizontal = !!(cy.scale && cy.scale.bandwidth !== undefined);
      } catch (e) {
        horizontal = false;
      }
    }
    const p = live.plot;
    const scale = horizontal ? live.scales.x : live.scales.y;
    const zero = scale && scale.input === 'number' ? (scale(0) as number) : NaN;
    if (horizontal) return { horizontal, at: isFinite(zero) && zero >= p.x && zero <= p.x + p.w ? zero : p.x };
    return { horizontal, at: isFinite(zero) && zero >= p.y && zero <= p.y + p.h ? zero : p.y + p.h };
  }

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'animate',
    version: 4,
    doc: "Plays the chart in once, when it is first drawn: bars grow from their baseline, lines and areas are drawn from left to right, a pie opens from its center, anything else fades in. Never again on zoom, filter or update of the view, and not at all for readers who ask their system for reduced motion; a chart laid out again while it plays in (its web font has come) goes on from where it was. Uses the browser's own animation of the SVG layer (no timer loop); on a canvas chart it fades the canvas in.",
    params: {
      effect: {
        kind: 'enum',
        values: ['auto', 'grow', 'wipe', 'pop', 'fade'],
        default: 'auto',
        doc: '"auto" picks by the marks: grow for bars, wipe for lines and areas, pop for a pie, fade otherwise.',
      },
      duration: { kind: 'number', default: 700, doc: 'Milliseconds.' },
      delay: { kind: 'number', default: 0, doc: 'Milliseconds before it starts (stagger the cards of a dashboard).' },
    },
    attach(spec, live) {
      const root = live.root as Element & { animate?: Element['animate'] };
      let elapsed = 0;
      const at = started ? started.get(live.host) : undefined;
      if (at !== undefined) elapsed = Math.max(0, now() - at);
      else if (started) started.set(live.host, now());
      const view = (live.host.ownerDocument && live.host.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : undefined);
      // readers who asked for less motion get none
      if (view && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const duration = typeof spec.duration === 'number' && spec.duration >= 0 ? Math.min(10000, spec.duration) : 700;
      const delay = typeof spec.delay === 'number' && spec.delay >= 0 ? Math.min(10000, spec.delay) : 0;
      const timing = { duration, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' as FillMode };
      // built again after it has played in: no more
      if (at !== undefined && elapsed >= delay + duration) return;
      const effect: Effect =
        spec.effect === 'grow' || spec.effect === 'wipe' || spec.effect === 'pop' || spec.effect === 'fade' ? spec.effect : auto(live.spec);

      // the marks layer of an SVG chart; a canvas has no layers, so it fades as a whole
      const layer =
        typeof root.querySelector === 'function'
          ? (root.querySelector('[data-bc-layer="marks"]') as (Element & { style: CSSStyleDeclaration }) | null)
          : null;
      const target = (layer || root) as Element;
      if (typeof target.animate !== 'function') return; // an environment without the Web Animations API: just show it
      const p = live.plot;
      let frames: Keyframe[];
      if (!layer || effect === 'fade') {
        frames = [{ opacity: 0 }, { opacity: 1 }];
      } else if (effect === 'wipe') {
        // reveal from the left edge of the plot to its right one
        const right = live.size.w - (p.x + p.w);
        frames = [
          { clipPath: `inset(0 ${live.size.w - p.x}px 0 0)` },
          { clipPath: `inset(0 ${Math.max(0, right - 4)}px 0 0)`, offset: 0.999 },
          { clipPath: 'none' },
        ];
      } else if (effect === 'pop') {
        layer.style.transformBox = 'view-box';
        layer.style.transformOrigin = `${p.x + p.w / 2}px ${p.y + p.h / 2}px`;
        frames = [
          { transform: 'scale(0.6) rotate(-30deg)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ];
      } else {
        const b = baseline(live);
        layer.style.transformBox = 'view-box';
        layer.style.transformOrigin = b.horizontal ? `${b.at}px 0px` : `0px ${b.at}px`;
        frames = [{ transform: b.horizontal ? 'scaleX(0)' : 'scaleY(0)' }, { transform: 'none' }];
      }
      const animation = target.animate(frames, timing);
      if (elapsed > 0) animation.currentTime = elapsed;
      live.cleanup(() => {
        try {
          animation.cancel();
        } catch (e) {
          // already finished
        }
      });
    },
  };

  BC.define(def);
})();
