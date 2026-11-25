// The charts every library draws: their size, their rows, and blockcharts' spec of them. CommonJS, so that the site
// (site/src/lib/site.mjs) reads the same rows and spec when it shows them on /benchmarks/.
const W = 360;
const H = 200;
const CATS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The rows of the i-th chart: bars over 12 categories, or a line of 200 points. */
const barRows = (i) => CATS.map((k, j) => ({ k, v: 20 + ((i * 7 + j * 13) % 50) }));
const lineRows = (i) => Array.from({ length: 200 }, (_, j) => ({ x: j, y: 50 + 30 * Math.sin((j + i) / 15) + ((j * i) % 7) }));

const axes = [
  { type: 'axis', scale: 'x' },
  { type: 'axis', scale: 'y' },
];
/** The two charts as blockcharts specs them (blockcharts.js draws them with each chart's rows as its data). */
const SPEC = {
  bar: {
    size: [W, H],
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: axes,
    marks: [{ type: 'rect', x: 'k', y: 'v' }],
    interaction: [{ type: 'tooltip' }],
  },
  line: {
    size: [W, H],
    scales: { x: { type: 'linear' }, y: { type: 'linear' } },
    guides: axes,
    marks: [{ type: 'line', x: 'x', y: 'y' }],
    interaction: [{ type: 'tooltip' }],
  },
};

module.exports = { W, H, barRows, lineRows, SPEC };
