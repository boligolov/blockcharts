// Builds the release folder: everything a CDN or an integration needs, as plain files.
//   core.js, blocks/<role.type>.js   every part on its own (loader.js fetches only what a page uses)
//   kits/<name>.js, kits/<name>.mjs  core + a chosen set of blocks in ONE file (classic script / ES module)
//   loader.js                        loads core + needed blocks from separate files: BCLoader.load()
//   bc.d.ts                          types
//   manifest.json                    versions, dependencies, sizes and SRI hashes of all of the above
// Kits come from kits.json; a page can get its own kit with --page (exactly the blocks its charts use).
// Same input, same bytes: no dates, no absolute paths, fixed order.
// Usage: node scripts/build-dist.js [outDir] [--page page.json[=name]]...     (default release/)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { byRoleThenName } = require('./build-manifest.js');
const { shrink, MinifyError } = require('./minify.js');

const repo = path.join(__dirname, '..');
const NAME = /^[a-z][a-z0-9-]*$/;

class ReleaseError extends Error {}

const sri = (buf) => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
const describe = (file, buf) => ({ file, bytes: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length, sha384: sri(buf) });

function checkOutDir(outDir) {
  const rel = path.relative(repo, outDir);
  const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  const top = rel.split(path.sep)[0];
  if (inside && ['src', 'dist', 'scripts', 'docs', 'skills', 'node_modules', '.git'].includes(top)) throw new ReleaseError(`refusing to write the release into ${outDir}`);
  if (!rel) throw new ReleaseError('refusing to write the release into the repository root');
  if (path.dirname(outDir) === outDir) throw new ReleaseError('refusing to write the release into a filesystem root');
}

/** Blocks of a kit definition: a list of names, or "*" for all; returns the closure union in role order. */
function kitBlocks(name, def, manifest) {
  if (!def || (def.blocks !== '*' && !Array.isArray(def.blocks))) throw new ReleaseError(`kit "${name}": "blocks" must be a list of block names or "*"`);
  const asked = def.blocks === '*' ? Object.keys(manifest.blocks) : def.blocks;
  const missing = asked.filter((n) => !manifest.blocks[n]);
  if (missing.length) throw new ReleaseError(`kit "${name}": no such block: ${missing.join(', ')}`);
  const set = new Set();
  for (const n of asked) for (const c of manifest.blocks[n].closure) set.add(c);
  return Array.from(set).sort(byRoleThenName);
}

/**
 * options: { distDir, outDir, kits: { name: { doc?, blocks } }, pageKits: [{ name, blocks }], typesFile?, minify? (default true) }
 * Returns the release manifest (also written as manifest.json).
 */
