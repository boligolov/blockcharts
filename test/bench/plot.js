// Observable Plot (SVG); it orders the bars by their category's name.
import * as Plot from '@observablehq/plot';
import { install, W, H } from './common.js';

install((el, kind, rows) => {
  el.appendChild(
    kind === 'bar'
      ? Plot.plot({ width: W, height: H, marks: [Plot.barY(rows, { x: 'k', y: 'v', tip: true }), Plot.ruleY([0])] })
      : Plot.plot({ width: W, height: H, marks: [Plot.lineY(rows, { x: 'x', y: 'y', tip: true })] }),
  );
});
