# blockcharts and other chart libraries

The same charts drawn by blockcharts and seven other libraries, timed in Chrome by `scripts/bench.js`. It is not a
test: it fails only when a library does not draw all its charts or says something in the console.

## What is drawn

Every library draws the same thing (`common.js`): bars over 12 categories and a line of 200 points, alternating, each
360 × 200 px, with two axes and a tooltip, no animation and no legend. One chart, 20 (a dashboard), and 355 (as many
as every recipe of the skill five times over, what `npm run test:apps` draws).

| page | library | draws in | configured |
|---|---|---|---|
| `blockcharts.js` | blockcharts, the basic kit of the release (`blockcharts/kits/basic.mjs`) | SVG | each chart's rows given to the lake under a name of their own |
| `chartjs.js` | Chart.js (`chart.js/auto`) | canvas | not responsive |
| `echarts.js` | ECharts, only the modules these charts use | canvas | tooltip on the axis |
| `uplot.js` | uPlot, with its stylesheet | canvas | uPlot has no tooltip; its cursor stays on |
| `plot.js` | Observable Plot | SVG | `tip: true`; it orders the bars by name |
| `recharts.js` | Recharts with React 19 | SVG | all the charts in one React root, as an app renders them |
| `apexcharts.js` | ApexCharts | SVG | toolbar and zoom off |
| `plotly.js` | Plotly (`plotly.js-dist-min`) | SVG | mode bar off |

The versions are pinned in `package.json`; blockcharts is the release `scripts/bench.js` builds from the repository.

## How it is measured

- Each page is bundled by esbuild as an app's production build is (minified, `NODE_ENV=production`). **JS, KB gzip**
  is that bundle gzipped, the library's CSS included.
- **One run**: a fresh page (a browser context of its own), the library loaded, a garbage collection, the cells laid
  out. Then the clock starts, every chart is drawn (awaiting the promise a library returns: ApexCharts, Plotly), and
  the clock stops when a task posted from the next `requestAnimationFrame` runs, that is once the frame showing the
  charts has been rendered. A library that draws in a `requestAnimationFrame` of its own has drawn by then.
- **Drawn and painted** is that time; **main thread** is the time the page's main thread was busy meanwhile (CDP
  `TaskDuration`), so without waiting for a frame; **heap** and **DOM nodes** are what the charts hold, after a garbage
  collection.
- **Rounds**: each round runs every library at every count once, in an order shuffled for that round (seeded), so
  that whatever else the machine does falls on all of them alike. The table shows the median over the rounds and the
  quartiles (half of the runs fall between them).
- Every run must draw its n charts (a cell holding an `<svg>` or a `<canvas>`) with nothing in the console.
- `--cpu=4` slows the CPU down four times, as DevTools does: roughly a mid-range phone.

## Run

```sh
npm ci --prefix test/bench                           # once: the libraries, from this folder's lockfile
npm run bench                                        # from the root: builds, then 30 rounds of 1, 20 and 355 charts
node scripts/bench.js --runs=100                     # once built (npm run build && npm run manifest)
node scripts/bench.js --runs=100 --cpu=4 --n=1,20    # the CPU slowed four times
node scripts/bench.js blockcharts chartjs --n=20     # some libraries, one count
```

The table is printed and written to `out/results.md`, every run to `out/results.json` (with the machine, Chrome and
the versions), the pages to `out/pages`, a screenshot of each library's 20 charts to `out/shots` (to see that each
drew what the others did). Run it on a quiet machine, plugged in, with nothing else busy.

## Results

### On a laptop

100 runs of each library at each n, 2026-11-25; Chrome 157.0.8103.80; 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 threads), 32 GB, Windows_NT 10.0.26300.

#### 1 chart

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 13.4 | 12.2–13.9 | 13.35 | 0.5 | 14.3 | 0.2 | 12 | 24 |
| Observable Plot | 0.6.19 | 19.4 | 17.8–20.4 | 19.35 | 0.7 | 21.0 | 0.5 | 78 | 94 |
| blockcharts | 0.0.4 | 26.4 | 25.2–27.8 | 26.40 | 1.0 | 28.1 | 0.4 | 57 | 43 |
| Chart.js | 4.6.2 | 33.7 | 31.6–35.6 | 33.75 | 1.3 | 33.9 | 0.6 | 2 | 71 |
| ECharts | 6.1.0 | 34.8 | 32.8–37.0 | 34.75 | 1.3 | 35.8 | 0.9 | 5 | 176 |
| Plotly | 4.3.0 | 36.8 | 35.7–39.0 | 36.80 | 1.4 | 38.0 | 0.9 | 172 | 1,447 |
| ApexCharts | 8.9.1 | 40.6 | 37.8–42.7 | 40.65 | 1.5 | 42.1 | 1.0 | 144 | 289 |
| Recharts | 3.11.1 | 52.3 | 49.7–55.3 | 52.25 | 2.0 | 54.2 | 2.1 | 154 | 193 |

#### 20 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 26.6 | 24.4–27.6 | 1.33 | 0.6 | 27.6 | 0.9 | 240 | 24 |
| Observable Plot | 0.6.19 | 46.2 | 44.5–48.9 | 2.31 | 1.0 | 48.4 | 1.6 | 1,166 | 94 |
| blockcharts | 0.0.4 | 47.6 | 44.8–50.0 | 2.38 | 1.0 | 50.0 | 1.2 | 871 | 43 |
| Chart.js | 4.6.2 | 77.6 | 73.4–81.2 | 3.88 | 1.6 | 77.1 | 3.0 | 40 | 71 |
| ECharts | 6.1.0 | 94.5 | 90.0–99.7 | 4.73 | 2.0 | 95.5 | 4.2 | 81 | 176 |
| ApexCharts | 8.9.1 | 138 | 130–144 | 6.90 | 2.9 | 140 | 3.9 | 2,328 | 289 |
| Plotly | 4.3.0 | 150 | 146–154 | 7.48 | 3.1 | 151 | 3.8 | 3,012 | 1,447 |
| Recharts | 3.11.1 | 213 | 203–222 | 10.63 | 4.5 | 214 | 15.9 | 2,483 | 193 |

