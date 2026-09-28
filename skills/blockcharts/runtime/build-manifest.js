// Builds dist/manifest.json from the compiled blocks by running each one against a stub BC that records
// its BC.define call: nothing is parsed, `requires` is written once, in the block itself.
// Usage: node scripts/build-manifest.js [distDir]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROLES = ['scale', 'transform', 'mark', 'guide', 'interaction', 'renderer'];
const byRoleThenName = (a, b) => ROLES.indexOf(a.split('.')[0]) - ROLES.indexOf(b.split('.')[0]) || (a < b ? -1 : a > b ? 1 : 0);
// A block is inlined into an HTML <script>; either of these would end the script or start a comment early.
const UNSAFE_IN_SCRIPT = /<\/script|<!--/i;

/** Plain-JSON copy of a value that came out of a vm realm (drops functions, keeps the data). */
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function buildManifest(distDir) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  const coreFile = path.join(distDir, 'core.js');
  const blocksDir = path.join(distDir, 'blocks');
  if (!fs.existsSync(coreFile)) throw new Error(`manifest: ${coreFile} not found, run the TypeScript build first`);
  if (!fs.existsSync(blocksDir)) throw new Error(`manifest: ${blocksDir} not found, run the TypeScript build first`);

  const coreSrc = fs.readFileSync(coreFile, 'utf8');
  const version = (coreSrc.match(/const VERSION = '([^']+)'/) || [])[1];
  if (!version) fail('core.js: cannot find `const VERSION = "..."`');
  if (UNSAFE_IN_SCRIPT.test(coreSrc)) fail('core.js contains "</script" or "<!--", which would break an inlined page');

  const blocks = {};
  for (const file of fs.readdirSync(blocksDir).filter((f) => f.endsWith('.js')).sort()) {
    const src = fs.readFileSync(path.join(blocksDir, file), 'utf8');
    if (UNSAFE_IN_SCRIPT.test(src)) fail(`${file} contains "</script" or "<!--", which would break an inlined page`);

    const defs = [];
    try {
      vm.runInNewContext(src, { BC: { define: (d) => defs.push(d) } }, { filename: file, timeout: 1000 });
    } catch (e) {
      fail(`${file} failed to run against the stub BC: ${e.message}`);
      continue;
    }
    if (defs.length !== 1) {
      fail(`${file} must call BC.define exactly once (it called it ${defs.length} times)`);
      continue;
    }
    const def = defs[0];
    if (ROLES.indexOf(def.role) < 0 || typeof def.type !== 'string' || !def.type) {
      fail(`${file}: invalid role/type (${def.role}/${def.type})`);
      continue;
    }
    if (!Number.isInteger(def.version) || def.version < 1) {
      fail(`${file}: version must be a positive integer`);
      continue;
    }
    const name = `${def.role}.${def.type}`;
    if (file !== `${name}.js`) fail(`${file} defines ${name}; the file must be named ${name}.js`);
    if (blocks[name]) fail(`${name} is defined twice`);
    blocks[name] = {
      file: `blocks/${file}`,
      bytes: Buffer.byteLength(src),
      version: def.version,
      requires: plain(def.requires) || [],
      closure: [],
      params: plain(def.params),
      channels: plain(def.channels),
      doc: def.doc,
    };
  }

  // closure = the block plus everything it needs, transitively; a composer unions these across a page
  const done = {};
  const visit = (name, stack) => {
    if (done[name]) return done[name];
    if (stack.indexOf(name) >= 0) {
      fail(`dependency cycle: ${stack.slice(stack.indexOf(name)).concat(name).join(' -> ')}`);
      return [name];
    }
    const set = new Set([name]);
    for (const req of blocks[name].requires) {
      if (!blocks[req]) {
        fail(`${name} requires ${req}, which no block file provides`);
        continue;
      }
      for (const n of visit(req, stack.concat(name))) set.add(n);
    }
    return (done[name] = Array.from(set).sort(byRoleThenName));
  };
  for (const name of Object.keys(blocks)) blocks[name].closure = visit(name, []);

  if (errors.length) throw new Error('manifest: ' + errors.length + ' problem(s)\n - ' + errors.join('\n - '));

  const sorted = {};
  for (const name of Object.keys(blocks).sort(byRoleThenName)) sorted[name] = blocks[name];
  return { core: { file: 'core.js', bytes: Buffer.byteLength(coreSrc), version }, blocks: sorted };
}

module.exports = { buildManifest, ROLES, byRoleThenName };

if (require.main === module) {
  const dist = path.resolve(process.argv[2] || path.join(__dirname, '../dist'));
  try {
    const manifest = buildManifest(dist);
    fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const names = Object.keys(manifest.blocks);
    const total = names.reduce((n, k) => n + manifest.blocks[k].bytes, manifest.core.bytes);
    console.log(`manifest: core ${manifest.core.version} + ${names.length} blocks, ${(total / 1024).toFixed(1)} KB in all -> ${path.join(dist, 'manifest.json')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
