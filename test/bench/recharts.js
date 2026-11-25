// Recharts (React, SVG).
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { install, W, H } from './common.js';

const chart = (kind, rows) =>
  kind === 'bar'
    ? h(
        BarChart,
        { width: W, height: H, data: rows },
        h(XAxis, { dataKey: 'k' }),
        h(YAxis),
        h(Tooltip),
        h(Bar, { dataKey: 'v', isAnimationActive: false }),
      )
    : h(
        LineChart,
        { width: W, height: H, data: rows },
        h(XAxis, { dataKey: 'x', type: 'number' }),
        h(YAxis),
        h(Tooltip),
        h(Line, { dataKey: 'y', dot: false, isAnimationActive: false }),
      );

// a React app renders its charts together, in one root
let root = null;
install(null, (grid, items) => {
  if (!root) root = createRoot(grid);
  flushSync(() =>
    root.render(
      h(
        'div',
        { style: { display: 'contents' } },
        items.map((it, i) => h('div', { className: 'cell', key: i }, chart(it.kind, it.rows))),
      ),
    ),
  );
});
