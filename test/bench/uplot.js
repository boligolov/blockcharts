import uPlot from 'uplot';
import css from 'uplot/dist/uPlot.min.css';
import { install, style, W, H } from './common.js';

// uPlot (canvas) lays its canvas out with its own stylesheet. It has no tooltip: its legend shows the values under the
// cursor, and is off here as every library's legend is; the cursor stays on.
style(css);

install((el, kind, rows) => {
  if (kind === 'bar') {
    new uPlot(
      {
        width: W,
        height: H,
        legend: { show: false },
        scales: { x: { time: false } },
        axes: [{ values: (u, vals) => vals.map((v) => (rows[v] ? rows[v].k : '')) }, {}],
        series: [{}, { paths: uPlot.paths.bars({ size: [0.6] }), fill: '#4e79a7', stroke: '#4e79a7' }],
      },
      [rows.map((_, j) => j), rows.map((r) => r.v)],
      el,
    );
  } else {
    new uPlot(
      { width: W, height: H, legend: { show: false }, scales: { x: { time: false } }, series: [{}, { stroke: '#4e79a7' }] },
      [rows.map((r) => r.x), rows.map((r) => r.y)],
      el,
    );
  }
});
