import path from 'node:path';
import { fileURLToPath } from 'node:url';

// test/apps is the root: its node_modules, and ../shared, the page every app draws
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// a static export: every page rendered on the server at build time, then hydrated in the browser
export default { output: 'export', turbopack: { root }, outputFileTracingRoot: root };
