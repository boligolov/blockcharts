// Tests for renderer.canvas: what it draws, how it reads CSS variables, sizing and density, hit-testing for the legend, and the
// interactions on a canvas. Runs the real core and blocks against a fake canvas that records every call. Run: npm test
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { El, createDocument, FakePath2D } = require('./fake-dom.js');

let passed = 0;
let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

const dist = path.join(__dirname, '../dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const code = [manifest.core.file, ...Object.values(manifest.blocks).map((b) => b.file)].map((f) => ({
  f,
  text: fs.readFileSync(path.join(dist, f), 'utf8'),
}));
const flush = () => new Promise((r) => setTimeout(r, 15));

/** A page with the real library in it. vars: what getComputedStyle answers for CSS variables; family: the font family of
 *  every element; fonts: the page's document.fonts (none: no font can be measured, as in the composer). */
function world(options) {
  const o = options || {};
  const doc = createDocument();
  if (o.fonts) doc.fonts = o.fonts;
  const errors = [];
  const sandbox = {
    console: { warn: (...a) => errors.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')), log() {} },
    setTimeout,
    clearTimeout,
    Path2D: FakePath2D,
    document: doc,
    devicePixelRatio: o.dpr || 1,
    getComputedStyle: () => ({
      position: 'static',
      fontFamily: o.family || 'Test Sans',
      getPropertyValue: (n) => (o.vars || {})[n] || '',
    }),
  };
  Object.assign(sandbox, o.globals || {});
  if (o.noRoundRect) require('./fake-dom.js').FakeContext.prototype.roundRect = undefined;
  vm.createContext(sandbox);
  for (const { f, text } of code) vm.runInContext(text, sandbox, { filename: f });
  const host = () => {
    const h = new El('div', doc);
    if (o.width) h.clientWidth = o.width;
    return h;
  };
  return { BC: sandbox.BC, sandbox, doc, host, errors };
}
const restoreRoundRect = (fn) => async () => {
  const { FakeContext } = require('./fake-dom.js');
  const saved = FakeContext.prototype.roundRect;
  try {
    await fn();
  } finally {
    FakeContext.prototype.roundRect = saved;
  }
};

const ctxOf = (host) => host.children[0].getContext('2d');
/** Calls of the last complete frame: everything after the last clearRect. */
const frame = (ctx) => {
  let at = -1;
  ctx.calls.forEach((c, i) => {
    if (c.op === 'clearRect') at = i;
  });
  return ctx.calls.slice(at + 1);
};
const ops = (calls, op) => calls.filter((c) => c.op === op);
const arr = (a) => Array.from(a);

const ROWS = [
  { k: 'a', v: 3 },
  { k: 'b', v: 6 },
  { k: 'c', v: 4 },
];
const bars = (extra) => ({
  data: 'd',
  renderer: 'canvas',
  size: [400, 240],
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  marks: [{ type: 'rect', x: 'k', y: 'v' }],
  ...extra,
});
const withGuides = (extra) =>
  bars({
    guides: [
      { type: 'grid', scale: 'y' },
      { type: 'axis', line: 'on', ticks: true, scale: 'x' },
      { type: 'axis', line: 'on', ticks: true, scale: 'y' },
    ],
    ...extra,
  });

const draw = (w, spec, rows) => {
  w.BC.data('d', rows || ROWS);
  const host = w.host();
  const h = w.BC.chart(host, spec);
  return { host, h, ctx: host.children[0] && host.children[0].getContext ? ctxOf(host) : null };
};

test('canvas: a chart is one <canvas>, and the bars, grid, axes and labels are drawn on it', () => {
  const w = world();
  const { host, h, ctx } = draw(w, withGuides());
  assert.deepStrictEqual(arr(h.diagnostics), []);
  const canvas = host.children[0];
  assert.strictEqual(canvas.tag, 'canvas');
  assert.strictEqual(canvas.attrs.role, 'img');
  assert(!('aria-label' in canvas.attrs), 'no title, no alt: no name');
  const named = draw(w, withGuides({ alt: 'Three bars' })).host.children[0];
  assert.strictEqual(named.attrs['aria-label'], 'Three bars', 'a screen reader hears it by its alt');
  assert(/display:block;width:100%;height:auto/.test(canvas.attrs.style), 'scales with its container');
  assert.strictEqual(host.children.length, 1);
  const f = frame(ctx);
  const filled = ops(f, 'fill').filter((c) => c.fillStyle === '#3a6fe4');
  assert.strictEqual(filled.length, 3, 'one filled rectangle per bar, in the theme color');
  assert.strictEqual(ops(f, 'rect').filter((c) => c.args[2] > 0 && c.args[3] > 0).length >= 3, true);
  assert(
    ops(f, 'stroke').some((c) => typeof c.args[0] === 'string' && /^M/.test(c.args[0])),
    'grid and axis lines are paths',
  );
  const texts = ops(f, 'fillText').map((c) => c.args[0]);
  for (const t of ['a', 'b', 'c', '0']) assert(texts.includes(t), `label ${t} in ${texts}`);
  assert(
    ops(f, 'fillText').every((c) => /px Test Sans$/.test(c.font)),
    'the font of the page is used',
  );
});

test('canvas: colors come from CSS variables of the page, with their fallbacks, and a bad color paints nothing', () => {
  const marks = (vars) => {
    const w = world({ vars });
    return frame(draw(w, bars()).ctx);
  };
  const fills = (f) => ops(f, 'fill').map((c) => c.fillStyle);
  assert.deepStrictEqual(fills(marks({})), ['#3a6fe4', '#3a6fe4', '#3a6fe4'], 'no variable: the fallback written in the mark');
  assert.deepStrictEqual(fills(marks({ '--bc-c0': '#ff0000' })), ['#ff0000', '#ff0000', '#ff0000'], 'the page decides');
  assert.deepStrictEqual(
    fills(marks({ '--bc-c0': 'var(--brand, #00ff00)' })),
    ['#00ff00', '#00ff00', '#00ff00'],
    'a variable that names another, with its own fallback',
  );
  assert.deepStrictEqual(
    fills(marks({ '--bc-c0': 'var(--a, var(--b, rgb(1, 2, 3)))' })),
    ['rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'rgb(1, 2, 3)'],
    'fallbacks all the way down',
  );
  assert.deepStrictEqual(fills(marks({ '--bc-c0': 'notacolor' })), [], 'an invalid color is not silently replaced by the previous one');
  assert.deepStrictEqual(fills(marks({ '--bc-c0': 'none' })), [], 'none paints nothing');
});

test('canvas: a fading area is filled by a gradient over the plot, from the color to the same color transparent', () => {
  const lines = (vars) => {
    const w = world({ vars });
    w.BC.data('d', [
      { t: 0, v: 3 },
      { t: 1, v: 6 },
      { t: 2, v: 4 },
    ]);
    const host = w.host();
    w.BC.chart(host, {
      data: 'd',
      renderer: 'canvas',
      size: [400, 240],
      scales: { x: { type: 'linear' }, y: { type: 'linear', zero: true } },
      marks: [{ type: 'area', x: 't', y: 'v', fade: true, curve: 'smooth' }],
    });
    return ops(frame(ctxOf(host)), 'fill');
  };
  const [hex] = lines({ '--bc-c0': '#3a6fe4' });
  assert(hex.fillStyle && Array.isArray(hex.fillStyle.stops), 'a gradient, not a flat color');
  assert.deepStrictEqual(
    hex.fillStyle.stops,
    [
      [0, '#3a6fe4'],
      [1, 'rgba(58, 111, 228, 0)'],
    ],
    'the color, then the same color with alpha 0',
  );
  assert.deepStrictEqual(hex.fillStyle.line, [0, 16, 0, 224], 'vertical, over the plot');
  assert.strictEqual(hex.globalAlpha, 0.45, 'at the fill opacity');
  const [rgb] = lines({ '--bc-c0': 'rgb(1, 2, 3)' });
  assert.deepStrictEqual(rgb.fillStyle.stops[1], [1, 'rgba(1, 2, 3, 0)'], 'an rgb() color too');
  assert.deepStrictEqual(lines({ '--bc-c0': 'notacolor' }), [], 'an invalid color paints nothing, faded or not');
});

test('canvas: size follows the container and the screen density, and is capped', () => {
  const size = (opts) => {
    // the renderer's own scaling, with the core's relayout to a narrow container turned off
    const { host, ctx } = draw(world(opts), bars({ responsive: false }));
    const c = host.children[0];
    return { w: c.width, h: c.height, transform: ops(ctx.calls, 'setTransform').pop().args, clear: ops(ctx.calls, 'clearRect').pop().args };
  };
  assert.deepStrictEqual(
    size({}),
    { w: 400, h: 240, transform: [1, 0, 0, 1, 0, 0].map((v, i) => (i === 0 || i === 3 ? 1 : v)), clear: [0, 0, 400, 240] },
    'no layout: the size of the chart',
  );
  const s = size({ width: 300, dpr: 2 });
  assert.strictEqual(s.w, 600);
  assert.strictEqual(s.h, 360, 'the aspect ratio of the chart');
  assert.deepStrictEqual(s.transform, [1.5, 0, 0, 1.5, 0, 0], 'drawing units stay the chart units');
  assert.deepStrictEqual(s.clear, [0, 0, 600, 360]);
  assert.strictEqual(size({ width: 300, dpr: 5 }).w, 900, 'density is capped at 3');
  assert.strictEqual(size({ width: 300, dpr: 0.5 }).w, 300, 'and never below 1');
  assert.strictEqual(size({ width: 100000 }).w, 16384, 'so is the canvas itself');
});

test('canvas: on a narrow container the core lays the chart out at its width, and the canvas follows', () => {
  const { host, ctx } = draw(world({ width: 300, dpr: 2 }), bars());
  const c = host.children[0];
  assert.deepStrictEqual([c.width, c.height], [600, 480], 'laid out 300 wide, the height kept (240), at density 2');
  assert.deepStrictEqual(
    ops(ctx.calls, 'setTransform').pop().args,
    [2, 0, 0, 2, 0, 0],
    'one chart unit is one CSS pixel: text keeps its size',
  );
});

test('canvas: repaints when the container is resized or the color scheme changes, and stops after destroy', () => {
  let resize,
    observed = 0,
    disconnected = 0,
    media,
    mutation,
    mutationOff = 0;
  const w = world({
    width: 300,
    globals: {
      ResizeObserver: class {
        constructor(fn) {
          resize = fn;
        }
        observe() {
          observed++;
        }
        disconnect() {
          disconnected++;
        }
      },
      matchMedia: () =>
        (media = {
          listeners: [],
          addEventListener(t, fn) {
            this.listeners.push(fn);
          },
          removeEventListener(t, fn) {
            this.listeners = this.listeners.filter((x) => x !== fn);
          },
        }),
      MutationObserver: class {
        constructor(fn) {
          mutation = fn;
        }
        observe() {}
        disconnect() {
          mutationOff++;
        }
      },
    },
  });
  w.doc.documentElement = new El('html', w.doc);
  const { host, h, ctx } = draw(w, bars({ responsive: false }));
  const canvas = host.children[0];
  assert.strictEqual(observed, 2, 'the renderer watches the width, and so does the core, which an update() may make responsive again');
  assert.strictEqual(canvas.width, 300);
  const frames = () => ops(ctx.calls, 'clearRect').length;
  const before = frames();

  resize();
  assert.strictEqual(frames(), before, 'the same width is not repainted');
  host.clientWidth = 500;
  resize();
  assert.strictEqual(canvas.width, 500, 'a new width is');
  assert.strictEqual(frames(), before + 1);
  media.listeners.forEach((fn) => fn());
  assert.strictEqual(frames(), before + 2, 'the color scheme changed');
  mutation();
  assert.strictEqual(frames(), before + 3, 'a theme switch on <html>');

  h.destroy();
  assert.strictEqual(host.children.length, 0, 'the canvas is gone');
  assert.strictEqual(disconnected, 2, 'both observers stop');
  assert.strictEqual(mutationOff, 1);
  assert.strictEqual(media.listeners.length, 0);
  const n = frames();
  resize();
  mutation();
  assert.strictEqual(frames(), n, 'nothing is drawn after destroy');
});

test(
  'canvas: shapes, text, groups, clips and opacity are drawn the way the SVG renderer draws them',
  restoreRoundRect(() => {
    const w = world();
    const host = w.host();
    const list = {
      size: { w: 200, h: 100 },
      plot: { x: 0, y: 0, w: 200, h: 100 },
      layers: [
        {
          name: 'marks',
          clip: { x: 10, y: 10, w: 50, h: 40 },
          prims: [
            { type: 'rect', x: 1, y: 2, w: 30, h: 20 },
            {
              type: 'rect',
              x: 5,
              y: 6,
              w: 30,
              h: 20,
              r: 3,
              style: {
                fill: '#112233',
                stroke: '#445566',
                strokeWidth: 2,
                strokeDash: [4, 2],
                strokeLinejoin: 'round',
                strokeLinecap: 'square',
              },
            },
            { type: 'circle', cx: 9, cy: 8, r: 4, style: { fill: 'none', stroke: '#abcdef' } },
            { type: 'path', d: 'M0 0L5 5', style: { fill: 'none', stroke: '#010101' } },
            { type: 'path', d: 'M0 0L9 9Z', style: { fill: '#ff8800', fillOpacity: 0.5, opacity: 0.5 } },
          ],
        },
        {
          name: 'axes',
          prims: [
            {
              type: 'g',
              translate: [7, 9],
              clip: { x: 0, y: 0, w: 20, h: 20 },
              style: { opacity: 0.5, fill: '#00ff00' },
              children: [
                { type: 'rect', x: 0, y: 0, w: 4, h: 4 },
                { type: 'rect', x: 0, y: 0, w: 4, h: 4, style: { opacity: 0.5, fill: '#0000ff' } },
              ],
            },
            {
              type: 'text',
              x: 20,
              y: 30,
              text: 'Hi',
              size: 12,
              weight: 600,
              anchor: 'end',
              baseline: 'hanging',
              rotate: 90,
              style: { fill: '#333333' },
            },
            { type: 'text', x: 1, y: 2, text: 'Mid', size: 10, anchor: 'middle', baseline: 'middle', style: { fill: '#333333' } },
            { type: 'text', x: 1, y: 2, text: 'plain' },
            { type: 'text', x: 1, y: 2, text: 'outlined', style: { fill: 'none', stroke: '#777777' } },
            {
              type: 'text',
              x: 1,
              y: 2,
              text: 'haloed',
              style: { fill: '#111111', stroke: '#fefefe', strokeWidth: 3, paintOrder: 'stroke' },
            },
            { type: 'text', x: 1, y: 2, text: 'over', style: { fill: '#111111', stroke: '#fefefe' } },
            { type: 'path', d: 'M1 1L2 2Z', style: { fill: '#121212', stroke: '#343434', paintOrder: 'stroke' } },
            {
              type: 'g',
              style: { paintOrder: 'stroke' },
              children: [{ type: 'text', x: 1, y: 2, text: 'inner', style: { fill: '#111111', stroke: '#fefefe' } }],
            },
          ],
        },
      ],
    };
    const handle = w.BC.get('renderer.canvas').render(list, host);
    const ctx = ctxOf(host);
    const f = frame(ctx);
    const at = (op) => ops(f, op);

    // the clip of the layer, once, before its shapes
    const firstClip = f.findIndex((c) => c.op === 'clip');
    assert.deepStrictEqual(f[firstClip - 1].args, [10, 10, 50, 40], 'the layer clip rectangle');

    // no style: black fill, no stroke (the SVG defaults)
    const plain = at('fill')[0];
    assert.strictEqual(plain.fillStyle, '#000');
    assert.strictEqual(plain.lineWidth, 1);
    assert(f.some((c) => c.op === 'rect' && c.args.join() === '1,2,30,20'));

    // rounded rectangle with a full style
    assert(
      ops(f, 'roundRect').some((c) => c.args.join() === '5,6,30,20,3'),
      'roundRect when the browser has it',
    );
    const styled = at('stroke').find((c) => c.strokeStyle === '#445566');
    assert.strictEqual(styled.lineWidth, 2);
    assert.deepStrictEqual(styled.dash, [4, 2]);
    assert.strictEqual(styled.lineJoin, 'round');
    assert.strictEqual(styled.lineCap, 'square');
    assert.strictEqual(at('fill').find((c) => c.fillStyle === '#112233').globalAlpha, 1);

    // circle: an arc all the way round, fill none = only the stroke
    const arc = at('arc')[0];
    assert.deepStrictEqual(arc.args, [9, 8, 4, 0, Math.PI * 2]);
    assert(at('stroke').some((c) => c.strokeStyle === '#abcdef'));
    assert(!at('fill').some((c) => c.fillStyle === '#abcdef'), 'fill "none" is not painted');

    // paths through Path2D; opacity times fillOpacity
    assert(at('stroke').some((c) => c.args[0] === 'M0 0L5 5' && c.strokeStyle === '#010101'));
    const half = at('fill').find((c) => c.args[0] === 'M0 0L9 9Z');
    assert.strictEqual(half.globalAlpha, 0.25, 'opacity 0.5 x fill-opacity 0.5');
    assert.strictEqual(half.fillStyle, '#ff8800');

    // groups: translate, own clip, inherited fill, opacity multiplied down the tree
    const gi = f.findIndex((c) => c.op === 'translate' && c.args.join() === '7,9');
    assert(gi > 0);
    assert.deepStrictEqual(f[gi + 2].args, [0, 0, 20, 20], 'the group clip (after beginPath, rect)');
    const inherited = at('fill').find((c) => c.fillStyle === '#00ff00');
    assert.strictEqual(inherited.globalAlpha, 0.5, 'the group fill and opacity reach a child with no style of its own');
    assert.strictEqual(at('fill').find((c) => c.fillStyle === '#0000ff').globalAlpha, 0.25, 'opacity 0.5 in a group of 0.5');

    // text
    const hi = at('fillText').find((c) => c.args[0] === 'Hi');
    assert.strictEqual(hi.font, '600 12px Test Sans');
    assert.strictEqual(hi.textAlign, 'right');
    assert.strictEqual(hi.textBaseline, 'hanging');
    assert.deepStrictEqual(hi.args, ['Hi', 0, 0], 'drawn at the origin of a translated and rotated frame');
    const i = f.findIndex((c) => c.op === 'translate' && c.args.join() === '20,30');
    assert(Math.abs(f[i + 1].args[0] - Math.PI / 2) < 1e-12 && f[i + 1].op === 'rotate', 'rotate(90 deg) in radians');
    const mid = at('fillText').find((c) => c.args[0] === 'Mid');
    assert.strictEqual(mid.textAlign, 'center');
    assert.strictEqual(mid.textBaseline, 'middle');
    const plainText = at('fillText').find((c) => c.args[0] === 'plain');
    assert.strictEqual(plainText.textAlign, 'left');
    assert.strictEqual(plainText.textBaseline, 'alphabetic');
    assert.strictEqual(plainText.fillStyle, '#000');
    assert(at('strokeText').some((c) => c.args[0] === 'outlined' && c.strokeStyle === '#777777'));
    assert(!at('fillText').some((c) => c.args[0] === 'outlined'));
    // paintOrder "stroke": the stroke under the fill (a halo); without it the stroke goes over
    const order = (op, first) => f.findIndex((c) => c.op === op && c.args[0] === first);
    assert(order('strokeText', 'haloed') >= 0 && order('strokeText', 'haloed') < order('fillText', 'haloed'), 'a halo is under its text');
    assert.strictEqual(f[order('strokeText', 'haloed')].lineWidth, 3);
    assert(order('fillText', 'over') >= 0 && order('fillText', 'over') < order('strokeText', 'over'), 'a stroke is over its text');
    assert(order('stroke', 'M1 1L2 2Z') >= 0 && order('stroke', 'M1 1L2 2Z') < order('fill', 'M1 1L2 2Z'), 'and under a shape');
    assert(order('strokeText', 'inner') >= 0 && order('strokeText', 'inner') < order('fillText', 'inner'), 'from its group, as in SVG');

    // update repaints the same canvas; destroy removes it
    const n = ops(ctx.calls, 'clearRect').length;
    handle.update(list);
    assert.strictEqual(ops(ctx.calls, 'clearRect').length, n + 1);
    assert.strictEqual(handle.root, host.children[0]);
    // and names it by its list: a name gone is gone from the element too
    handle.update({ ...list, label: 'Named' });
    assert.strictEqual(handle.root.attrs['aria-label'], 'Named');
    handle.update(list);
    assert(!('aria-label' in handle.root.attrs), 'not the old name');
    handle.destroy();
    assert.strictEqual(host.children.length, 0);
  }),
);

test(
  'canvas: without roundRect (older browsers) a rounded rectangle is made of arcs',
  restoreRoundRect(() => {
    const w = world({ noRoundRect: true });
    const host = w.host();
    w.BC.get('renderer.canvas').render(
      {
        size: { w: 50, h: 50 },
        plot: { x: 0, y: 0, w: 50, h: 50 },
        layers: [{ name: 'marks', prims: [{ type: 'rect', x: 0, y: 0, w: 20, h: 10, r: 50 }] }],
      },
      host,
    );
    const f = frame(ctxOf(host));
    assert.strictEqual(ops(f, 'arcTo').length, 4);
    assert.deepStrictEqual(ops(f, 'arcTo')[0].args, [20, 0, 20, 10, 5], 'the radius cannot exceed half the smaller side');
    assert(ops(f, 'closePath').length === 1 && ops(f, 'fill').length === 1);
  }),
);

test('canvas: no 2D context is a clear failure of that chart, not of the page', () => {
  const w = world();
  w.doc.createElement = () => ({ setAttribute() {}, getContext: () => null, style: {} });
  w.BC.data('d', ROWS);
  const host = w.host();
  const h = w.BC.chart(host, bars());
  assert(
    arr(h.diagnostics).some((d) => /no 2D canvas context/.test(d.message)) ||
      /no 2D canvas context/.test(JSON.stringify(host.children.map((c) => c.text))),
    JSON.stringify(arr(h.diagnostics)),
  );
});

const POINTS = [
  { x: 1, y: 2, g: 'A' },
  { x: 2, y: 4, g: 'B' },
  { x: 3, y: 3, g: 'C' },
  { x: 4, y: 6, g: 'A' },
];
const points = (interaction) => ({
  data: 'p',
  renderer: 'canvas',
  size: [400, 240],
  scales: { x: { type: 'linear' }, y: { type: 'linear' }, color: { type: 'color' } },
  guides: [{ type: 'legend', scale: 'color', position: 'top' }],
  marks: [{ type: 'point', x: 'x', y: 'y', color: 'g' }],
  interaction,
});
function chartOf(spec, options) {
  const w = world(options);
  w.BC.data('p', POINTS);
  const host = w.host();
  const h = w.BC.chart(host, spec);
  const root = host.children[0];
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 240 }); // the display list is 400 x 240: 1 unit = 1 px
  return { w, host, h, root, ctx: ctxOf(host) };
}
const dots = (ctx) => ops(frame(ctx), 'arc').length;
/** Where the legend drew the item for a value: the swatch (a 10 x 10 rounded rectangle) and the label. Text is drawn at the origin of a
 *  translated frame, so its position is the translate call right before it. */
