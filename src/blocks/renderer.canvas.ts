(function () {
  const MAX_DPR = 3;
  const MAX_SIDE = 16384; // browsers refuse or blank canvases beyond about this
  const DEFAULT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const DEFAULT_SIZE = 12;
  const TAU = Math.PI * 2;

  type Box = [number, number, number, number];
  type Inherited = Pick<BC.Style, 'fill' | 'stroke' | 'strokeWidth' | 'strokeDash' | 'fillOpacity' | 'strokeLinejoin' | 'strokeLinecap'>;

  const def: BC.RendererDef = {
    role: 'renderer',
    type: 'canvas',
    version: 2,
    doc: 'Draws a display list on one <canvas>, scaled to its container and sharp on high-density screens. Meant for charts with tens of thousands of marks (a big scatter plot), where an SVG element per mark gets slow: about 5 times faster to redraw at 50,000 points. A single long line is one path either way, so it gains little; decimate it instead. It reads the same CSS variables as the SVG renderer (themes, dark mode) and follows changes of the color scheme, but a canvas has no elements: CSS classes and native tooltips on marks do not exist here. Zoom, brush, tooltip and legend filter work as usual, and so do fading fills.',
    render(list, host) {
      const doc = host.ownerDocument || document;
      const canvas = doc.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('style', 'display:block;width:100%;height:auto');
      const c2d = canvas.getContext('2d');
      if (!c2d) throw new Error('renderer.canvas: this environment has no 2D canvas context');
      const ctx: CanvasRenderingContext2D = c2d;

      let current = list;
      let colors = new Map<string, string | null>();
      let family = DEFAULT_FONT;
      let styles: CSSStyleDeclaration | null = null;
      let destroyed = false;

      // ── colors: CSS variables are resolved here, because a canvas cannot read them itself ──
      // An unparseable color assigned to fillStyle is silently ignored (the previous one stays), so validity is tested by
      // assigning it after two different sentinels: only an invalid value leaves the sentinel in place both times.
      const valid = (v: string): boolean => {
        ctx.fillStyle = '#010203';
        ctx.fillStyle = v;
        const a = ctx.fillStyle;
        ctx.fillStyle = '#040506';
        ctx.fillStyle = v;
        return a === ctx.fillStyle;
      };
      const property = (name: string): string => (styles && typeof styles.getPropertyValue === 'function' ? styles.getPropertyValue(name).trim() : '');
      const resolve = (value: string): string | null => {
        const known = colors.get(value);
        if (known !== undefined) return known;
        let v = value.trim();
        for (let hops = 0; hops < 8; hops++) {
          const m = /^var\(\s*(--[^\s,)]+)\s*(?:,([\s\S]*))?\)$/.exec(v);
          if (!m) break;
          v = property(m[1]) || (m[2] !== undefined ? m[2].trim() : '');
        }
        let out: string | null = null;
        if (v && v !== 'none') {
          if (v.toLowerCase() === 'currentcolor') v = (styles && (styles as { color?: string }).color) || '#000';
          if (valid(v)) out = v;
        }
        colors.set(value, out);
        return out;
      };

      // the same color with alpha 0, for the transparent end of a fade: the context writes any valid color back as
      // #rrggbb or rgba(r, g, b, a), which is easy to take apart
      const clear = (color: string): string => {
        ctx.fillStyle = color;
        const n = String(ctx.fillStyle);
        const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(n);
        if (hex) return `rgba(${parseInt(hex[1], 16)}, ${parseInt(hex[2], 16)}, ${parseInt(hex[3], 16)}, 0)`;
        const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(n);
        return rgb ? `rgba(${rgb[1].trim()}, ${rgb[2].trim()}, ${rgb[3].trim()}, 0)` : 'rgba(0, 0, 0, 0)';
      };
      /** A fill that fades from the color at the top of the plot to transparent at its bottom (Style.fade). */
      const fadeOf = (color: string): CanvasGradient => {
        const p = current.plot;
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        g.addColorStop(0, color);
        g.addColorStop(1, clear(color));
        return g;
      };

      const fontOf = (p: BC.TextPrim): string => {
        const weight = p.weight === undefined ? 'normal' : String(p.weight);
        return `${weight} ${p.size === undefined ? DEFAULT_SIZE : p.size}px ${family}`;
      };
      const setText = (p: BC.TextPrim) => {
        ctx.font = fontOf(p);
        ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
        ctx.textBaseline = p.baseline === 'middle' ? 'middle' : p.baseline === 'hanging' ? 'hanging' : 'alphabetic';
      };

      // ── drawing ──
      const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
        const rr = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(x, y, w, h, rr);
          return;
        }
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
      };

      const drawPrim = (p: BC.Prim, alpha: number, inh: Inherited): void => {
        const s = p.style || {};
        const own: Inherited = {
          fill: s.fill !== undefined ? s.fill : inh.fill,
          stroke: s.stroke !== undefined ? s.stroke : inh.stroke,
          strokeWidth: s.strokeWidth !== undefined ? s.strokeWidth : inh.strokeWidth,
          strokeDash: s.strokeDash !== undefined ? s.strokeDash : inh.strokeDash,
          fillOpacity: s.fillOpacity !== undefined ? s.fillOpacity : inh.fillOpacity,
          strokeLinejoin: s.strokeLinejoin !== undefined ? s.strokeLinejoin : inh.strokeLinejoin,
          strokeLinecap: s.strokeLinecap !== undefined ? s.strokeLinecap : inh.strokeLinecap,
        };
        const a = alpha * (s.opacity === undefined ? 1 : s.opacity);
        if (p.type === 'g') {
          ctx.save();
          if (p.translate) ctx.translate(p.translate[0], p.translate[1]);
          if (p.clip) {
            ctx.beginPath();
            ctx.rect(p.clip.x, p.clip.y, p.clip.w, p.clip.h);
            ctx.clip();
          }
          for (const child of p.children) drawPrim(child, a, own);
          ctx.restore();
          return;
        }

        // shapes are black unless told otherwise, and unstroked (the SVG defaults the marks were written against)
        const fill = own.fill === undefined ? '#000' : resolve(own.fill);
        const stroke = own.stroke === undefined ? null : resolve(own.stroke);
        ctx.lineWidth = own.strokeWidth === undefined ? 1 : own.strokeWidth;
        ctx.setLineDash(own.strokeDash || []);
        ctx.lineJoin = own.strokeLinejoin || 'miter';
        ctx.lineCap = own.strokeLinecap || 'butt';
        const paint = (path?: Path2D) => {
          if (fill) {
            ctx.globalAlpha = a * (own.fillOpacity === undefined ? 1 : own.fillOpacity);
            ctx.fillStyle = s.fade ? fadeOf(fill) : fill;
            if (path) ctx.fill(path); else ctx.fill();
          }
          if (stroke) {
            ctx.globalAlpha = a;
            ctx.strokeStyle = stroke;
            if (path) ctx.stroke(path); else ctx.stroke();
          }
        };

        switch (p.type) {
          case 'path':
            paint(new Path2D(p.d));
            break;
          case 'rect':
            if (p.r) roundedRect(p.x, p.y, p.w, p.h, p.r);
            else {
              ctx.beginPath();
              ctx.rect(p.x, p.y, p.w, p.h);
            }
            paint();
            break;
          case 'circle':
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, p.r, 0, TAU);
            paint();
            break;
          case 'text':
            setText(p);
            ctx.save();
            ctx.translate(p.x, p.y);
            if (p.rotate) ctx.rotate((p.rotate * Math.PI) / 180);
            if (fill) {
              ctx.globalAlpha = a * (own.fillOpacity === undefined ? 1 : own.fillOpacity);
              ctx.fillStyle = fill;
              ctx.fillText(p.text, 0, 0);
            }
            if (stroke) {
              ctx.globalAlpha = a;
              ctx.strokeStyle = stroke;
              ctx.strokeText(p.text, 0, 0);
            }
            ctx.restore();
            break;
        }
        ctx.globalAlpha = 1;
      };

      const paint = (l: BC.DisplayList) => {
        if (destroyed) return;
        current = l;
        colors = new Map();
        styles = typeof getComputedStyle === 'function' ? getComputedStyle(host) : null;
        family = (styles && styles.fontFamily) || DEFAULT_FONT;

        // the backing store follows the size on screen and the screen density: sharp lines, and a chart moved to another
        // screen or resized is repainted at its new size
        const cssWidth = host.clientWidth || l.size.w;
        const density = Math.min(MAX_DPR, Math.max(1, (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1));
        const width = Math.max(1, Math.min(MAX_SIDE, Math.round(cssWidth * density)));
        const k = width / l.size.w;
        const height = Math.max(1, Math.min(MAX_SIDE, Math.round(l.size.h * k)));
        canvas.width = width; // assigning the size also clears the canvas
        canvas.height = height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.setTransform(k, 0, 0, k, 0, 0);

        for (const layer of l.layers) {
          ctx.save();
          if (layer.clip) {
            ctx.beginPath();
            ctx.rect(layer.clip.x, layer.clip.y, layer.clip.w, layer.clip.h);
            ctx.clip();
          }
          for (const p of layer.prims) drawPrim(p, 1, {});
          ctx.restore();
        }
      };

      // ── what is under the pointer: the `data` of the topmost primitive (a legend item tells the filter which value it is) ──
      const boxOf = (p: BC.Prim): Box | null => {
        switch (p.type) {
          case 'rect': return [p.x, p.y, p.x + p.w, p.y + p.h];
          case 'circle': return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
          case 'text': {
            setText(p);
            const w = ctx.measureText(p.text).width;
            const h = p.size === undefined ? DEFAULT_SIZE : p.size;
            const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
            const y0 = p.baseline === 'middle' ? p.y - h / 2 : p.baseline === 'hanging' ? p.y : p.y - h;
            return [x0, y0, x0 + w, y0 + h];
          }
          case 'g': {
            let out: Box | null = null;
            for (const child of p.children) {
              const b = boxOf(child);
              if (!b) continue;
              out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : b;
            }
            const t = p.translate || [0, 0];
            return out ? [out[0] + t[0], out[1] + t[1], out[2] + t[0], out[3] + t[1]] : null;
          }
          default: return null; // a path has no cheap bounding box; nothing that needs to be found is one
        }
      };
      const find = (p: BC.Prim, x: number, y: number): Record<string, string> | null => {
        if (p.type === 'g') {
          const t = p.translate || [0, 0];
          for (let i = p.children.length - 1; i >= 0; i--) {
            const found = find(p.children[i], x - t[0], y - t[1]);
            if (found) return found;
          }
        }
        if (!p.data) return null;
        const b = boxOf(p);
        return b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] ? Object.assign({}, p.data) : null;
      };
      const dataAt = (ev: MouseEvent): Record<string, string> | null => {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const x = ((ev.clientX - r.left) * current.size.w) / r.width;
        const y = ((ev.clientY - r.top) * current.size.h) / r.height;
        for (let i = current.layers.length - 1; i >= 0; i--) {
          const prims = current.layers[i].prims;
          for (let j = prims.length - 1; j >= 0; j--) {
            const found = find(prims[j], x, y);
            if (found) return found;
          }
        }
        return null;
      };

      // ── things that change how the same list must be painted: the host's width, the color scheme, a theme switch ──
      const teardown: Array<() => void> = [];
      const repaint = () => paint(current);
      const G = globalThis as any;
      if (typeof G.ResizeObserver === 'function') {
        let width = host.clientWidth;
        const ro = new G.ResizeObserver(() => {
          if (host.clientWidth === width) return;
          width = host.clientWidth;
          repaint();
        });
        ro.observe(host);
        teardown.push(() => ro.disconnect());
      }
      if (typeof G.matchMedia === 'function') {
        const mq = G.matchMedia('(prefers-color-scheme: dark)');
        if (mq && typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', repaint);
          teardown.push(() => mq.removeEventListener('change', repaint));
        }
      }
      if (typeof G.MutationObserver === 'function' && doc.documentElement) {
        const mo = new G.MutationObserver(repaint);
        mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
        teardown.push(() => mo.disconnect());
      }

      paint(list);
      host.appendChild(canvas);
      return {
        root: canvas,
        update: paint,
        dataAt,
        destroy() {
          destroyed = true;
          for (const fn of teardown) fn();
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        },
      };
    },
  };

  BC.define(def);
})();
