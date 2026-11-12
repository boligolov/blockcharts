// Tests for the agent skill: the package builds, is self-contained, and the documentation cannot drift from the code.
// Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { unzipSync } = require('fflate');
const { buildSkill, checkSkill, packSkill, skillVersion, renderReference, listFiles, SKILL_DIR: skillDir } = require('./build-skill.js');
const { runPage } = require('./run-page.js');
const { parseCsv } = require('./csv.js');

let passed = 0;
let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

const repo = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'dist/min/manifest.json'), 'utf8'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-skill-'));
const built = buildSkill(out);
const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
const recipeFiles = fs
  .readdirSync(path.join(skillDir, 'recipes'))
  .filter((f) => f.endsWith('.json'))
  .sort();
const packagedCompose = require(path.join(out, 'runtime/compose.js'));

/** The front matter of SKILL.md: top-level `key: value` lines, and `metadata:`'s indented ones as metadata.key. */
function frontMatter(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/);
  assert(m, 'SKILL.md starts with front matter');
  const fm = {};
  let parent = '';
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
    assert(kv, `a front matter line of key: value, got ${JSON.stringify(line)}`);
    if (!kv[1]) parent = kv[3] ? '' : kv[2];
    const key = kv[1] && parent ? `${parent}.${kv[2]}` : kv[2];
    if (kv[3]) fm[key] = kv[3].replace(/^"(.*)"$/, '$1');
  }
  return fm;
}

test('skill: SKILL.md has a name and a description an agent can trigger on', () => {
  const fm = frontMatter(read('SKILL.md'));
  assert.deepStrictEqual(Object.keys(fm).sort(), ['compatibility', 'description', 'license', 'metadata.version', 'name']);
  assert.strictEqual(fm.name, 'blockcharts', 'the name equals the folder name, as skill loaders require');
  assert(fm.description.length > 80 && fm.description.length <= 1024, `description length ${fm.description.length}`);
  assert(/JSON/.test(fm.description) && /never write JavaScript/.test(fm.description), 'says what the agent does and does not do');
  assert(/Use when/.test(fm.description) && /Not for/.test(fm.description), 'says when to use it and when not');
  assert.strictEqual(fm.license, 'MIT');
  assert(!/[<>]/.test(fm.description), 'no angle brackets: some uploaders reject them in the front matter');
});

test('skill: the committed skill folder is what the build makes (run npm run skill after a change)', () => {
  assert.deepStrictEqual(checkSkill(), []);
  assert.deepStrictEqual(
    listFiles(skillDir).filter((f) => !f.includes('/')),
    ['LICENSE', 'README.md', 'SKILL.md'],
    'nothing else at the top of the skill',
  );
});

test('skill: the check notices a stale, a missing and a stray file', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-skill-stale-'));
  buildSkill(copy);
  assert.deepStrictEqual(checkSkill({ skillDir: copy }), [], 'a fresh build is current');
  fs.appendFileSync(path.join(copy, 'runtime', 'core.js'), '\n// edited by hand');
  fs.rmSync(path.join(copy, 'reference', 'blocks.md'));
  fs.writeFileSync(path.join(copy, 'runtime', 'blocks', 'mark.gone.js'), '// removed block');
  const problems = checkSkill({ skillDir: copy });
  assert(problems.includes('runtime/core.js: out of date'), problems.join('; '));
  assert(problems.includes('reference/blocks.md: missing'), problems.join('; '));
  assert(problems.includes('runtime/blocks/mark.gone.js: not part of the skill'), problems.join('; '));
  // a checkout with CRLF line endings is still current
  const crlf = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-skill-crlf-'));
  buildSkill(crlf);
  const lic = path.join(crlf, 'LICENSE');
  fs.writeFileSync(lic, fs.readFileSync(lic, 'utf8').replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(checkSkill({ skillDir: crlf }), []);
});