const legendItem = (ctx, label) => {
  const f = frame(ctx);
  let at = [0, 0];
  const labels = [];
  for (const c of f) {
    if (c.op === 'translate') at = c.args;
    if (c.op === 'fillText') labels.push({ text: c.args[0], x: at[0], y: at[1] });
  }
  const text = labels.find((l) => l.text === label);
  const swatches = ops(f, 'roundRect').filter((c) => c.args[2] === 10 && c.args[3] === 10);
  if (!text || !swatches.length) throw new Error('no legend item ' + label + ' was drawn: ' + JSON.stringify(labels));
  const swatch = swatches.filter((c) => c.args[0] < text.x).pop();
  return { swatch: swatch.args, label: [text.text, text.x, text.y] };
};

test('canvas: legend-filter works without elements: the click is tested against what was drawn', async () => {
  const { root, h, ctx } = chartOf(points([{ type: 'legend-filter' }]));
  assert.deepStrictEqual(arr(h.diagnostics), []);
  assert.strictEqual(dots(ctx), 4);
  const b = legendItem(ctx, 'B');

  root.fire('click', { clientX: b.swatch[0] + 5, clientY: b.swatch[1] + 5, detail: 1 });
  await flush();
  assert.deepStrictEqual(arr(h.getView().color), ['A', 'C'], 'clicked on the swatch');
  assert.strictEqual(dots(ctx), 3);
  assert(
    ops(frame(ctx), 'fill').some((c) => c.globalAlpha === 0.4),
    'the hidden value stays in the legend, dimmed',
  );

  const b2 = legendItem(ctx, 'B');
  root.fire('click', { clientX: b2.label[1] + 3, clientY: b2.label[2], detail: 1 });
  await flush();
  assert.deepStrictEqual(arr(h.getView().color), ['A', 'B', 'C'], 'clicked on the label text');

  const gap = b2.swatch[0] + 12; // between the swatch and the label
  root.fire('click', { clientX: gap, clientY: b2.swatch[1] + 5, detail: 1 });
  await flush();
  assert.deepStrictEqual(arr(h.getView().color), ['A', 'C'], 'the space between swatch and label belongs to the item');
  root.fire('click', { clientX: gap, clientY: b2.swatch[1] + 5, detail: 1 });
  await flush();

  root.fire('click', { clientX: 390, clientY: 230, detail: 1 });
  await flush();
  assert.deepStrictEqual(arr(h.getView().color), ['A', 'B', 'C'], 'a click elsewhere does nothing');

  const a = legendItem(ctx, 'A');
  root.fire('dblclick', { clientX: a.swatch[0] + 5, clientY: a.swatch[1] + 5 });
  await flush();
  assert.deepStrictEqual(arr(h.getView().color), ['A'], 'double-click isolates');
});

