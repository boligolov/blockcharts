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

100 runs of each library at each n, 2026-11-26; Chrome 158.0.8127.38; 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 threads), 32 GB, Windows_NT 10.0.26300.

#### 1 chart

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 12.3 | 11.7–12.9 | 12.25 | 0.8 | 12.8 | 0.2 | 12 | 24 |
| blockcharts | 0.0.5 | 15.0 | 14.5–15.7 | 15.00 | 1.0 | 16.4 | 0.4 | 57 | 43 |
| Observable Plot | 0.6.19 | 17.5 | 17.2–18.5 | 17.55 | 1.2 | 18.9 | 0.5 | 78 | 94 |
| Chart.js | 4.6.2 | 30.8 | 30.3–31.9 | 30.85 | 2.1 | 31.0 | 0.6 | 2 | 71 |
| ECharts | 6.1.0 | 31.4 | 30.7–32.6 | 31.35 | 2.1 | 32.4 | 0.9 | 5 | 176 |
| Plotly | 4.3.0 | 36.0 | 35.5–36.7 | 36.00 | 2.4 | 37.1 | 0.9 | 172 | 1,447 |
| ApexCharts | 8.9.1 | 37.1 | 36.4–38.1 | 37.15 | 2.5 | 38.6 | 1.0 | 144 | 289 |
| Recharts | 3.11.1 | 49.0 | 48.1–50.4 | 49.00 | 3.3 | 50.1 | 2.1 | 154 | 193 |

#### 20 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 23.6 | 23.2–24.5 | 1.18 | 0.7 | 24.7 | 0.9 | 240 | 24 |
| blockcharts | 0.0.5 | 33.8 | 33.0–35.3 | 1.69 | 1.0 | 35.9 | 1.1 | 871 | 43 |
| Observable Plot | 0.6.19 | 43.0 | 42.2–44.4 | 2.15 | 1.3 | 45.5 | 1.6 | 1,166 | 94 |
| Chart.js | 4.6.2 | 70.9 | 69.6–72.9 | 3.54 | 2.1 | 70.3 | 3.0 | 40 | 71 |
| ECharts | 6.1.0 | 88.2 | 85.2–91.5 | 4.41 | 2.6 | 89.1 | 4.2 | 81 | 176 |
| ApexCharts | 8.9.1 | 132 | 130–137 | 6.59 | 3.9 | 134 | 3.9 | 2,328 | 289 |
| Plotly | 4.3.0 | 150 | 147–153 | 7.50 | 4.4 | 152 | 3.8 | 3,012 | 1,447 |
| Recharts | 3.11.1 | 203 | 200–207 | 10.17 | 6.0 | 205 | 15.9 | 2,483 | 193 |

#### 355 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 162 | 159–166 | 0.46 | 0.5 | 162 | 6.8 | 4,260 | 24 |
| blockcharts | 0.0.5 | 321 | 317–328 | 0.91 | 1.0 | 330 | 7.6 | 15,456 | 43 |
| Observable Plot | 0.6.19 | 322 | 317–327 | 0.91 | 1.0 | 331 | 10.1 | 20,760 | 94 |
| Chart.js | 4.6.2 | 485 | 482–498 | 1.37 | 1.5 | 482 | 35.1 | 710 | 71 |
| ECharts | 6.1.0 | 679 | 675–693 | 1.91 | 2.1 | 679 | 40.0 | 1,421 | 176 |
| Plotly | 4.3.0 | 1,936 | 1,920–1,974 | 5.45 | 6.0 | 1,943 | 30.0 | 53,449 | 1,447 |
| Recharts | 3.11.1 | 2,146 | 2,124–2,186 | 6.04 | 6.7 | 2,158 | 236.3 | 44,050 | 193 |
| ApexCharts | 8.9.1 | 3,366 | 3,337–3,459 | 9.48 | 10.5 | 3,387 | 33.0 | 41,285 | 289 |

### The CPU slowed four times (roughly a phone)

100 runs of each library at each n, 2026-11-27; Chrome 158.0.8127.38, CPU slowed 4×; 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 threads), 32 GB, Windows_NT 10.0.26300.

