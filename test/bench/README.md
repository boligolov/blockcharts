# blockcharts and other chart libraries

The same charts drawn by blockcharts and seven other libraries, timed in Chrome by `scripts/bench.js`. It is not a
test: it fails only when a library does not draw all its charts or says something in the console.

## What is drawn

Every library draws the same thing (the rows and their size in `charts.cjs`, the clock in `common.js`): bars over 12 categories and a line of 200 points, alternating, each
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
Its spec of the two charts is in `charts.cjs` too, which the site reads to show them.

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
node scripts/bench.js --runs=100 --save              # and keep the figures in the repository
```

The table is printed and written to `out/results.md`, every run to `out/results.json` (with the machine, Chrome and
the versions), the pages to `out/pages`, a screenshot of each library's 20 charts to `out/shots` (to see that each
drew what the others did). Run it on a quiet machine, plugged in, with nothing else busy.

`--save` also writes `results.json` (`results-cpu4.json` with `--cpu=4`) in this folder: the machine, Chrome, the
versions, and for each library at each count the medians, the quartiles and every run's time. Those two files are the
figures the repository keeps, and what the site's [benchmarks page](https://blockcharts.online/benchmarks/) shows;
the site will not build when they stop supporting what the page says (blockcharts faster than Chart.js, ECharts,
ApexCharts, Plotly and Recharts, on a par with Observable Plot, slower than uPlot). `--resave` writes them again from
the last run in `out/`, without measuring.

## Results

### On a laptop

100 runs of each library at each n, 2026-11-25; Chrome 157.0.8103.80; 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 threads), 32 GB, Windows_NT 10.0.26300.

#### 1 chart

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 13.3 | 12.2–14.1 | 13.30 | 0.5 | 14.3 | 0.2 | 12 | 24 |
| Observable Plot | 0.6.19 | 19.3 | 17.9–20.0 | 19.30 | 0.7 | 20.9 | 0.5 | 78 | 94 |
| blockcharts | 0.0.4 | 26.1 | 24.4–27.6 | 26.10 | 1.0 | 27.8 | 0.4 | 57 | 43 |
| Chart.js | 4.6.2 | 33.3 | 30.8–35.0 | 33.30 | 1.3 | 33.7 | 0.6 | 2 | 71 |
| ECharts | 6.1.0 | 34.1 | 32.1–36.0 | 34.15 | 1.3 | 35.2 | 0.9 | 5 | 176 |
| Plotly | 4.3.0 | 35.5 | 34.9–36.5 | 35.55 | 1.4 | 36.8 | 0.9 | 172 | 1,447 |
| ApexCharts | 8.9.1 | 40.1 | 37.1–42.0 | 40.10 | 1.5 | 41.6 | 1.0 | 144 | 289 |
| Recharts | 3.11.1 | 51.4 | 49.0–54.5 | 51.40 | 2.0 | 53.3 | 2.1 | 154 | 193 |

#### 20 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 26.0 | 23.9–27.4 | 1.30 | 0.6 | 27.0 | 0.9 | 240 | 24 |
| Observable Plot | 0.6.19 | 45.5 | 43.3–47.8 | 2.28 | 1.0 | 48.1 | 1.6 | 1,166 | 94 |
| blockcharts | 0.0.4 | 46.5 | 43.1–49.1 | 2.32 | 1.0 | 48.8 | 1.2 | 871 | 43 |
| Chart.js | 4.6.2 | 75.6 | 71.1–79.8 | 3.78 | 1.6 | 74.9 | 3.0 | 40 | 71 |
| ECharts | 6.1.0 | 92.2 | 87.1–97.4 | 4.61 | 2.0 | 93.0 | 4.2 | 81 | 176 |
| ApexCharts | 8.9.1 | 136 | 126–142 | 6.80 | 2.9 | 138 | 3.9 | 2,328 | 289 |
| Plotly | 4.3.0 | 145 | 141–152 | 7.24 | 3.1 | 147 | 3.8 | 3,012 | 1,447 |
| Recharts | 3.11.1 | 211 | 201–220 | 10.57 | 4.6 | 213 | 15.9 | 2,483 | 193 |

#### 355 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 172 | 163–178 | 0.48 | 0.5 | 171 | 6.8 | 4,260 | 24 |
| Observable Plot | 0.6.19 | 323 | 310–335 | 0.91 | 1.0 | 333 | 10.1 | 20,760 | 94 |
| blockcharts | 0.0.4 | 329 | 314–340 | 0.93 | 1.0 | 338 | 7.6 | 15,456 | 43 |
| Chart.js | 4.6.2 | 502 | 486–517 | 1.41 | 1.5 | 498 | 35.1 | 710 | 71 |
| ECharts | 6.1.0 | 691 | 674–722 | 1.95 | 2.1 | 688 | 40.0 | 1,421 | 176 |
| Plotly | 4.3.0 | 1,884 | 1,859–2,018 | 5.31 | 5.7 | 1,894 | 29.9 | 53,449 | 1,447 |
| Recharts | 3.11.1 | 2,121 | 2,089–2,171 | 5.98 | 6.5 | 2,135 | 236.2 | 44,050 | 193 |
| ApexCharts | 8.9.1 | 3,259 | 3,200–3,398 | 9.18 | 9.9 | 3,282 | 33.0 | 41,285 | 289 |

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

- **Per chart**: about 1 ms for a chart among hundreds (0.93 ms at 355), about 2.3 ms for one of 20, 26 ms for the only
  chart of a page. The first chart pays for what a page does once: the browser loads the system font for the first
  text (5–6 ms in a trace, for every library: Plot pays it in its layout, blockcharts when it measures text), and
  blockcharts makes its first `Intl.NumberFormat` and compiles its script. The second chart of a page is drawn and
  painted in about 6 ms in a trace (Plot: about 4).
- **Against the others**, at 20 and 355 charts: on a par with Observable Plot; faster than Chart.js (1.5–1.6×),
  ECharts (2–2.1×), ApexCharts (2.9–9.9×), Plotly (3.1–5.7×) and Recharts (4.6–6.5×); uPlot is about twice as fast.
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