test('canvas: legend items get a pointer cursor while the pointer is over one, and the old cursor comes back', async () => {
  const { root, ctx, h } = chartOf(points([{ type: 'legend-filter' }]));
  const a = legendItem(ctx, 'A');
  root.style.cursor = 'grab';
  root.fire('pointermove', { clientX: a.swatch[0] + 5, clientY: a.swatch[1] + 5, buttons: 0 });
  assert.strictEqual(root.style.cursor, 'pointer');
  root.fire('pointermove', { clientX: a.swatch[0] + 5, clientY: a.swatch[1] + 5, buttons: 0 });
  assert.strictEqual(root.style.cursor, 'pointer');
  root.fire('pointermove', { clientX: 390, clientY: 230, buttons: 0 });
  assert.strictEqual(root.style.cursor, 'grab', 'what was there before');
  h.destroy();
  root.fire('pointermove', { clientX: a.swatch[0] + 5, clientY: a.swatch[1] + 5, buttons: 0 });
  assert.strictEqual(root.style.cursor, 'grab', 'cleaned up with the chart');
});

test('canvas: zoom repaints the canvas with what is visible, and the tooltip finds the point under the pointer', async () => {
  const { root, host, h, ctx } = chartOf(points([{ type: 'zoom', scales: ['x'] }, { type: 'tooltip' }]));
  const [x0, x1] = arr(h.getView().x);
  const frames = () => ops(ctx.calls, 'clearRect').length;
  const before = frames();
  root.fire('wheel', { clientX: 200, clientY: 120, deltaY: -600, ctrlKey: true });
  await flush();
  const [z0, z1] = arr(h.getView().x);
  assert(z1 - z0 < (x1 - x0) * 0.6, 'zoomed in');
  assert(frames() > before, 'and repainted');
  assert(ops(frame(ctx), 'clip').length >= 1, 'marks are clipped to the plot while zoomed');

  root.fire('wheel', { clientX: 200, clientY: 120, deltaY: 600, ctrlKey: true });
  await flush();
  const dot = ops(frame(ctx), 'arc')[0].args; // [cx, cy, r, ...]
  root.fire('pointermove', { clientX: dot[0], clientY: dot[1], buttons: 0 });
  await flush();
  const tip = host.children.find((c) => c.attrs.class === 'bc-tooltip');
  assert(tip && tip.style.display !== 'none', 'a tooltip appeared over the canvas');
  const grid = tip.children.find((c) => c.attrs.class === 'bc-tooltip-lines');
  const lines = [];
  for (let k = 0; grid && k < grid.children.length; k += 2) lines.push(grid.children[k].text + ': ' + grid.children[k + 1].text);
  assert(lines.some((l) => /^y: [2346]$/.test(l)) && lines.some((l) => /^x: [1-4]$/.test(l)), 'with the values of the row: ' + lines);
});

