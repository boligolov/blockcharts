// The agent skill, skills/blockcharts/: a folder that works on its own, committed so the plugin marketplace can install it.
//   SKILL.md, README.md, .claude-plugin/plugin.json, recipes/*.json   written by hand, in the skill folder
//   LICENSE             a copy of the repository's
//   reference/blocks.md every block, parameter and channel, GENERATED from the manifest so it cannot drift from the code
//   runtime/            core.js, blocks/, manifest.json, compose.js: `node runtime/compose.js page.json out.html`
// Usage: node scripts/build-skill.js           refresh the generated parts of skills/blockcharts and write dist/blockcharts.skill
//        node scripts/build-skill.js --check   exit 1 if skills/blockcharts differs from a fresh build
//        node scripts/build-skill.js <outDir>  a complete copy of the skill somewhere else
const fs = require('fs');
const os = require('os');
const path = require('path');
const { zipSync } = require('fflate');

const repo = path.join(__dirname, '..');
const SKILL_DIR = path.join(repo, 'skills', 'blockcharts');
const cell = (v) => String(v === undefined ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (v) => '`' + String(v).replace(/`/g, "'") + '`';

function paramRows(params) {
  return Object.keys(params).map((name) => {
    const p = params[name];
    const kind = p.kind === 'enum' ? `one of ${(p.values || []).map(code).join(', ')}` : p.kind;
    const def = p.default === undefined ? '' : code(JSON.stringify(p.default));
    return `| ${code(name)} | ${cell(kind)}${p.required ? ', **required**' : ''} | ${def} | ${cell(p.doc)} |`;
  });
}

function channelRows(channels) {
  return Object.keys(channels).map((name) => {
    const c = channels[name];
    const scales = c.unscaled ? 'none (a plain field)' : c.scales ? c.scales.map(code).join(', ') : 'any';
    const extra = [c.sharesScale ? `uses the scale of ${code(c.sharesScale)} unless told otherwise` : '', c.default !== undefined ? `default ${code(JSON.stringify(c.default))}` : '', c.doc || ''].filter(Boolean).join('. ');
    return `| ${code(name)} | ${c.required ? '**required**' : 'optional'} | ${scales} | ${cell(extra)} |`;
  });
}

function renderReference(manifest) {
  const names = Object.keys(manifest.blocks);
  const out = [];
  out.push('# Block reference');
  out.push('');
  out.push('Generated from the code by `scripts/build-skill.js`; do not edit. A chart spec refers to a block by its `type`: `{"type": "rect"}` is `mark.rect`.');
  out.push('');
  out.push('- **scale**: maps data to positions or colors. Declared once per chart under `scales`, by name.');
  out.push('- **transform**: prepares the dataset before anything is drawn (`transforms`).');
  out.push('- **mark**: draws the data (`marks`). Its channels (`x`, `y`, `color`, ...) name the fields to read.');
  out.push('- **guide**: axes, grid, legend (`guides`), attached to a scale.');
  out.push('- **interaction**: zoom, tooltip (`interaction`).');
  out.push('- **renderer**: draws the picture; `svg` is the default and needs no mention.');
  out.push('');
  out.push(`${names.length} blocks: ${names.map(code).join(', ')}.`);
  out.push('');
  out.push('## Keys every spec has');
  out.push('');
  out.push('| Where | Key | Meaning |');
  out.push('| --- | --- | --- |');
  out.push('| chart | `data` | name of a dataset in the page data (required) |');
  out.push('| chart | `size` | `[width, height]` of the drawing, default `[640, 400]`; the chart scales to its container |');
  out.push('| chart | `title` | text above the plot |');
  out.push('| chart | `padding` | `{top, right, bottom, left}` in drawing units, default 16 each |');
  out.push('| chart | `transforms`, `scales`, `guides`, `marks`, `interaction` | lists of blocks (`scales` is an object of named scales) |');
  out.push('| chart | `view` | starting zoom: `{"x": [from, to]}` (dates as ISO strings or milliseconds) |');
  out.push(`| scale | \`type\` | the scale block: ${names.filter((n) => n.startsWith('scale.')).map((n) => code(n.slice(6))).join(', ')} |`);
  out.push('| scale | `domain` | fixed domain instead of the inferred one: `[min, max]` for linear and time, a list of values for band and color |');
  out.push('| scale | `range` | `"width"` or `"height"` (the default of `x` and `y`), or an explicit list, e.g. colors for a color scale |');
  out.push('| scale | `field` | an extra field to include when inferring the domain |');
  out.push('| guide | `scale` | name of the scale the guide belongs to |');
  out.push('| guide | `position` | `top`, `right`, `bottom` or `left`; the default follows the scale (height: left, width: bottom) |');
  out.push('| mark | channels | `"field"`, `{"field": "f", "scale": "s"}` or `{"value": v}`; see each mark |');
  for (const name of names) {
    const b = manifest.blocks[name];
    out.push('');
    out.push(`## ${name}`);
    out.push('');
    out.push(`Version ${b.version}, ${(b.bytes / 1024).toFixed(1)} KB. ${b.doc || ''}`.trim());
    if (b.requires && b.requires.length) {
      out.push('');
      out.push(`Needs: ${b.requires.map(code).join(', ')}.`);
    }
    if (b.channels && Object.keys(b.channels).length) {
      out.push('');
      out.push('| Channel | | Accepted scales | Notes |');
      out.push('| --- | --- | --- | --- |');
      out.push(...channelRows(b.channels));
    }
    if (b.params && Object.keys(b.params).length) {
      out.push('');
      out.push('| Parameter | Type | Default | Notes |');
      out.push('| --- | --- | --- | --- |');
      out.push(...paramRows(b.params));
    }
  }
  out.push('');
  return out.join('\n');
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// Written by hand, in skills/blockcharts/ (copied along when the skill is built somewhere else).
const AUTHORED = ['SKILL.md', 'README.md', '.claude-plugin/plugin.json'];
// Generated from the repository; a test fails while the committed copy differs (`npm run skill` refreshes it).
const GENERATED_DIRS = ['reference', 'runtime'];
const RUNTIME_SCRIPTS = ['compose.js', 'build-manifest.js', 'fake-dom.js', 'csv.js', 'encode-columns.js'];

/**
 * Writes the generated parts of the skill: LICENSE, reference/blocks.md (from the manifest) and runtime/
 * (minified core and blocks, the manifest and the composer). Into the skill folder itself by default; into any
 * other folder, the authored files and recipes are copied too, so the result is a complete skill either way.
 */
function buildSkill(outDir, options) {
  const opts = options || {};
  // the runtime of the skill is the minified code when the build made it (dist/min); an explicit distDir is used as it is
  const built = path.join(repo, 'dist');
  const dist = path.resolve(opts.distDir || (fs.existsSync(path.join(built, 'min', 'manifest.json')) ? path.join(built, 'min') : built));
  const skillDir = path.resolve(opts.skillDir || SKILL_DIR);
  const out = path.resolve(outDir || skillDir);
  const forbidden = [path.parse(out).root, repo, dist, built, path.join(repo, 'skills'), path.join(repo, 'src'), path.join(repo, 'scripts')];
  if (forbidden.includes(out)) throw new Error(`refusing to build the skill into ${out}`);

  const manifestFile = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`${manifestFile} not found: run npm run build and npm run manifest first`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const rel of ['SKILL.md', 'recipes']) if (!fs.existsSync(path.join(skillDir, rel))) throw new Error(`${path.join(skillDir, rel)} not found`);

  // only the folders this script owns are cleared, so stale files of removed blocks or recipes cannot linger
  const owned = out === skillDir ? GENERATED_DIRS : ['recipes', ...GENERATED_DIRS];
  for (const sub of owned) fs.rmSync(path.join(out, sub), { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  const put = (rel) => files.push(rel);

  for (const rel of AUTHORED) {
    if (!fs.existsSync(path.join(skillDir, rel))) continue;
    if (out !== skillDir) copyFile(path.join(skillDir, rel), path.join(out, rel));
    put(rel);
  }
  for (const f of fs.readdirSync(path.join(skillDir, 'recipes')).filter((n) => n.endsWith('.json') || n.endsWith('.csv')).sort()) {
    if (out !== skillDir) copyFile(path.join(skillDir, 'recipes', f), path.join(out, 'recipes', f));
    put(`recipes/${f}`);
  }
  copyFile(path.join(repo, 'LICENSE'), path.join(out, 'LICENSE'));
  put('LICENSE');
  fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(out, 'reference', 'blocks.md'), renderReference(manifest));
  put('reference/blocks.md');

  copyFile(path.join(dist, manifest.core.file), path.join(out, 'runtime', manifest.core.file));
  put(`runtime/${manifest.core.file}`);
  copyFile(manifestFile, path.join(out, 'runtime', 'manifest.json'));
  put('runtime/manifest.json');
  for (const name of Object.keys(manifest.blocks)) {
    const rel = manifest.blocks[name].file;
    copyFile(path.join(dist, rel), path.join(out, 'runtime', rel));
    put(`runtime/${rel}`);
  }
  for (const f of RUNTIME_SCRIPTS) {
    copyFile(path.join(__dirname, f), path.join(out, 'runtime', f));
    put(`runtime/${f}`);
  }
  return { out, files: files.sort() };
}

/** Every file under dir, as sorted forward-slash paths relative to it. */
function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return out.sort();
}

// Text is compared and packed with LF line endings, so a checkout with CRLF gives the same answer and the same bytes.
const TEXT = /\.(md|json|js|csv|txt)$/;
const bytesOf = (file) => {
  const b = fs.readFileSync(file);
  return TEXT.test(file) || path.basename(file) === 'LICENSE' ? Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : b;
};

/**
 * What in the skill folder differs from a fresh build: files that are stale, missing or should not be there.
 * An empty list means the committed skill is current.
 */
function checkSkill(options) {
  const opts = options || {};
  const skillDir = path.resolve(opts.skillDir || SKILL_DIR);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-skill-check-'));
  try {
    const fresh = buildSkill(tmp, { ...opts, skillDir });
    const problems = [];
    for (const rel of fresh.files) {
      const have = path.join(skillDir, rel);
      if (!fs.existsSync(have)) problems.push(`${rel}: missing`);
      else if (!bytesOf(have).equals(bytesOf(path.join(tmp, rel)))) problems.push(`${rel}: out of date`);
    }
    for (const rel of listFiles(skillDir)) if (!fresh.files.includes(rel)) problems.push(`${rel}: not part of the skill`);
    return problems;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The skill's version, from .claude-plugin/plugin.json (a test keeps SKILL.md's metadata.version equal). */
function skillVersion(skillDir) {
  return JSON.parse(fs.readFileSync(path.join(skillDir || SKILL_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

/**
 * The skill as an uploadable .skill file (a zip): one top-level folder, blockcharts/, with SKILL.md directly inside,
 * without .claude-plugin/ (that is for Claude Code, not for uploads). The same files give the same bytes: sorted
 * entries, a fixed date, LF line endings.
 */
function packSkill(options) {
  const opts = options || {};
  const skillDir = path.resolve(opts.skillDir || SKILL_DIR);
  const name = opts.name || 'blockcharts';
  const entries = {};
  for (const rel of listFiles(skillDir)) {
    if (rel.startsWith('.claude-plugin/')) continue;
    entries[`${name}/${rel}`] = [new Uint8Array(bytesOf(path.join(skillDir, rel))), { mtime: new Date(Date.UTC(2026, 0, 1)), level: 9 }];
  }
  if (!entries[`${name}/SKILL.md`]) throw new Error(`${path.join(skillDir, 'SKILL.md')} not found`);
  return Buffer.from(zipSync(entries));
}

module.exports = { buildSkill, checkSkill, packSkill, skillVersion, renderReference, listFiles, SKILL_DIR };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--check')) {
      const problems = checkSkill();
      if (problems.length) {
        console.error(`the skill in ${SKILL_DIR} is out of date (run npm run skill):\n  ${problems.join('\n  ')}`);
        process.exit(1);
      }
      console.log('skill: current');
    } else {
      const r = buildSkill(args[0]);
      console.log(`skill: ${r.files.length} files -> ${r.out}`);
      if (!args[0]) {
        const zip = packSkill();
        const file = path.join(repo, 'dist', 'blockcharts.skill');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, zip);
        console.log(`package: ${file} (version ${skillVersion()}, ${zip.length} bytes)`);
      }
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
