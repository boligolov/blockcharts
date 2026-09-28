(function () {
  type Pair = [number, number];

  const def: BC.InteractionDef = {
    role: 'interaction',
    type: 'zoom-controls',
    version: 1,
    doc: 'A small button bar over one corner of the chart: "100%" clears the controlled scales back to their full domain; "−"/"+" step a continuous one in and out around the center of its current view. A band scale only gets "100%" (there is nothing continuous to step).',
    params: {
      scales: { kind: 'list', default: ['x'], doc: 'Names of the scales to control, the same as interaction.zoom and interaction.brush. Default ["x"] — set it to match whichever scales those use, so "100%" undoes everything they did.' },
      fit: { kind: 'list', doc: 'Scales to refit after a "−"/"+" click (usually ["y"]), the same as interaction.zoom\'s `fit`.' },
      step: { kind: 'number', default: 0.5, doc: 'How much "−"/"+" grow or shrink a continuous scale\'s span, as a factor of the current span (0.5 = double/halve).' },
      maxZoom: { kind: 'number', default: 50, doc: 'How far "+" can go, as a multiple of the full domain.' },
      corner: { kind: 'enum', values: ['top-right', 'top-left', 'bottom-right', 'bottom-left'], default: 'top-right', doc: 'Which corner of the chart the buttons sit in.' },
    },
    attach(spec, live) {
      const requested = Array.isArray(spec.scales) ? (spec.scales as unknown[]).filter((n): n is string => typeof n === 'string') : ['x'];
      const names = requested.filter((n) => {
        const s = live.scales[n];
        const ok = !!s && live.orientation(n) !== null && (!!s.invert || s.bandwidth !== undefined);
        if (!ok) console.warn(`[blockcharts] interaction.zoom-controls: scale "${n}" is not a positional scale, ignored`);
        return ok;
      });
      if (!names.length) return;
      const zoomable = names.filter((n) => !!live.scales[n].invert);

      const fitNames = (Array.isArray(spec.fit) ? (spec.fit as unknown[]) : []).filter((n): n is string => {
        const ok = typeof n === 'string' && !!live.scales[n] && names.indexOf(n) < 0;
        if (!ok && typeof n === 'string') console.warn(`[blockcharts] interaction.zoom-controls: cannot fit scale "${n}"`);
        return ok;
      });
      const refit = () => { for (const f of fitNames) live.setView(f, live.fit(f, names[0])); };

      const step = typeof spec.step === 'number' && spec.step > 0 && spec.step < 1 ? spec.step : 0.5;
      const maxZoom = typeof spec.maxZoom === 'number' && spec.maxZoom > 1 ? spec.maxZoom : 50;
      const corner = spec.corner === 'top-left' || spec.corner === 'bottom-right' || spec.corner === 'bottom-left' ? spec.corner : 'top-right';
      const [vSide, hSide] = corner.split('-') as ['top' | 'bottom', 'right' | 'left'];

      const reset = () => {
        for (const name of names) live.setView(name, null);
        refit();
      };
      const zoomBy = (factor: number) => {
        for (const name of zoomable) {
          const scale = live.scales[name];
          const [b0, b1] = scale.baseDomain() as Pair;
          const v = live.getView()[name] as Pair;
          const d0 = Number(v[0]);
          const d1 = Number(v[1]);
          const mid = (d0 + d1) / 2;
          const span = Math.min(b1 - b0, Math.max((b1 - b0) / maxZoom, (d1 - d0) * factor));
          let n0 = mid - span / 2;
          let n1 = mid + span / 2;
          if (n0 < b0) {
            n1 += b0 - n0;
            n0 = b0;
          }
          if (n1 > b1) {
            n0 -= n1 - b1;
            n1 = b1;
          }
          live.setView(name, span >= (b1 - b0) * (1 - 1e-9) ? null : [n0, n1]);
        }
        refit();
      };

      const host = live.host;
      const doc = host.ownerDocument || document;

      const bar = doc.createElement('div');
      bar.setAttribute('class', 'bc-zoom-controls');
      Object.assign(bar.style, {
        position: 'absolute', [vSide]: '8px', [hSide]: '8px', zIndex: '6',
        display: 'flex', gap: '4px', font: '12px/1 system-ui, sans-serif',
      });

      const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('aria-label', title);
        b.title = title;
        Object.assign(b.style, {
          minWidth: '22px', height: '22px', padding: '0 6px', lineHeight: '20px', textAlign: 'center',
          border: '1px solid var(--bc-axis, #ccc)', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap',
          background: 'var(--bc-tooltip-bg, #fff)', color: 'var(--bc-text, #333)',
        });
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          onClick();
        });
        bar.appendChild(b);
        return b;
      };

      button('100%', 'Reset zoom to the full range', reset);
      if (zoomable.length) {
        button('−', 'Zoom out', () => zoomBy(1 / step));
        button('+', 'Zoom in', () => zoomBy(step));
      }

      // The bar is positioned against the host, like the tooltip and the brush overlay.
      const releasePosition = live.claimPosition();
      host.appendChild(bar);

      live.cleanup(() => {
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        releasePosition();
      });
    },
  };

  BC.define(def);
})();