test('canvas: the spec names it, BC.needs lists it, and the composer and validation know it', () => {
  const w = world();
  w.BC.data('d', ROWS);
  assert(arr(w.BC.needs(bars())).includes('renderer.canvas'));
  assert(!arr(w.BC.needs({ ...bars(), renderer: undefined })).includes('renderer.canvas'));
  assert.deepStrictEqual(arr(w.BC.validate(bars())), []);
  assert(arr(w.BC.validate(bars({ renderer: 'webgl' }))).some((d) => /renderer\.webgl/.test(d.message) || /webgl/.test(d.message)));
  const def = w.BC.get('renderer.canvas');
  assert.strictEqual(def.version, 4);
  assert(/canvas/i.test(def.doc));
});

test('canvas: a long series is one Path2D, drawn in one stroke', () => {
  const w = world();
  const n = 20000;
  const rows = Array.from({ length: n }, (_, i) => ({ t: i, v: Math.sin(i / 300) * 100 }));
  w.BC.data('long', rows);
  const host = w.host();
  const h = w.BC.chart(host, {
    data: 'long',
    renderer: 'canvas',
    size: [640, 300],
    scales: { x: { type: 'linear' }, y: { type: 'linear' } },
    marks: [{ type: 'line', x: 't', y: 'v' }],
  });
  assert.deepStrictEqual(arr(h.diagnostics), []);
  const strokes = ops(frame(ctxOf(host)), 'stroke').filter((c) => c.args[0] && c.args[0].length > 1000);
  assert.strictEqual(strokes.length, 1);
  assert.strictEqual(strokes[0].lineWidth > 0, true);
});

