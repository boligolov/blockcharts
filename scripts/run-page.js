// Runs a composed page's scripts the way a browser would (fake DOM, real core and blocks) and mounts it.
// Shared by the composer and skill tests.
const vm = require('vm');
const { El, createDocument, FakePath2D } = require('./fake-dom.js');

function runPage(html, codeOverride) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], text: m[2] }));
  const code = codeOverride === undefined ? scripts.filter((s) => !s.attrs.includes('application/json')) : [{ attrs: '', text: codeOverride }];
  const dataEl = scripts.find((s) => s.attrs.includes('id="bc-data"'));
  const chartEls = scripts.filter((s) => s.attrs.includes('data-bc-chart'));

  const doc = createDocument({
    querySelectorAll: (sel) => (sel === 'script#bc-data' ? [dataNode] : sel === 'script[data-bc-chart]' ? chartNodes : []),
  });
  const body = new El('body', doc);
  const dataNode = Object.assign(new El('script', doc), { text: dataEl.text });
  const chartNodes = chartEls.map((s) => Object.assign(new El('script', doc), { text: s.text }));
  [dataNode, ...chartNodes].forEach((n) => body.appendChild(n));

  const errors = [];
  const sandbox = {
    Path2D: FakePath2D, document: doc, console: { warn() {}, error: (...a) => errors.push(a.join(' ')), log() {} }, setTimeout() {}, getComputedStyle: () => ({ position: 'static' }),
    // what a browser provides for encoded datasets
    atob, Blob, DecompressionStream, TextDecoder,
  };
  vm.createContext(sandbox);
  for (const s of code) vm.runInContext(s.text, sandbox);
  return { BC: sandbox.BC, handles: sandbox.BC.mount(doc), body, errors };
}
const countTags = (el, tag) => { let n = el.tag === tag ? 1 : 0; for (const c of el.children) n += countTags(c, tag); return n; };

module.exports = { runPage, countTags };
