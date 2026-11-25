// The page every app draws, the same in each, so one set of checks (scripts/test-apps.js) runs against all of them:
//   chart a   its own rows (ROWS3, then ROWS4 after #update), a title that #retitle changes
//   chart b   and chart c: one dataset the app gives to BC.data once (SHARED), not the chart's own
// A click on a bar writes "<chart>:<row's k>" into <output id="picked">; #remove-b takes chart b away, #hide all three.
// Each chart stands in a <div data-chart="a|b|c">.

export const ROWS3 = [
  { k: 'North', v: 42 },
  { k: 'South', v: 58 },
  { k: 'East', v: 31 },
];
export const ROWS4 = ROWS3.concat([{ k: 'West', v: 12 }]);

/** The dataset charts b and c share: the app's, given to BC.data under this name. */
export const SHARED = 'smoke:shared';
export const SHARED_ROWS = [
  { k: 'Q1', v: 10 },
  { k: 'Q2', v: 14 },
  { k: 'Q3', v: 9 },
  { k: 'Q4', v: 17 },
  { k: 'Q5', v: 12 },
];

/** A bar chart. `data` names a dataset of the lake (charts b and c); `click` puts the click interaction in the spec, for
 *  the element and plain JavaScript (a component adds it itself when it has an onClick). */
export function spec(title, options = {}) {
  return {
    title,
    size: [360, 200],
    ...(options.data ? { data: options.data } : {}),
    scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
    guides: [
      { type: 'axis', scale: 'x' },
      { type: 'axis', scale: 'y' },
    ],
    marks: [{ type: 'rect', x: 'k', y: 'v' }],
    interaction: [{ type: 'tooltip' }].concat(options.click ? [{ type: 'click' }] : []),
  };
}

/** What a click on chart `name` writes into #picked. */
export const picked = (name, detail) => `${name}:${detail.values.k}`;