#### 1 chart

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 61.1 | 58.5–65.4 | 61.10 | 0.8 | 65.3 | 0.2 | 12 | 24 |
| blockcharts | 0.0.5 | 81.1 | 76.9–87.3 | 81.15 | 1.0 | 88.9 | 0.4 | 57 | 43 |
| Observable Plot | 0.6.19 | 96.6 | 91.5–101 | 96.55 | 1.2 | 104 | 0.5 | 78 | 94 |
| Chart.js | 4.6.2 | 160 | 155–168 | 160.35 | 2.0 | 160 | 0.6 | 2 | 71 |
| ECharts | 6.1.0 | 172 | 165–181 | 171.75 | 2.1 | 177 | 0.9 | 5 | 176 |
| Plotly | 4.3.0 | 200 | 195–211 | 199.65 | 2.5 | 206 | 0.9 | 172 | 1,447 |
| ApexCharts | 8.9.1 | 203 | 195–214 | 203.20 | 2.5 | 210 | 1.0 | 144 | 289 |
| Recharts | 3.11.1 | 268 | 261–277 | 268.35 | 3.3 | 273 | 2.1 | 154 | 193 |

#### 20 charts

| library | version | drawn and painted, ms (median) | quartiles | per chart, ms | × blockcharts | main thread, ms | heap, MB | DOM nodes | JS, KB gzip |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| uPlot | 1.6.32 | 125 | 121–132 | 6.24 | 0.7 | 130 | 0.9 | 240 | 24 |
| blockcharts | 0.0.5 | 181 | 175–192 | 9.07 | 1.0 | 192 | 1.1 | 871 | 43 |
| Observable Plot | 0.6.19 | 234 | 228–249 | 11.72 | 1.3 | 243 | 1.6 | 1,166 | 94 |
| Chart.js | 4.6.2 | 359 | 351–371 | 17.94 | 2.0 | 356 | 3.0 | 40 | 71 |
| ECharts | 6.1.0 | 457 | 442–475 | 22.84 | 2.5 | 461 | 4.2 | 81 | 176 |
| ApexCharts | 8.9.1 | 714 | 700–738 | 35.70 | 3.9 | 724 | 3.9 | 2,328 | 289 |
| Plotly | 4.3.0 | 829 | 810–859 | 41.44 | 4.6 | 836 | 3.8 | 3,012 | 1,447 |
| Recharts | 3.11.1 | 1,054 | 1,041–1,086 | 52.69 | 5.8 | 1,063 | 15.8 | 2,483 | 193 |

### What they say

- **Per chart**: about 0.9 ms for a chart among hundreds (0.91 ms at 355), 1.7 ms for one of 20, 15 ms for the only
  chart of a page. The first chart pays for what a page does once: the browser compiles the library's script and loads
  the system font for the first text (5–6 ms in a trace, for every library: Plot pays it in its layout, blockcharts
  when it measures text). Until 0.0.5 blockcharts also made a date formatter there that these charts never use, the
  first `Intl` formatter of the page: about 10 ms (docs/Design.md, "A performance pass").
- **Against the others**, at 20 and 355 charts: faster than Chart.js (1.5–2.1×), ECharts (2.1–2.6×), ApexCharts
  (3.9–10.5×), Plotly (4.4–6×) and Recharts (6–6.7×); on a par with Observable Plot at 355 charts and 1.3× faster at
  20; uPlot is 1.4–2× as fast. For a page's only chart only uPlot is faster (12.3 ms against 15), the others are
  1.2–3.3× slower. The order holds with the CPU slowed four times, where every time grows about five times (5–5.6×).
- **Memory and size**: the least heap after uPlot (7.6 MB for 355 charts; Chart.js 35, ECharts 40, Recharts 236) and
  the smallest bundle after uPlot (43 KB gzip).

### What they do not say

- Only the first drawing: not new data, not interaction (hover, zoom), not long series (tens of thousands of points),
  where uPlot and the canvas libraries are made to be fast.
- Simple charts. The recipes of the skill (facets, heatmaps, treemaps, cards) take 2–2.7 ms a chart in
  `npm run test:apps`, on the same machine.
- One machine: other machines give other milliseconds; the ratios between the libraries move less.
- Each library is configured to show the same things (axes, a tooltip, no animation), not to look the same.