// ───────────────────────── text measured in the chart's own font ─────────────────────────

/** Fonts as a page has them: `ready` says whether the web font has come; load() settles when come() or fail() is called. */
const webFonts = (ready) => {
  const fonts = { ready, loads: 0, settle: null };
  fonts.check = () => fonts.ready;
  fonts.load = () => {
    fonts.loads++;
    return new Promise((resolve, reject) => {
      fonts.settle = { resolve, reject };
    });
  };
  fonts.come = () => {
    fonts.ready = true;
    fonts.settle.resolve([]);
  };
  fonts.fail = () => fonts.settle.reject(new Error('network'));
  return fonts;
};

/** A canvas that measures as fonts would: "Wide Sans" a full em a character but "1", half of one, and bold a tenth of an em more;
 *  any other family (what stands in while a web font has not come) half as wide. The ink of a last "r" reaches a tenth of
 *  an em past its advance. */
const measuring = (fonts, fn) => async () => {
  const { FakeContext } = require('./fake-dom.js');
  const saved = FakeContext.prototype.measureText;
  FakeContext.prototype.measureText = function (t) {
    const [, weight, size, family] = /^(\d+) ([\d.]+)px (.*)$/.exec(this.font) || [];
    const em = [...String(t)].reduce((n, ch) => n + (ch === '1' ? 0.5 : 1), 0);
    const wide = family === 'Wide Sans' && (!fonts || fonts.ready) ? 1 : 0.5;
    const width = (em + (+weight >= 700 ? String(t).length / 10 : 0)) * +size * wide;
    const tail = String(t).endsWith('r') ? 0.1 * +size * wide : 0;
    return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width + tail };
  };
  try {
    await fn();
  } finally {
    FakeContext.prototype.measureText = saved;
  }
};

