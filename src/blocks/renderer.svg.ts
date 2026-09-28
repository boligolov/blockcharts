(function () {
  const NS = 'http://www.w3.org/2000/svg';
  let clipSeq = 0;

  function el(name: string): Element {
    return document.createElementNS(NS, name);
  }

  function num(node: Element, name: string, v: number | undefined): void {
    if (v !== undefined) node.setAttribute(name, String(v));
  }

  function applyStyle(node: Element, s?: BC.Style): void {
    if (!s) return;
    if (s.fill !== undefined) node.setAttribute('fill', s.fill);
    if (s.stroke !== undefined) node.setAttribute('stroke', s.stroke);
    num(node, 'stroke-width', s.strokeWidth);
    if (s.strokeDash) node.setAttribute('stroke-dasharray', s.strokeDash.join(' '));
    num(node, 'opacity', s.opacity);
    num(node, 'fill-opacity', s.fillOpacity);
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

  function build(p: BC.Prim, defs: Element): Element {
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
        if (p.clip) clipped(node, p.clip, defs);
        for (const c of p.children) node.appendChild(build(c, defs));
        break;
    }
    applyStyle(node, p.style);
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
    version: 3,
    doc: 'Draws a display list as one <svg> scaled to its container via viewBox. Paths have no implicit fill: marks set `fill: "none"` for strokes.',
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
        for (const layer of l.layers) {
          const g = el('g');
          g.setAttribute('data-bc-layer', layer.name);
          if (layer.clip) clipped(g, layer.clip, defs);
          for (const p of layer.prims) g.appendChild(build(p, defs));
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
