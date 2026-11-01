// The grader itself: a good page passes, and each way of going wrong fails the check meant to catch it. Needs Chrome.
//   npm run build && npm run manifest && node test/evals/test-grade.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { grade, spellings } = require('./grade.js');
const { compose } = require('../../scripts/compose.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-grade-'));
const expected = { charts: 2, figures: [1234567], words: ['North'] };
const chart = (id) => ({
  id,
  data: 'd',
  scales: { x: { type: 'band' }, y: { type: 'linear', zero: true } },
  marks: [{ type: 'rect', x: 'k', y: 'v' }],
});
const good = compose({
  title: 'Total 1,234,567',
  data: { d: [{ k: 'North', v: 1 }, { k: 'South', v: 2 }] },
  charts: [chart('a'), chart('b')],
}).html;
const run = async (name, html) => {
  const file = path.join(dir, name + '.html');
  fs.writeFileSync(file, html);
  const { expectations } = await grade(file, expected);
  return (text) => expectations.find((e) => e.text.startsWith(text)).passed;
};

(async () => {
  assert(spellings(1234567).includes('1,234,567') && spellings(1234567).includes('1.2M'));
  const fine = await run('good', good);
  for (const t of ['no script errors', 'asks for nothing', 'at least 2', 'no more than', 'no sideways', 'the figure', '"North"']) assert(fine(t), 'good page: ' + t);

  const missing = await grade(path.join(dir, 'nothing.html'), expected);
  assert.strictEqual(missing.expectations[0].passed, false, 'no file');

  const cdn = await run('cdn', '<!doctype html><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0"></script><canvas></canvas><p>1,234,567 North</p>');
  assert(!cdn('asks for nothing'), 'a CDN is caught');
  assert(!cdn('at least 2'), 'nothing is drawn offline');

  const broken = await run('broken', good.replace('</body>', '<script>throw new Error("boom")</script></body>'));
  assert(!broken('no script errors'), 'a script error is caught');

  const wrong = await run('wrong', good.replaceAll('Total 1,234,567', 'Total 11,234,5670'));
  assert(!wrong('the figure'), 'a wrong figure is caught');

  const wide = await run('wide', good.replace('</body>', '<div style="width:900px;height:1px"></div></body>'));
  assert(!wide('no sideways'), 'a page wider than a phone is caught');

  const heavy = await run('heavy', good.replace('</body>', `<!--${'x'.repeat(1100 * 1024)}--></body>`));
  assert(!heavy('no more than'), 'a heavy page is caught');

  console.log('grader: all cases behaved');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