/** A mark that draws nothing, measures a label as a guide does while the chart is laid out, and keeps the ChartCtx of every
 *  draw. */
const probe = (w) => {
  const seen = [];
  w.BC.define({
    role: 'mark',
    type: 'probe',
    version: 1,
    channels: {},
    render: (spec, ctx) => (ctx.textWidth('Probe', 11), seen.push(ctx), []),
  });
  return seen;
};
const probed = { data: 'd', size: [400, 240], marks: [{ type: 'probe' }] };
const builds = (seen) => new Set(seen).size;
const box = (m) => ({ w: m.w, h: m.h });

test(
  'text: a label is measured in the font the chart is drawn in, at its size and weight, every figure as the widest',
  measuring(null, () => {
    const w = world({ fonts: webFonts(true), family: 'Wide Sans' });
    const seen = probe(w);
    const { h } = draw(w, probed);
    assert.deepStrictEqual(arr(h.diagnostics), []);
    const ctx = seen[seen.length - 1];
    assert.strictEqual(ctx.textWidth('Hello', 10), 50);
    assert.strictEqual(ctx.textWidth('Hello', 10, 700), 55);
    assert.strictEqual(ctx.textWidth('Hello', 10, 'bold'), 55);
    assert.strictEqual(ctx.textWidth('Hello'), 55, 'at 11 px when no size is given');
    // "1" is half as wide in this font, but a figure is drawn as wide as the widest (tabular)
    assert.strictEqual(ctx.textWidth('2011', 10), 40);
    assert.strictEqual(ctx.textWidth('2011', 10), 40, 'the second time, from what was kept');
    // measure is never narrower than the font: here wider than its estimate (0.6 em a character)
    assert.deepStrictEqual(box(ctx.measure('Hello', 10)), { w: 50, h: 12 });
    // and keeps the ink in: the tail of the r past its advance, on either side, however the text is anchored
    assert.strictEqual(ctx.textWidth('Apr', 10), 30);
    assert.deepStrictEqual(box(ctx.measure('Apr', 10)), { w: 32, h: 12 });
  }),
);

