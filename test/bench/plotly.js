// Plotly, without its mode bar.
import Plotly from 'plotly.js-dist-min';
import { install, W, H } from './common.js';

install((el, kind, rows) =>
  Plotly.newPlot(
    el,
    [
      kind === 'bar'
        ? { type: 'bar', x: rows.map((r) => r.k), y: rows.map((r) => r.v) }
        : { type: 'scatter', mode: 'lines', x: rows.map((r) => r.x), y: rows.map((r) => r.y) },
    ],
    { width: W, height: H, margin: { l: 40, r: 10, t: 10, b: 30 } },
    { displayModeBar: false },
  ),
);
