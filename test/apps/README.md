# blockcharts in real apps

Six small apps, each made the way its framework's own tools make one, that use blockcharts as an app installs it:
the tarball `npm pack` makes, unpacked into `node_modules/blockcharts`. `scripts/test-apps.js` builds and runs them.

| app | toolchain | how it draws a chart |
|---|---|---|
| `react/` | Vite, `@vitejs/plugin-react`, React 19 (StrictMode) | `<BlockChart>` from `blockcharts/react` |
| `vue/` | Vite, `@vitejs/plugin-vue`, single-file components | `<BlockChart :spec :data @click>` from `blockcharts/vue` |
| `svelte/` | SvelteKit 3, `adapter-static`, every page prerendered | `use:blockchart` from `blockcharts/svelte` |
| `next/` | Next.js 16, App Router, a static export (rendered on the server, hydrated) | `<BlockChart>` in a client component |
| `angular/` | Angular CLI 22, zoneless, strict templates | `<block-chart [spec] [data] (bc-click)>` from `blockcharts/element` |
| `vanilla/` | Vite, no framework | `BC.data`, `BC.chart`, a `bc-click` listener |

Each has two pages, the same in all six (`shared/`):

- **the smoke page** (`/`): chart a with its own rows, charts b and c drawing one dataset the app gave to `BC.data`.
  The test clicks a bar of each (the click must reach that chart's handler), gives a new rows and a new title (b and c
  must not be built again), takes b away (c must stay as it was), then hides all three (no drawing and no dataset a
  component made may be left; the app's own dataset stays). Nothing may be said in the console, hydration warnings
  included. It runs on the production build and on the dev server, and for SvelteKit and Next.js the server's HTML
  must have the three charts' elements, empty.
- **every chart** (`/all` or `/?all`): every chart of every recipe of the skill (71, from the fixture the test serves
  at `/fixtures/all.json`), each given its dataset as its own data, `?copies=N` times. The test mounts them, gives
  them all new data and unmounts them, three times, and measures each phase (wall time and the main thread's CPU
  time), the heap and the DOM nodes of the charts, and what is left after (heap, nodes, event listeners, datasets).

## Run

```sh
npm ci --prefix test/apps        # once: the toolchains, from this folder's lockfile
npm run test:apps                # from the root: pack, build, check, measure (a few minutes)
node scripts/test-apps.js react vue --no-dev --no-perf   # some apps, fewer checks
node scripts/test-apps.js --no-pack --copies=5 --cycles=8 # the package as last installed; more charts, more cycles
```

The measures are printed as a table and written to `out/measures.json`. The apps are not part of the root's
workspaces: their toolchains are large and theirs alone. CI runs them in their own workflow (`.github/workflows/apps.yml`).
