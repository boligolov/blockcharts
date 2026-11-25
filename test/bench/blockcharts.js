// blockcharts: the basic kit of the release (what `import BC from 'blockcharts/kits/basic.mjs'` gives an app), each
// chart's rows given to the lake under a name of its own, as a page does.
import BC from 'blockcharts/kits/basic.mjs';
import { SPEC } from './charts.cjs';
import { install } from './common.js';

install((el, kind, rows, i) => {
  BC.data('d' + i, rows);
  BC.chart(el, { ...SPEC[kind], data: 'd' + i });
});
