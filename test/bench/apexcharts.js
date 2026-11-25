// ApexCharts (SVG), without its toolbar and zoom.
import ApexCharts from 'apexcharts';
import { install, W, H } from './common.js';

install((el, kind, rows) =>
  new ApexCharts(el, {
    chart: { type: kind, width: W, height: H, animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false } },
    series: [{ name: 'v', data: kind === 'bar' ? rows.map((r) => r.v) : rows.map((r) => [r.x, r.y]) }],
    xaxis: kind === 'bar' ? { categories: rows.map((r) => r.k) } : { type: 'numeric' },
    dataLabels: { enabled: false },
    legend: { show: false },
  }).render(),
);
