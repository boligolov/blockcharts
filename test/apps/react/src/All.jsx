import 'blockcharts/kits/full.mjs';
import { BlockChart } from 'blockcharts/react';
import { useEffect, useState } from 'react';
import { loadAll, renewed, GRID } from '../../shared/all.js';

export default function All() {
  const [items, setItems] = useState(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    loadAll().then(setItems);
  }, []);
  if (!items) return <p id="loading">Loading…</p>;
  return (
    <main>
      <p>
        <button id="mount" onClick={() => setShown(true)}>
          Mount
        </button>
        <button id="update" onClick={() => setItems(renewed(items))}>
          Update
        </button>
        <button id="unmount" onClick={() => setShown(false)}>
          Unmount
        </button>
      </p>
      <div id="all" style={GRID}>
        {shown &&
          items.map((it) => (
            <div className="cell" key={it.key}>
              <BlockChart spec={it.spec} data={it.data} />
            </div>
          ))}
      </div>
    </main>
  );
}
