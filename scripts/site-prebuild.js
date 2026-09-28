// Everything the site needs from the library, made before Astro runs (node scripts/site-prebuild.js):
//   site/public/release/                 the real kits, loader and blocks, so every page loads them from its own origin
//   site/public/examples/<name>.report.html   what the composer makes from each recipe
//   site/src/data/reports.json           { name: bytes } of those reports, for the pages
//   site/public/blockcharts.skill        the agent skill as an uploadable zip, the download the site links to
// Needs `npm run build && npm run manifest` first (the site scripts in package.json do it).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildRelease } = require('./build-dist.js');
const { compose } = require('./compose.js');
const { checkSkill, packSkill } = require('./build-skill.js');

const repo = path.join(__dirname, '..');
const site = path.join(repo, 'site');

function prebuild() {
  const distDir = path.join(repo, 'dist');
  if (!fs.existsSync(path.join(distDir, 'manifest.json'))) throw new Error(`${distDir}/manifest.json not found: run npm run build and npm run manifest first`);
  const kits = JSON.parse(fs.readFileSync(path.join(repo, 'kits.json'), 'utf8'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-site-release-'));
  try {
    const release = buildRelease({ distDir, outDir: tmp, kits });
    const target = path.join(site, 'public', 'release');
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(tmp, target, { recursive: true });

    const recipesDir = path.join(repo, 'skills', 'blockcharts', 'recipes');
    const reportsDir = path.join(site, 'public', 'examples');
    fs.rmSync(reportsDir, { recursive: true, force: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    const sizes = {};
    for (const f of fs.readdirSync(recipesDir).filter((n) => n.endsWith('.json')).sort()) {
      const name = f.replace(/\.json$/, '');
      const r = compose({ ...JSON.parse(fs.readFileSync(path.join(recipesDir, f), 'utf8')), baseDir: recipesDir });
      if (r.diagnostics.length) throw new Error(`recipe ${name} has diagnostics: ${JSON.stringify(r.diagnostics)}`);
      fs.writeFileSync(path.join(reportsDir, `${name}.report.html`), r.html);
      sizes[name] = r.bytes;
    }
    fs.mkdirSync(path.join(site, 'src', 'data'), { recursive: true });
    fs.writeFileSync(path.join(site, 'src', 'data', 'reports.json'), JSON.stringify(sizes, null, 2) + '\n');
    // the download is the committed skill, and only while it is current
    const stale = checkSkill();
    if (stale.length) throw new Error(`skills/blockcharts is out of date, run npm run skill: ${stale.join(', ')}`);
    fs.writeFileSync(path.join(site, 'public', 'blockcharts.skill'), packSkill());
    return { release, reports: Object.keys(sizes).length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { prebuild };

if (require.main === module) {
  try {
    const r = prebuild();
    console.log(`site data: release ${r.release.version} and ${r.reports} reports`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
