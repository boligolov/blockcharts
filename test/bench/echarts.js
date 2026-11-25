// ECharts on canvas.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { install, W, H } from './common.js';

// only what these charts use, as ECharts' guide says to import it
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

install((el, kind, rows) => {
  const chart = echarts.init(el, null, { width: W, height: H });
  chart.setOption({
    animation: false,
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 10, top: 10, bottom: 30 },
    xAxis: kind === 'bar' ? { type: 'category', data: rows.map((r) => r.k) } : { type: 'value' },
    yAxis: { type: 'value' },
    series: [
      kind === 'bar' ? { type: 'bar', data: rows.map((r) => r.v) } : { type: 'line', showSymbol: false, data: rows.map((r) => [r.x, r.y]) },
    ],
  });
});
