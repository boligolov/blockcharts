(function () {
  const NS = 'http://www.w3.org/2000/svg';
  let clipSeq = 0;
  let fadeSeq = 0;

  /** What one paint needs to share between primitives: the <defs> and the fade gradients made so far. */
  interface Paint {
    defs: Element;
    plot: BC.Rect;
    fades: Map<string, string>;
  }

  function el(name: string): Element {
    return document.createElementNS(NS, name);
  }

  function num(node: Element, name: string, v: number | undefined): void {
    if (v !== undefined) node.setAttribute(name, String(v));
  }

  /** A vertical gradient from the fill color (at the top of the plot) to transparent (at its bottom); one per color and
   *  opacity per paint. The color goes into a style attribute, where CSS variables resolve. */
  function fadeOf(fill: string, opacity: number, pt: Paint): string {
    const key = fill + '|' + opacity;
    const known = pt.fades.get(key);
    if (known) return known;
    const id = `bc-fade-${++fadeSeq}`;
    const grad = el('linearGradient');
    grad.setAttribute('id', id);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', '0');
    grad.setAttribute('x2', '0');
    num(grad, 'y1', pt.plot.y);
    num(grad, 'y2', pt.plot.y + pt.plot.h);
    for (const [offset, alpha] of [[0, opacity], [1, 0]]) {
      const stop = el('stop');
      stop.setAttribute('offset', String(offset));
      stop.setAttribute('style', `stop-color:${fill.replace(/[;{}<>]/g, '')};stop-opacity:${alpha}`);
      grad.appendChild(stop);
    }
    pt.defs.appendChild(grad);
    const url = `url(#${id})`;
    pt.fades.set(key, url);
    return url;
  }

  function applyStyle(node: Element, s: BC.Style | undefined, pt: Paint): void {
    if (!s) return;
    if (s.fill !== undefined && s.fade && s.fill !== 'none') {
      node.setAttribute('fill', fadeOf(s.fill, s.fillOpacity === undefined ? 1 : s.fillOpacity, pt));
    } else if (s.fill !== undefined) node.setAttribute('fill', s.fill);
    if (s.stroke !== undefined) node.setAttribute('stroke', s.stroke);
    num(node, 'stroke-width', s.strokeWidth);
    if (s.strokeDash) node.setAttribute('stroke-dasharray', s.strokeDash.join(' '));
    num(node, 'opacity', s.opacity);
    if (!s.fade) num(node, 'fill-opacity', s.fillOpacity);
    if (s.strokeLinejoin) node.setAttribute('stroke-linejoin', s.strokeLinejoin);
    if (s.strokeLinecap) node.setAttribute('stroke-linecap', s.strokeLinecap);
  }

  function clipped(node: Element, clip: BC.Rect, defs: Element): void {
    const id = `bc-clip-${++clipSeq}`;
    const cp = el('clipPath');
    cp.setAttribute('id', id);
    const r = el('rect');
    num(r, 'x', clip.x);
    num(r, 'y', clip.y);
    num(r, 'width', clip.w);
    num(r, 'height', clip.h);
    cp.appendChild(r);
    defs.appendChild(cp);
    node.setAttribute('clip-path', `url(#${id})`);
  }

  function build(p: BC.Prim, pt: Paint): Element {
    let node: Element;
    switch (p.type) {
      case 'path':
        node = el('path');
        node.setAttribute('d', p.d);
        break;
      case 'rect':
        node = el('rect');
        num(node, 'x', p.x);
        num(node, 'y', p.y);
        num(node, 'width', p.w);
        num(node, 'height', p.h);
        num(node, 'rx', p.r);
        break;
      case 'circle':
        node = el('circle');
        num(node, 'cx', p.cx);
        num(node, 'cy', p.cy);
        num(node, 'r', p.r);
        break;
      case 'text':
        node = el('text');
        num(node, 'x', p.x);
        num(node, 'y', p.y);
        num(node, 'font-size', p.size);
        if (p.weight !== undefined) node.setAttribute('font-weight', String(p.weight));
        if (p.anchor) node.setAttribute('text-anchor', p.anchor);
        if (p.baseline) node.setAttribute('dominant-baseline', p.baseline);
        if (p.rotate) node.setAttribute('transform', `rotate(${p.rotate} ${p.x} ${p.y})`);
        node.textContent = p.text;
        break;
      case 'g':
        node = el('g');
        if (p.translate) node.setAttribute('transform', `translate(${p.translate[0]} ${p.translate[1]})`);
        if (p.clip) clipped(node, p.clip, pt.defs);
        for (const c of p.children) node.appendChild(build(c, pt));
        break;
    }
    applyStyle(node, p.style, pt);
    if (p.cls) node.setAttribute('class', p.cls);
    if (p.data) for (const k of Object.keys(p.data)) node.setAttribute('data-' + k, p.data[k]);
    if (p.ref) {
      node.setAttribute('data-bc-mark', String(p.ref.mark));
      node.setAttribute('data-bc-row', String(p.ref.row));
    }
    if (p.title) {
      const t = el('title');
      t.textContent = p.title;
      node.appendChild(t);
    }
    return node;
  }

  const def: BC.RendererDef = {
    role: 'renderer',
    type: 'svg',
    version: 4,
    doc: 'Draws a display list as one <svg> scaled to its container via viewBox. Paths have no implicit fill: marks set `fill: "none"` for strokes. A style with `fade` gets a vertical gradient over the plot, from the fill color to transparent.',
    render(list, host) {
      const svg = el('svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('role', 'img');
      svg.setAttribute('style', 'display:block;height:auto');
      const paint = (l: BC.DisplayList) => {
        svg.textContent = '';
        svg.setAttribute('viewBox', `0 0 ${l.size.w} ${l.size.h}`);
        const defs = el('defs');
        svg.appendChild(defs);
        const pt: Paint = { defs, plot: l.plot, fades: new Map() };
        for (const layer of l.layers) {
          const g = el('g');
          g.setAttribute('data-bc-layer', layer.name);
          if (layer.clip) clipped(g, layer.clip, defs);
          for (const p of layer.prims) g.appendChild(build(p, pt));
          svg.appendChild(g);
        }
      };
      paint(list);
      host.appendChild(svg);
      return {
        root: svg,
        update: paint,
        destroy() {
          if (svg.parentNode) svg.parentNode.removeChild(svg);
        },
      };
    },
  };

  BC.define(def);
})();