test(
  'text: in a narrow font measure keeps its own generous width; with no fonts to measure, the estimate stands',
  measuring(null, () => {
    const narrow = world({ fonts: webFonts(true), family: 'Slim Sans' });
    const seen = probe(narrow);
    draw(narrow, probed);
    const ctx = seen[seen.length - 1];
    assert.strictEqual(ctx.textWidth('Hello', 10), 25);
    assert.deepStrictEqual(box(ctx.measure('Hello', 10)), { w: 30, h: 12 });
    // the composer's sandbox and a test's page have no document.fonts: textWidth's estimate, as a sans-serif draws it
    const bare = world({ family: 'Wide Sans' });
    const seenBare = probe(bare);
    draw(bare, probed);
    const est = seenBare[seenBare.length - 1];
    assert(Math.abs(est.textWidth('Hello', 10) - 23.4) < 1e-9, String(est.textWidth('Hello', 10)));
    assert.deepStrictEqual(box(est.measure('Hello', 10)), { w: 30, h: 12 });
  }),
);

{
  const fonts = webFonts(false);
  test(
    'text: a web font that has not come is measured as the font drawn until it does; then every chart is laid out again',
    measuring(fonts, async () => {
      const w = world({ fonts, family: 'Wide Sans' });
      const seen = probe(w);
      const first = draw(w, probed);
      const second = draw(w, probed);
      const gone = draw(w, probed);
      assert.strictEqual(builds(seen), 3);
      assert.strictEqual(seen[0].textWidth('Hello', 10), 25, 'the font standing in');
      assert.strictEqual(fonts.loads, 1, 'the font is asked for once');
      gone.h.destroy();
      await flush();
      assert.strictEqual(builds(seen), 3, 'nothing is laid out again before the font has come');
      fonts.come();
      await flush();
      assert.strictEqual(builds(seen), 5, 'the two charts on the page are laid out again, the one destroyed is not');
      assert.strictEqual(seen[seen.length - 1].textWidth('Hello', 10), 50, 'measured again, in the font come');
      assert.strictEqual(seen[0].textWidth('Hello', 10), 50);
      await flush();
      assert.strictEqual(builds(seen), 5, 'once');
      assert.deepStrictEqual([arr(first.h.diagnostics), arr(second.h.diagnostics), w.errors], [[], [], []]);
    }),
  );
}

