// Chart.js: a canvas of the chart's size, not responsive.
import Chart from 'chart.js/auto';
import { install, W, H } from './common.js';

install((el, kind, rows) => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  el.appendChild(canvas);
  new Chart(canvas, {
    type: kind,
    data:
      kind === 'bar'
        ? { labels: rows.map((r) => r.k), datasets: [{ data: rows.map((r) => r.v) }] }
        : { datasets: [{ data: rows.map((r) => ({ x: r.x, y: r.y })), pointRadius: 0 }] },
    options: {
      animation: false,
      responsive: false,
      plugins: { legend: { display: false } },
      scales: kind === 'line' ? { x: { type: 'linear' } } : undefined,
    },
  });
});