test('skill: one version, in SKILL.md and in the plugin; the marketplace lists this folder', () => {
  const fm = frontMatter(read('SKILL.md'));
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(
    fm['metadata.version'],
    plugin.version,
    'bump both together: Claude Code offers an update only when the version goes up',
  );
  assert.strictEqual(plugin.name, fm.name);
  assert.strictEqual(market.plugins.length, 1);
  const [entry] = market.plugins;
  assert.strictEqual(entry.name, plugin.name);
  assert.strictEqual(entry.source, './skills/blockcharts');
  assert.strictEqual(entry.description, plugin.description);
  assert.strictEqual(plugin.license, 'MIT');
  assert.strictEqual(plugin.homepage, 'https://blockcharts.online');
});

test('skill: the README a plugin directory shows is a real listing and says what the skill runs', () => {
  const readme = read('README.md');
  const prose = readme.replace(/```[\s\S]*?```/g, '');
  assert(prose.split(/\s+/).filter(Boolean).length >= 40, 'at least 40 words outside code blocks');
  assert(/## What it runs/.test(readme) && /runtime\/compose\.js/.test(readme), 'names the program it runs');
  assert(/sends no data/.test(readme), 'says what it sends');
});

test('skill: the plugin passes claude plugin validate (when the claude CLI is installed)', () => {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (probe.status !== 0) {
    console.log('     (skipped: no claude CLI)');
    return;
  }
  for (const target of ['.', 'skills/blockcharts']) {
    const r = spawnSync('claude', ['plugin', 'validate', target], { cwd: repo, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.strictEqual(r.status, 0, `claude plugin validate ${target}:\n${r.stdout}${r.stderr}`);
  }
});

test('skill: the .skill package is a zip of the folder that works on its own, the same bytes every time', async () => {
  const zip = packSkill({ skillDir: out });
  assert(zip.equals(packSkill({ skillDir: out })), 'deterministic');
  const files = unzipSync(new Uint8Array(zip));
  const names = Object.keys(files).sort();
  assert(names.includes('blockcharts/SKILL.md'), 'one top folder named like the skill, SKILL.md directly inside');
  assert(
    names.every((n) => n.startsWith('blockcharts/')),
    'nothing outside that folder',
  );
  assert(!names.some((n) => n.includes('.claude-plugin')), 'the plugin manifest is for Claude Code, not uploads');
  assert.deepStrictEqual(
    names,
    built.files
      .filter((f) => !f.startsWith('.claude-plugin/'))
      .map((f) => 'blockcharts/' + f)
      .sort(),
  );
  // unpack it and make a page with the unpacked composer alone
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-skill-unzip-'));
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), bytes);
  }
  const unpacked = require(path.join(dir, 'blockcharts', 'runtime', 'compose.js'));
  const page = JSON.parse(fs.readFileSync(path.join(skillDir, 'recipes', 'bar.json'), 'utf8'));
  const r = unpacked.compose(page);
  assert.deepStrictEqual(r.diagnostics, []);
  const { handles } = runPage(r.html);
  await handles[0].ready;
  assert.strictEqual(handles[0].host.children[0].tag, 'svg');
  assert.throws(() => packSkill({ skillDir: path.join(os.tmpdir(), 'no-skill-here') }), /SKILL\.md not found/);
});

test('skill: the package has everything it points to', () => {
  const skill = read('SKILL.md');
  for (const rel of ['runtime/compose.js', 'reference/blocks.md']) {
    assert(skill.includes(rel), `SKILL.md mentions ${rel}`);
    assert(fs.existsSync(path.join(out, rel)), `${rel} exists`);
  }
  for (const f of recipeFiles) assert(skill.includes(`recipes/${f}`), `SKILL.md lists ${f}`);
  for (const [, f] of skill.matchAll(/`recipes\/([\w-]+\.json)`/g))
    assert(recipeFiles.includes(f), `SKILL.md points at ${f}, which does not exist`);
  for (const rel of built.files) assert(fs.existsSync(path.join(out, rel)), rel);
  assert(built.files.includes('runtime/core.js') && built.files.includes('runtime/manifest.json'));
  for (const name of Object.keys(manifest.blocks))
    assert(built.files.includes(`runtime/${manifest.blocks[name].file}`), `${name} is in the package`);
});

