import BC from 'blockcharts/kits/basic.mjs';
import { BlockChart } from 'blockcharts/react';
import { useState } from 'react';
import { ROWS3, ROWS4, SHARED, SHARED_ROWS, spec, picked } from '../../shared/smoke.js';

// the dataset charts b and c share, given once, before they mount
BC.data(SHARED, SHARED_ROWS);

export default function Smoke() {
  const [rows, setRows] = useState(ROWS3);
  const [title, setTitle] = useState('Sales');
  const [showB, setShowB] = useState(true);
  const [show, setShow] = useState(true);
  const [pick, setPick] = useState('');
  return (
    <main>
      <p>
        <button id="update" onClick={() => setRows(ROWS4)}>
          Update
        </button>
        <button id="retitle" onClick={() => setTitle('Revenue')}>
          Retitle
        </button>
        <button id="remove-b" onClick={() => setShowB(false)}>
          Remove b
        </button>
        <button id="hide" onClick={() => setShow(false)}>
          Hide
        </button>
        <output id="picked">{pick}</output>
      </p>
      {show && (
        <>
          <div data-chart="a">
            <BlockChart spec={spec(title)} data={rows} onClick={(d) => setPick(picked('a', d))} />
          </div>
          {showB && (
            <div data-chart="b">
              <BlockChart spec={spec('B', { data: SHARED })} onClick={(d) => setPick(picked('b', d))} />
            </div>
          )}
          <div data-chart="c">
            <BlockChart spec={spec('C', { data: SHARED })} onClick={(d) => setPick(picked('c', d))} />
          </div>
        </>
      )}
    </main>
  );
}
