// blockcharts: the basic kit of the release (what `import BC from 'blockcharts/kits/basic.mjs'` gives an app), each
// chart's rows given to the lake under a name of its own, as a page does.
import BC from 'blockcharts/kits/basic.mjs';
import { install, W, H } from './common.js';

const axes = [
  { type: 'axis', scale: 'x' },
  { type: 'axis', scale: 'y' },
];
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

install((el, kind, rows, i) => {
  BC.data('d' + i, rows);
  BC.chart(el, { ...SPEC[kind], data: 'd' + i });
});