test('skill: a script the skill names is a command an agent can run, not a module to read', () => {
  // an agent given a file name runs it; one with no command line runs, prints nothing and leaves it guessing
  const named = new Set();
  for (const rel of ['SKILL.md', 'README.md']) for (const [, f] of read(rel).matchAll(/runtime\/([\w.-]+\.js)\b/g)) named.add(f);
  assert(named.has('compose.js'), 'the composer is named');
  for (const f of named) {
    assert(fs.existsSync(path.join(out, 'runtime', f)), `runtime/${f} is in the package`);
    const r = spawnSync(process.execPath, [path.join(out, 'runtime', f)], { cwd: out, encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0, `runtime/${f} with no arguments stops`);
    assert.match(r.stderr, /usage: /, `runtime/${f} with no arguments says how to run it`);
  }
});

/** The inline code spans of a Markdown text, outside its front matter and fenced blocks, with the line each starts on. */
function codeSpans(markdown) {
  const text = markdown.replace(/\r\n/g, '\n');
  let fence = false;
  let front = text.startsWith('---\n');
  const prose = text
    .split('\n')
    .map((line, i) => {
      if (front) {
        if (i > 0 && line === '---') front = false;
        return '';
      }
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n');
  const spans = [];
  for (const m of prose.matchAll(/(`+)([\s\S]*?[^`])\1(?!`)/g))
    spans.push({ line: prose.slice(0, m.index).split('\n').length, code: m[2] });
  return spans;
}

test('skill: a code example in the docs is on one line, and one in JSON is JSON an agent can copy', () => {
  for (const rel of ['SKILL.md', 'reference/blocks.md', 'README.md'])
    for (const s of codeSpans(read(rel)))
      assert(!s.code.includes('\n'), `${rel}:${s.line}: \`${s.code}\` is broken over lines (a JSON string writes a line break as \\n)`);
  const spans = codeSpans(read('SKILL.md'));
  let examples = 0;
  for (const s of spans) {
    // `[{...}]`, `{"op": "sum" | "mean"}` and `{title, note}` show a shape, not a value to copy
    if (!/^(\{"|\[\{"|\["|\[-?\d)/.test(s.code) || /\.\.|\s\|\s/.test(s.code)) continue;
    assert.doesNotThrow(() => JSON.parse(s.code), `SKILL.md:${s.line}: ${s.code}`);
    examples++;
  }
  assert(examples >= 30, `the JSON examples were found (${examples})`);
  const csv = spans.find((s) => s.code.startsWith('{"csv"'));
  assert(csv, 'SKILL.md shows a CSV dataset');
  const { columns, warnings } = parseCsv(JSON.parse(csv.code).csv);
  assert.deepStrictEqual(Object.keys(columns), ['date', 'region', 'amount'], 'the first line names the columns');
  assert.deepStrictEqual(columns.amount, [1200, 2300], 'a row per line, numbers read as numbers');
  assert.deepStrictEqual(warnings, []);
});

test('skill: the block reference is generated from the manifest and mentions every block, parameter and channel', () => {
  const ref = read('reference/blocks.md');
  assert.strictEqual(ref, renderReference(manifest), 'exactly what the generator produces');
  assert.strictEqual(renderReference(manifest), renderReference(manifest), 'deterministic');
  const sections = ref.split(/^## /m).slice(1);
  for (const [name, b] of Object.entries(manifest.blocks)) {
    const section = sections.find((s) => s.startsWith(name + '\n'));
    assert(section, `${name} has a section`);
    if (b.doc) assert(section.includes(b.doc.slice(0, 40)), `${name}: doc text`);
    for (const p of Object.keys(b.params || {})) assert(section.includes('`' + p + '`'), `${name}: parameter ${p}`);
    for (const c of Object.keys(b.channels || {})) assert(section.includes('`' + c + '`'), `${name}: channel ${c}`);
    for (const [p, def] of Object.entries(b.params || {}))
      if (def.required) assert(new RegExp('`' + p + '` \\|[^|]*\\*\\*required\\*\\*').test(section), `${name}.${p} is marked required`);
  }
  assert(/## Keys every spec has/.test(ref));
});

test('skill: the reference cannot lie about a parameter the code does not have (a renamed one breaks this)', () => {
  const fake = JSON.parse(JSON.stringify(manifest));
  fake.blocks['mark.rect'].params.renamed = { kind: 'number', doc: 'x' };
  assert(renderReference(fake).includes('`renamed`') && !renderReference(manifest).includes('`renamed`'));
});

for (const file of recipeFiles) {
  test(`skill: recipe ${file} is a complete page that composes cleanly and draws`, async () => {
    const page = JSON.parse(fs.readFileSync(path.join(skillDir, 'recipes', file), 'utf8'));
    assert(page.title && page.data && Array.isArray(page.charts) && page.charts.length, 'title, data and charts');
    for (const key of Object.keys(page))
      assert(
        ['title', 'subtitle', 'layout', 'data', 'charts', 'css', 'compress'].includes(key),
        `page key ${key} is one SKILL.md documents`,
      );

    const result = packagedCompose.compose(page); // the packaged runtime, not the repo's
    assert.deepStrictEqual(result.diagnostics, [], 'no errors and no warnings');
    assert.deepStrictEqual(result.unusedData, [], 'every dataset is used');
    assert(result.html.startsWith('<!doctype html>'));
    assert(/^core\.composed(-plain)?\.js$/.test(result.core), `a lean core: ${result.core}`);

    const { handles, BC, errors } = runPage(result.html);
    const panels = result.html.split('class="bc-facet"').length - 1;
    assert.strictEqual(handles.length, page.charts.filter((c) => !c.facet).length + panels, 'a chart per entry, and per panel of a facet');
    for (const h of handles) {
      await h.ready;
      assert.strictEqual(h.diagnostics.length, 0, JSON.stringify(h.diagnostics));
      assert(['svg', 'canvas'].includes(h.host.children[0].tag), 'a chart was drawn');
    }
    await BC.ready();
    assert.deepStrictEqual(errors, [], 'nothing was reported to the console');
    assert.strictEqual(BC.validate, undefined, 'the page does without the checks the composer has run');
  });
}

test('skill: in every recipe a mark names the color it drew each row in (MarkDef.color), the one a tooltip shows', async () => {
  const wrong = [];
  let checked = 0;
  for (const file of recipeFiles) {
    const page = JSON.parse(fs.readFileSync(path.join(skillDir, 'recipes', file), 'utf8'));
    const { handles, BC } = runPage(packagedCompose.compose(page).html);
    for (const h of handles) await h.ready;
    // every mark that names its colors is drawn again, and what it drew is held against what it names
    for (const name of BC.blocks().filter((b) => b.startsWith('mark.'))) {
      const def = BC.get(name);
      if (!def.color) continue;
      const render = def.render;
      def.render = (spec, ctx, index) => {
        const prims = render(spec, ctx, index);
        const say = (row) => def.color(spec, ctx, index, row);
        const where = `${file}: ${name} #${index}`;
        if (def.series) {
          // one shape per series that has a point, in the order of the series, in the color it names for its rows
          const xs = ctx.channel(spec, 'x').mapped;
          const ys = ctx.channel(spec, 'y').mapped;
          const series = ctx.series(spec, xs).filter((s) => s.rows.some((i) => isFinite(xs[i]) && isFinite(ys[i])) && say(s.rows[0]));
          const drawn = prims.map((p) => (p.style.fill && p.style.fill !== 'none' ? p.style.fill : p.style.stroke));
          if (series.length !== drawn.length) wrong.push(`${where}: ${series.length} series, ${drawn.length} shapes`);
          else
            series.forEach((s, n) => {
              for (const row of [s.rows[0], s.rows[s.rows.length >> 1], s.rows[s.rows.length - 1]]) {
                checked++;
                if (say(row) !== drawn[n]) wrong.push(`${where} row ${row}: names ${say(row)}, drew ${drawn[n]}`);
              }
            });
        }
        for (const p of prims) {
          if (!p.ref || p.ref.mark !== index) continue;
          const drawn = p.style.fill && p.style.fill !== 'none' ? p.style.fill : p.style.stroke;
          checked++;
          if (say(p.ref.row) !== drawn) wrong.push(`${where} row ${p.ref.row}: names ${say(p.ref.row)}, drew ${drawn}`);
        }
        return prims;
      };
    }
    for (const h of handles) h.update(h.spec);
  }
  assert.deepStrictEqual(wrong.slice(0, 10), []);
  assert(checked > 1000, `rows checked: ${checked}`);
});

test('skill: the recipes together use every block, so the documentation of each one is exercised', () => {
  const used = new Set();
  for (const f of recipeFiles) {
    const page = JSON.parse(fs.readFileSync(path.join(skillDir, 'recipes', f), 'utf8'));
    for (const b of packagedCompose.compose(page).blocks) used.add(b);
  }
  const unused = Object.keys(manifest.blocks).filter((b) => !used.has(b));
  assert.deepStrictEqual(unused, [], 'add a recipe (or a feature to one) for: ' + unused.join(', '));
});

test('skill: the packaged runtime works with nothing from the repo around it', () => {
  // the packaged compose must have found its own manifest, not the repo dist
  const r = packagedCompose.compose({
    data: { a: [{ k: 'x', v: 1 }] },
    charts: [{ data: 'a', scales: { x: { type: 'band' }, y: { type: 'linear' } }, marks: [{ type: 'rect', x: 'k', y: 'v' }] }],
  });
  assert.deepStrictEqual(r.blocks, ['lib.ticks', 'scale.band', 'scale.linear', 'mark.rect', 'renderer.svg']);
  assert.throws(
    () => packagedCompose.compose({ data: {}, charts: [{ data: 'a', marks: [] }], distDir: path.join(os.tmpdir(), 'nowhere') }),
    /manifest\.json not found/,
  );
});

test('skill: rebuilding replaces the package and cannot be pointed at a dangerous folder', () => {
  fs.writeFileSync(path.join(out, 'recipes', 'stale.json'), '{}');
  fs.mkdirSync(path.join(out, 'runtime', 'blocks'), { recursive: true });
  fs.writeFileSync(path.join(out, 'runtime', 'blocks', 'mark.gone.js'), '// removed block');
  fs.writeFileSync(path.join(out, 'my-notes.txt'), 'not ours');
  const again = buildSkill(out);
  assert(!fs.existsSync(path.join(out, 'recipes', 'stale.json')), 'stale recipes are removed');
  assert(!fs.existsSync(path.join(out, 'runtime', 'blocks', 'mark.gone.js')), 'stale blocks are removed');
  assert(fs.existsSync(path.join(out, 'my-notes.txt')), 'files the build does not own are left alone');
  assert.deepStrictEqual(again.files, built.files, 'the same files every time');
  for (const bad of [repo, path.join(repo, 'dist'), path.join(repo, 'skills'), path.join(repo, 'src'), path.parse(repo).root]) {
    assert.throws(() => buildSkill(bad), /refusing to build the skill into/, bad);
  }
  assert.throws(() => buildSkill(out, { distDir: path.join(os.tmpdir(), 'no-dist') }), /manifest\.json not found/);
  assert.throws(() => buildSkill(out, { skillDir: path.join(os.tmpdir(), 'no-skill') }), /not found/);
});

(async () => {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed++;
      console.log('ok  ', name);
    } catch (e) {
      failed++;
      console.log('FAIL', name);
      console.error(e);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
})();
