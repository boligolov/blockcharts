# blockcharts

Interactive HTML dashboards and chart reports, as one file. Give Claude a table — pasted into the chat
or as a CSV file — and ask for a report: sales by region, a monthly KPI page, revenue against costs, the
spread of delivery times. You get a single `.html` file with interactive charts that opens in any browser,
works offline, and can be emailed, attached to a ticket or dropped into a shared folder.

Claude does not write chart code. It describes each chart as JSON (the data, the scales, the marks, the
axes, the interactions), and a composer bundled with the skill checks every chart against the real data
before anything is written: an unknown column, a wrong scale or a broken format is reported with its
place in the JSON, and Claude fixes it. The charts are drawn by small independent blocks — a scale, a
bar, an axis, a tooltip — and the page carries exactly the blocks its charts use, never a whole charting
library, so a report stays small and fast.

## Charts

Bars (grouped, stacked, horizontal), lines, areas (stacked and 100%), scatter, dual axis, pie and donut,
heatmap, histogram, boxplot and dot plot — with tooltips, zoom, selection, a clickable legend and number
and date formats (currency, percent, compact). Series of hundreds of thousands of points and scatter
plots of tens of thousands stay fast.

## What it runs

The skill runs one local program: `runtime/compose.js`, plain Node.js 18+ with no dependencies. It reads
the `page.json` Claude writes and the CSV files next to it, and writes the HTML file. Nothing is
installed, nothing is fetched, and the plugin sends no data anywhere; the page it makes loads nothing
from the network either.

## Learn more

- Website: https://blockcharts.online
- Source, the documentation and the JavaScript library for your own pages: https://github.com/boligolov/blockcharts
- License: MIT
