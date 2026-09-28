// Minified copies of the core and the blocks, for everything that ships code: the release folder, the composer, the skill.
//   node scripts/minify.js [distDir] [outDir]     dist/ -> dist/min/ (same layout and manifest.json, smaller files)
// Only whitespace, local names and syntax are shrunk: top-level names and every property name stay as they are (the blocks talk
// through BC.* and specs name things by string), and es2020 is the floor. Blocks also lose their `doc` strings.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

class MinifyError extends Error {}

function minify(name, source) {
  try {
    return esbuild.transformSync(source.toString('utf8'), { minify: true, target: 'es2020', legalComments: 'none', sourcefile: name }).code;
  } catch (e) {
    throw new MinifyError(`cannot minify ${name}: ${e.message}`);
  }
}

// The doc strings of a block (what it is for, what each parameter means) feed the reference and the manifest; a running
// chart never reads them, and they are a tenth of the code. They are cut from the shipped copy, and the cut is checked:
// the block is run against a stub BC before and after, and everything but the docs must be identical (functions included).
const DOC = /\bdoc:\s*(?:'(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*")\s*,?/g;

function signature(name, source) {
  const defs = [];
  vm.runInNewContext(source, { BC: { define: (d) => defs.push(d) } }, { filename: name, timeout: 1000 });
  return JSON.stringify(defs, (k, v) => (k === 'doc' && typeof v === 'string' ? undefined : typeof v === 'function' ? v.toString() : v));
}

function stripDocs(name, source) {
  const out = source.replace(DOC, '');
  let same = false;
  try {
    same = signature(name, out) === signature(name, source);
  } catch (e) {
    throw new MinifyError(`cannot strip the docs of ${name}: the result does not run (${e.message})`);
  }
  if (!same) throw new MinifyError(`cannot strip the docs of ${name}: more than the docs changed`);
  return out;
}

/** Minified text of a block (docs cut first) or of the core / loader (isBlock false). */
const shrink = (name, source, isBlock) => minify(name, isBlock ? stripDocs(name, source.toString('utf8')) : source) + '\n';

/** dist/ -> outDir: core and blocks minified, manifest.json copied with the sizes of the new files. Returns the manifest. */
function buildMin(distDir, outDir) {
  const dist = path.resolve(distDir);
  const out = path.resolve(outDir || path.join(dist, 'min'));
  if (out === dist || out === path.parse(out).root || dist.startsWith(out + path.sep)) throw new MinifyError(`refusing to write minified files into ${out}`);
  const manifestFile = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new MinifyError(`${manifestFile} not found: run npm run build and npm run manifest first`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'blocks'), { recursive: true });
  const write = (rel, isBlock) => {
    const text = shrink(rel, fs.readFileSync(path.join(dist, rel)), isBlock);
    fs.writeFileSync(path.join(out, rel), text);
    return Buffer.byteLength(text);
  };
  manifest.core.bytes = write(manifest.core.file, false);
  for (const name of Object.keys(manifest.blocks)) manifest.blocks[name].bytes = write(manifest.blocks[name].file, true);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { minify, stripDocs, shrink, buildMin, MinifyError };

if (require.main === module) {
  try {
    const dist = path.resolve(process.argv[2] || path.join(__dirname, '../dist'));
    const out = path.resolve(process.argv[3] || path.join(dist, 'min'));
    const before = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
    const m = buildMin(dist, out);
    const total = (x) => Object.values(x.blocks).reduce((n, b) => n + b.bytes, x.core.bytes);
    console.log(`minified: ${(total(before) / 1024).toFixed(1)} KB -> ${(total(m) / 1024).toFixed(1)} KB in ${out}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
