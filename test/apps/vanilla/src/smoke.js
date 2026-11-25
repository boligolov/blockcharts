import BC from 'blockcharts/kits/basic.mjs';
import { ROWS3, ROWS4, SHARED, SHARED_ROWS, spec, picked } from '../../shared/smoke.js';

BC.data(SHARED, SHARED_ROWS);
BC.data('smoke:a', ROWS3);

const root = document.getElementById('app');
root.innerHTML = `<main><p>
  <button id="update">Update</button> <button id="retitle">Retitle</button>
  <button id="remove-b">Remove b</button> <button id="hide">Hide</button>
  <output id="picked"></output>
</p></main>`;
const main = root.firstElementChild;
const out = root.querySelector('#picked');

const charts = {};
let title = 'Sales';
const specA = () => ({ ...spec(title, { click: true }), data: 'smoke:a' });

function place(name, chartSpec) {
  const box = document.createElement('div');
  box.dataset.chart = name;
  main.appendChild(box);
  box.addEventListener('bc-click', (e) => (out.textContent = picked(name, e.detail)));
  charts[name] = BC.chart(box, chartSpec);
}
function remove(name) {
  const chart = charts[name];
  if (!chart) return;
  chart.destroy();
  chart.host.remove();
  delete charts[name];
}

place('a', specA());
place('b', spec('B', { data: SHARED, click: true }));
place('c', spec('C', { data: SHARED, click: true }));

root.querySelector('#update').addEventListener('click', () => {
  BC.data('smoke:a', ROWS4);
  charts.a.update(specA());
});
root.querySelector('#retitle').addEventListener('click', () => {
  title = 'Revenue';
  charts.a.update(specA());
});
root.querySelector('#remove-b').addEventListener('click', () => remove('b'));
root.querySelector('#hide').addEventListener('click', () => {
  for (const name of Object.keys(charts)) remove(name);
  BC.data('smoke:a', null);
});