{
  const fonts = webFonts(false);
  test(
    'text: a web font that fails to load is waited for once; the chart is laid out once more, in the font standing in',
    measuring(fonts, async () => {
      const w = world({ fonts, family: 'Wide Sans' });
      const seen = probe(w);
      draw(w, probed);
      fonts.fail();
      await flush();
      await flush();
      assert.strictEqual(builds(seen), 2);
      assert.strictEqual(seen[seen.length - 1].textWidth('Hello', 10), 25);
      draw(w, probed);
      await flush();
      assert.strictEqual(builds(seen), 3, 'a chart drawn later does not wait for it');
      assert.strictEqual(fonts.loads, 1);
      assert.deepStrictEqual(w.errors, []);
    }),
  );
}

// A test that waits on a promise which never settles, or throws outside its own promise (a timer, setImmediate), ends
// the process mid-queue without the summary: say which test it was, and fail.
let running = null;
process.on('exit', () => {
  if (running === null) return;
  console.log(`\nFAIL ${running}: never finished (it threw outside its promise, or waits on one that never settles)`);
  process.exitCode = 1;
});

(async () => {
  for (const [name, fn] of queue) {
    running = name;
    try {
      await fn();
      passed++;
      console.log('ok  ', name);
    } catch (e) {
      failed++;
      console.log('FAIL', name);
      console.error(e);
      process.exitCode = 1;
    }
  }
  running = null;
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
