// Every chart of every recipe of the skill on one page, for the measures (scripts/test-apps.js serves the fixture at
// /fixtures/all.json: { lake: { "<recipe>:<dataset>": dataset }, charts: [{ id, spec }] }). Each chart gets its dataset
// as its own data, as a component in an app is given its rows. ?copies=N draws every chart N times.
//
// The page shows nothing until #mount; #update gives every chart new data (the same rows in a new array, so each is
// built again); #unmount takes them all away. Each chart stands in a <div class="cell">; window.allCharts is how many
// there are once the fixture has loaded.

export async function loadAll() {
  const copies = Math.max(1, Math.min(50, Number(new URLSearchParams(location.search).get('copies')) || 1));
  const res = await fetch('/fixtures/all.json');
  if (!res.ok) throw new Error(`/fixtures/all.json: ${res.status}`);
  const { lake, charts } = await res.json();
  const items = [];
  for (let c = 0; c < copies; c++)
    for (const chart of charts) {
      const { data, ...spec } = chart.spec;
      items.push({ key: `${c}:${chart.id}`, spec, data: lake[data] });
    }
  window.allCharts = items.length;
  return items;
}

/** The same charts with new data: every chart is built again. */
export const renewed = (items) => items.map((it) => ({ ...it, data: Array.isArray(it.data) ? it.data.slice() : { ...it.data } }));

/** The grid the charts stand in, the same in every app: as a style attribute, and as an object for React and Vue. */
export const GRID_STYLE = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:8px;width:1280px';
export const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(420px,1fr))', gap: '8px', width: '1280px' };