#### 355 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 173 | 165–181 | 0.49 | 0.5 | 171 | 6.8 | 4,260 | 24 |
| Observable Plot | 0.6.19 | 329 | 319–338 | 0.93 | 1.0 | 339 | 10.1 | 20,760 | 94 |
| blockcharts | 0.0.4 | 336 | 325–346 | 0.95 | 1.0 | 347 | 7.6 | 15,456 | 43 |
| Chart.js | 4.6.2 | 509 | 497–523 | 1.43 | 1.5 | 504 | 35.1 | 710 | 71 |
| ECharts | 6.1.0 | 707 | 694–730 | 1.99 | 2.1 | 705 | 40.0 | 1,421 | 176 |
| Plotly | 4.3.0 | 1,961 | 1,918–2,023 | 5.52 | 5.8 | 1,970 | 29.9 | 53,449 | 1,447 |
| Recharts | 3.11.1 | 2,193 | 2,164–2,257 | 6.18 | 6.5 | 2,207 | 236.2 | 44,050 | 193 |
| ApexCharts | 8.9.1 | 3,361 | 3,300–3,463 | 9.47 | 10.0 | 3,383 | 33.0 | 41,285 | 289 |

### The CPU slowed four times (roughly a phone)

100 runs of each library at each n, 2026-11-25; Chrome 157.0.8103.80, CPU slowed 4×; 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 threads), 32 GB, Windows_NT 10.0.26300.

#### 1 chart

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 63.9 | 60.3–68.3 | 63.85 | 0.5 | 68.5 | 0.2 | 12 | 24 |
| Observable Plot | 0.6.19 | 98.5 | 94.4–107 | 98.50 | 0.8 | 106 | 0.5 | 78 | 94 |
| blockcharts | 0.0.4 | 130 | 124–140 | 129.70 | 1.0 | 138 | 0.4 | 57 | 43 |
| Chart.js | 4.6.2 | 165 | 158–172 | 164.80 | 1.3 | 165 | 0.6 | 2 | 71 |
| ECharts | 6.1.0 | 176 | 169–183 | 175.60 | 1.4 | 180 | 0.9 | 5 | 176 |
| Plotly | 4.3.0 | 186 | 180–194 | 185.65 | 1.4 | 191 | 0.9 | 172 | 1,447 |
| ApexCharts | 8.9.1 | 206 | 196–214 | 206.45 | 1.6 | 213 | 1.0 | 144 | 289 |
| Recharts | 3.11.1 | 264 | 256–277 | 264.00 | 2.0 | 270 | 2.1 | 154 | 193 |

#### 20 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 130 | 126–135 | 6.49 | 0.6 | 135 | 0.9 | 240 | 24 |
| blockcharts | 0.0.4 | 227 | 217–237 | 11.33 | 1.0 | 238 | 1.2 | 871 | 43 |
| Observable Plot | 0.6.19 | 231 | 224–242 | 11.53 | 1.0 | 240 | 1.6 | 1,166 | 94 |
| Chart.js | 4.6.2 | 354 | 342–372 | 17.71 | 1.6 | 352 | 3.0 | 40 | 71 |
| ECharts | 6.1.0 | 446 | 431–466 | 22.32 | 2.0 | 450 | 4.2 | 81 | 176 |
| ApexCharts | 8.9.1 | 649 | 633–665 | 32.46 | 2.9 | 660 | 3.9 | 2,328 | 289 |
| Plotly | 4.3.0 | 746 | 734–761 | 37.31 | 3.3 | 754 | 3.8 | 3,012 | 1,447 |
| Recharts | 3.11.1 | 1,003 | 984–1,029 | 50.14 | 4.4 | 1,012 | 15.8 | 2,483 | 193 |

### What they say

- **Per chart**: about 1 ms for a chart among hundreds (0.95 ms at 355), about 2.4 ms for one of 20, 26 ms for the only
  chart of a page. The first chart pays for what a page does once: the browser loads the system font for the first
  text (5–6 ms in a trace, for every library: Plot pays it in its layout, blockcharts when it measures text), and
  blockcharts makes its first `Intl.NumberFormat` and compiles its script. The second chart of a page is drawn and
  painted in about 6 ms in a trace (Plot: about 4).
- **Against the others**, at 20 and 355 charts: on a par with Observable Plot; faster than Chart.js (1.5–1.6×),
  ECharts (2–2.1×), ApexCharts (2.9–10×), Plotly (3.1–5.8×) and Recharts (4.5–6.5×); uPlot is about twice as fast.
  For a page's only chart, Plot and uPlot are faster, the others 1.3–2× slower. The ratios hold with the CPU slowed
  four times, where every time grows four to five times.
- **Memory and size**: the least heap after uPlot (7.6 MB for 355 charts; Chart.js 35, ECharts 40, Recharts 236) and
  the smallest bundle after uPlot (43 KB gzip).

### What they do not say

- Only the first drawing: not new data, not interaction (hover, zoom), not long series (tens of thousands of points),
  where uPlot and the canvas libraries are made to be fast.
- Simple charts. The recipes of the skill (facets, heatmaps, treemaps, cards) take 2–2.7 ms a chart in
  `npm run test:apps`, on the same machine.
- One machine: other machines give other milliseconds; the ratios between the libraries move less.
- Each library is configured to show the same things (axes, a tooltip, no animation), not to look the same.
