// The same charts in every library: bars over 12 categories and a line of 200 points, alternating, each 360 × 200 with
// two axes and a tooltip, no animation, no legend. window.run(n) lays out n empty cells, then starts the clock, draws a
// chart into each (awaiting what the library returns) and stops it once the frame that shows them has been painted.
export const W = 360;
export const H = 200;
const CATS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const barRows = (i) => CATS.map((k, j) => ({ k, v: 20 + ((i * 7 + j * 13) % 50) }));
export const lineRows = (i) => Array.from({ length: 200 }, (_, j) => ({ x: j, y: 50 + 30 * Math.sin((j + i) / 15) + ((j * i) % 7) }));

/** After the next frame's rendering: a task posted from requestAnimationFrame runs once that frame has been painted.
 *  A library that draws in its own requestAnimationFrame callback (asked for while drawing) has drawn by then too. */
const painted = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    }),
  );

/** A page adds its library's stylesheet, when the library wants one, before the clock starts. */
export function style(css) {
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

/** draw(cell, kind, rows, i) for one chart, or batch(grid, items) for all of them at once (a React app renders its
 *  charts together, in one root). Sets window.run(n), which resolves to { ms, drawn }: drawn counts the cells that hold
 *  an <svg> or a <canvas>. */
export function install(draw, batch) {
  window.run = async (n) => {
    const grid = document.getElementById('grid');
    grid.textContent = '';
    const items = Array.from({ length: n }, (_, i) => (i % 2 ? { kind: 'line', rows: lineRows(i) } : { kind: 'bar', rows: barRows(i) }));
    let cells = [];
    if (!batch)
      cells = items.map(() => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        grid.appendChild(cell);
        return cell;
      });
    grid.getBoundingClientRect();
    const t0 = performance.now();
    if (batch) await batch(grid, items);
    else await Promise.all(items.map((it, i) => draw(cells[i], it.kind, it.rows, i)));
    await painted();
    const ms = performance.now() - t0;
    const drawn = [...grid.querySelectorAll('.cell')].filter((c) => c.querySelector('svg, canvas')).length;
    return { ms, drawn };
  };
  window.ready = true;
}