function buildRelease(options) {
  const distDir = options.distDir;
  const outDir = path.resolve(options.outDir);
  checkOutDir(outDir);
  const small = options.minify !== false;
  const read = (file) => fs.readFileSync(path.join(distDir, file));
  const script = (file, isBlock) => {
    if (!small) return read(file);
    try {
      return Buffer.from(shrink(file, read(file), isBlock));
    } catch (e) {
      throw e instanceof MinifyError ? new ReleaseError(e.message) : e;
    }
  };
  const manifest = JSON.parse(read('manifest.json').toString('utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.core.version) throw new ReleaseError(`package.json says ${pkg.version} but the core says ${manifest.core.version}: keep them equal`);

  const kits = {};
  for (const name of Object.keys(options.kits || {})) kits[name] = { doc: options.kits[name].doc, blocks: options.kits[name].blocks };
  for (const p of options.pageKits || []) {
    if (kits[p.name]) throw new ReleaseError(`kit "${p.name}" is defined twice`);
    kits[p.name] = { doc: 'Exactly the blocks one page uses.', blocks: p.blocks };
  }
  for (const name of Object.keys(kits)) if (!NAME.test(name)) throw new ReleaseError(`kit name "${name}" must be lowercase letters, digits and dashes`);

  // a release is rebuilt from scratch: only the folders and files it owns are removed
  fs.mkdirSync(outDir, { recursive: true });
  for (const sub of ['blocks', 'kits']) fs.rmSync(path.join(outDir, sub), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'blocks'));
  fs.mkdirSync(path.join(outDir, 'kits'));
  const put = (file, buf) => {
    fs.writeFileSync(path.join(outDir, file), buf);
    return describe(file, buf);
  };

  const coreSrc = script(manifest.core.file);
  const version = manifest.core.version;
  const licence = (buf) => Buffer.concat([Buffer.from(`/*! blockcharts ${version} | MIT License */\n`), buf]);
  const release = { name: 'blockcharts', version, core: { ...put('core.js', licence(coreSrc)), version }, blocks: {}, kits: {} };
  const srcOf = {};
  for (const name of Object.keys(manifest.blocks)) {
    const b = manifest.blocks[name];
    srcOf[name] = script(b.file, true);
    release.blocks[name] = { ...put(b.file, licence(srcOf[name])), version: b.version, requires: b.requires, closure: b.closure };
  }
  release.loader = put('loader.js', licence(script('loader.js')));
  const types = options.typesFile || path.join(repo, 'src', 'bc.d.ts');
  release.types = put('bc.d.ts', fs.readFileSync(types));

  for (const name of Object.keys(kits).sort()) {
    const blocks = kitBlocks(name, kits[name], manifest);
    const banner = `/*! blockcharts ${release.version} kit "${name}": ${blocks.join(', ')} | MIT License */\n`;
    const body = [coreSrc.toString('utf8')].concat(blocks.map((n) => srcOf[n].toString('utf8'))).join('\n');
    release.kits[name] = {
      doc: kits[name].doc,
      blocks,
      js: put(`kits/${name}.js`, Buffer.from(banner + body + '\n')),
      mjs: put(`kits/${name}.mjs`, Buffer.from(banner + body + '\nexport default globalThis.BC;\n')),
      // what TypeScript sees when a kit is imported as a module: the runtime, typed by bc.d.ts
      dts: put(`kits/${name}.d.mts`, Buffer.from('/// <reference path="../bc.d.ts" />\ndeclare const runtime: BC.Runtime;\nexport default runtime;\n')),
    };
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(release, null, 2) + '\n');
  return release;
}

module.exports = { buildRelease, ReleaseError };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    let outDir = path.join(repo, 'release');
    const pages = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--page') {
        if (!args[i + 1]) throw new ReleaseError('--page needs a page.json path');
        pages.push(args[++i]);
      } else outDir = path.resolve(args[i]);
    }
    const distDir = path.join(repo, 'dist');
    const { compose } = require('./compose.js');
    const pageKits = pages.map((spec) => {
      const eq = spec.lastIndexOf('=');
      const file = path.resolve(eq > 0 ? spec.slice(0, eq) : spec);
      const name = eq > 0 ? spec.slice(eq + 1) : path.basename(file).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const page = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { name, blocks: compose({ ...page, baseDir: path.dirname(file), distDir }).blocks };
    });
    const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));
    const release = buildRelease({ distDir, outDir, kits, pageKits });
    const kb = (n) => (n / 1024).toFixed(1) + ' KB';
    console.log(`release ${release.version} -> ${outDir}`);
    console.log(`  core ${kb(release.core.bytes)}, ${Object.keys(release.blocks).length} blocks, loader ${kb(release.loader.bytes)}`);
    for (const [name, k] of Object.entries(release.kits)) console.log(`  kit ${name.padEnd(12)} ${String(k.blocks.length).padStart(2)} blocks ${kb(k.js.bytes).padStart(9)}  gzip ${kb(k.js.gzip)}`);
  } catch (e) {
    console.error(e instanceof ReleaseError || e.name === 'ComposeError' ? e.message : e.stack);
    process.exit(1);
  }
}
