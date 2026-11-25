import BC from 'blockcharts/kits/full.mjs';
import { loadAll, renewed, GRID_STYLE } from '../../shared/all.js';

const root = document.getElementById('app');
root.innerHTML = '<p id="loading">Loading…</p>';

loadAll().then((loaded) => {
  let items = loaded;
  /** The charts on the page, each with the name of its own dataset. */
  let charts = [];
  root.innerHTML = `<main><p>
    <button id="mount">Mount</button> <button id="update">Update</button> <button id="unmount">Unmount</button>
  </p><div id="all" style="${GRID_STYLE}"></div></main>`;
  const grid = root.querySelector('#all');

  root.querySelector('#mount').addEventListener('click', () => {
    if (charts.length) return;
    charts = items.map((it, i) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      grid.appendChild(cell);
      const name = `all:${i}`;
      BC.data(name, it.data);
      return { name, chart: BC.chart(cell, { ...it.spec, data: name }) };
    });
  });
  root.querySelector('#update').addEventListener('click', () => {
    items = renewed(items);
    charts.forEach(({ name, chart }, i) => {
      BC.data(name, items[i].data);
      chart.update({ ...items[i].spec, data: name });
    });
  });
  root.querySelector('#unmount').addEventListener('click', () => {
    for (const { name, chart } of charts) {
      chart.destroy();
      chart.host.remove();
      BC.data(name, null);
    }
    charts = [];
  });
});
