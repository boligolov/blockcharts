// A small fake DOM: enough for the core, the SVG renderer and the interactions to build and draw a chart without a
// browser. Used by the composer to try every chart out before it writes a page, and by the tests that run composed pages.

// What a canvas renderer does to a 2D context, recorded: `calls` lists every drawing call with the style it was made under.
// An unparseable color is ignored by the setter, like in a browser (the previous color stays).
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i;
const NOT_COLORS = new Set(['none', 'notacolor', 'inherit', 'initial']);
class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
    this.stack = [];
    this._fill = '#000000';
    this._stroke = '#000000';
    Object.assign(this, { globalAlpha: 1, lineWidth: 1, lineJoin: 'miter', lineCap: 'butt', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', dash: [] });
  }
  get fillStyle() { return this._fill; }
  set fillStyle(v) { if (typeof v === 'string' && COLOR.test(v.trim()) && !NOT_COLORS.has(v.trim())) this._fill = v.trim().toLowerCase(); }
  get strokeStyle() { return this._stroke; }
  set strokeStyle(v) { if (typeof v === 'string' && COLOR.test(v.trim()) && !NOT_COLORS.has(v.trim())) this._stroke = v.trim().toLowerCase(); }
  _style() {
    return { fillStyle: this._fill, strokeStyle: this._stroke, globalAlpha: this.globalAlpha, lineWidth: this.lineWidth, lineJoin: this.lineJoin, lineCap: this.lineCap, dash: this.dash.slice(), font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline };
  }
  _rec(op, args, withStyle) { this.calls.push(Object.assign({ op, args }, withStyle ? this._style() : {})); }
  save() { this.stack.push(this._style()); this._rec('save', []); }
  restore() {
    const s = this.stack.pop();
    if (s) { this._fill = s.fillStyle; this._stroke = s.strokeStyle; this.globalAlpha = s.globalAlpha; this.lineWidth = s.lineWidth; this.font = s.font; }
    this._rec('restore', []);
  }
  setLineDash(d) { this.dash = d.slice(); }
  measureText(t) { const size = parseFloat(this.font.match(/([\d.]+)px/) ? this.font.match(/([\d.]+)px/)[1] : '10'); return { width: String(t).length * size * 0.6 }; }
  fill(path) { this._rec('fill', path ? [path.d] : [], true); }
  stroke(path) { this._rec('stroke', path ? [path.d] : [], true); }
  fillText(t, x, y) { this._rec('fillText', [t, x, y], true); }
  strokeText(t, x, y) { this._rec('strokeText', [t, x, y], true); }
}
for (const op of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'rect', 'roundRect', 'clip', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect']) {
  FakeContext.prototype[op] = function (...args) { this._rec(op, args); };
}
class FakePath2D { constructor(d) { this.d = d; } }

class El {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.text = '';
    this.listeners = {};
    this._doc = doc;
  }
  fire(type, ev) { for (const fn of (this.listeners[type] || []).slice()) fn(Object.assign({ target: this, preventDefault() {} }, ev)); }
  getContext(kind) { if (this.tag !== 'canvas' || kind !== '2d') return null; if (!this._ctx) this._ctx = new FakeContext(this); return this._ctx; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  insertBefore(c, ref) {
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; }
  setPointerCapture() {}
  closest() { return null; }
  get nextSibling() { const s = this.parentNode ? this.parentNode.children : []; return s[s.indexOf(this) + 1] || null; }
  set textContent(t) { this.text = String(t); this.children = []; }
  get textContent() { return this.text; }
  get attributes() { return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] })); }
  get ownerDocument() { return this._doc; }
  serialize() {
    const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
    const inner = this.text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + this.children.map((c) => c.serialize()).join('');
    return `<${this.tag}${attrs}>${inner}</${this.tag}>`;
  }
}

/** A document whose elements are El. `extra` overrides or adds members (querySelectorAll, ...). */
function createDocument(extra) {
  const doc = {
    readyState: 'complete',
    createElement: (t) => new El(t, doc),
    createElementNS: (_ns, t) => new El(t, doc),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  return Object.assign(doc, extra || {});
}

module.exports = { El, createDocument, FakeContext, FakePath2D };
