// What the code of a page weighs, defined once for the site (site/src/lib/site.mjs) and the docs (build-docs.js): bytes
// of dist/min, the minified files the composer puts into a page.
const fs = require('fs');
const path = require('path');
const { gzipSync } = require('fflate');

const DIST = path.join(__dirname, '..', 'dist');

const minDir = (distDir) => path.join(distDir || DIST, 'min');
const minManifest = (distDir) => JSON.parse(fs.readFileSync(path.join(minDir(distDir), 'manifest.json'), 'utf8'));

/** What a file weighs gzipped, wherever a size says gzip (the site, the docs, the release manifest): fflate at level 9,
 *  the same bytes on every machine, which a check of the docs needs. A server's own gzip or brotli sends a little less. */
const gzipSize = (buf) => gzipSync(buf, { level: 9, mtime: 0 }).length;

/** Every block, by name, with its bytes. */
function blockSizes(distDir) {
  return Object.entries(minManifest(distDir).blocks).map(([name, b]) => ({ name, bytes: b.bytes }));
}

/** A core of dist/min as a buffer: `variant` is one the composer picks ("composed", "composed-plain"), or none for the
 *  core a kit carries (the checks and the data decoder in it). */
function coreFile(variant, distDir) {
  const m = minManifest(distDir);
  const v = variant ? (m.core.variants || {})[variant] : null;
  if (variant && !v) throw new Error(`dist/min has no core variant "${variant}"`);
  return fs.readFileSync(path.join(minDir(distDir), v ? v.file : m.core.file));
}

/** The core most composed reports carry: the composer has run the checks, and no dataset is stored gzipped. */
const reportCore = (distDir) => coreFile('composed-plain', distDir);

/**
 * Everything: the most a composed page can carry, the core with the data decoder and every block there is. Wherever a
 * page or a doc compares a report with "everything", "the whole library" or "all N blocks", this is the number.
 */
function libraryCode(distDir) {
  const core = coreFile('composed', distDir).length;
  const blocks = blockSizes(distDir);
  return {
    core,
    blocks: blocks.reduce((n, b) => n + b.bytes, 0),
    count: blocks.length,
    bytes: core + blocks.reduce((n, b) => n + b.bytes, 0),
  };
}

module.exports = { gzipSize, blockSizes, coreFile, reportCore, libraryCode };
