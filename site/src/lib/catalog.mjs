// The words of the site about the library: what each role and block is for, which core a page carries, and how the
// gallery groups the skill's recipes into kinds of chart. The numbers next to these words come from the build
// (site.mjs); every list here is checked against what exists, so the site cannot name a block or a recipe that is gone.

/** What each role of block is for (the blocks page). */
export const ROLE_TEXT = {
  lib: 'Code that two blocks share. A spec never names one; a block that needs it lists it in <code>requires</code>, and the composer brings it along.',
  scale: 'Map data to positions or colors. Declared once per chart under <code>scales</code>, by name.',
  transform: 'Prepare the dataset before anything is drawn (<code>transforms</code>).',
  mark: 'Draw one thing per row (<code>marks</code>). They read fields through channels.',
  guide: 'Axes, grids and legends, attached to scales (<code>guides</code>).',
  interaction: 'What the reader can do with the chart (<code>interaction</code>).',
  renderer: 'Turns the drawing instructions into output: SVG by default, canvas for tens of thousands of points.',
};

/** What each block does, in a line: the blocks page, the gallery and every example name blocks with it. */
export const BLOCK_SUMMARY = {
  'lib.curve': 'The path of a line: straight segments, a smooth curve that never overshoots, or steps. Shared by line and area.',
  'lib.ticks': 'Round steps and ticks (1, 2 or 5 × 10ⁿ). Shared by the number scales and the histogram bins.',
  'lib.pointer':
    'Where the pointer is on the chart, and following a mouse or a finger once a frame. Shared by tooltip, crosshair, zoom and brush.',
  'lib.view': 'The arithmetic of zooming a scale, even on a log one. Shared by zoom and the zoom buttons.',
  'lib.columns': 'Checks the columns a transform reads and writes. Shared by funnel, hexbin, treemap and waterfall.',
  'scale.linear': 'Numbers to positions, with round ticks.',
  'scale.log': 'Numbers across orders of magnitude; steady growth is a straight line.',
  'scale.time': 'Dates to positions, ticks in days, months or years (UTC).',
  'scale.band': 'One band per category: the axis of bar charts.',
  'scale.color': 'A color per category, from the theme palette.',
  'scale.sequential': 'Numbers to a color ramp: heatmaps, hexbins.',
  'scale.size': 'Numbers to circle sizes, by area: bubble charts.',
  'transform.aggregate': 'Group-by: sum, mean, count and more per group; dates by month or quarter; top N groups.',
  'transform.window': 'Moving averages, running totals, change from the previous row; totals, shares and ranks in a group.',
  'transform.stack': 'Stacks series on top of each other, to 100%, or around a center line (a streamgraph).',
  'transform.bin': 'Counts values in equal bins: histograms.',
  'transform.quartiles': 'The five-number summary of each group: box plots.',
  'transform.decimate': 'Thins long series without losing a peak; redone at every zoom.',
  'transform.waterfall': 'Increases, decreases and subtotals of a bridge chart.',
  'transform.funnel': 'Stage widths and conversion rates of a funnel.',
  'transform.treemap': 'Lays out the rectangles of a treemap.',
  'transform.fold': 'A wide table (a column per series) becomes a long one.',
  'transform.filter': 'Keeps the rows that pass a test: numbers, dates, text, lists.',
  'transform.sort': 'Orders rows and keeps the top N, also per group.',
  'transform.calculate': 'A new column from two numbers: a margin, a gap to plan.',
  'transform.highlight': 'Marks one row to set apart: the best month, the largest region.',
  'mark.rect': 'Rectangles: bars, grouped bars, ranges, heatmap cells; the hexagons of a hexbin.',
  'mark.line': 'A line per series, with optional end labels.',
  'mark.area': 'Filled areas, stacked or not.',
  'mark.point': 'Dots, bubbles and beeswarms.',
  'mark.text': 'Value labels that shrink, or step aside, when they do not fit.',
  'mark.arc': 'Pie and donut slices; gauges and progress rings.',
  'mark.sankey': 'Flows between stages, as ribbons.',
  'mark.rule': 'Target and threshold lines; the target tick of a bullet chart.',
  'mark.boxplot': 'Box and whiskers.',
  'mark.candlestick': 'Open, high, low and close.',
  'mark.violin': 'Violins and ridgelines: the shape of a distribution per category.',
  'transform.density': 'How raw values are spread, as a smooth curve per group.',
  'transform.calendar': 'Weeks and weekdays for a calendar heatmap.',
  'transform.marimekko': 'Columns as wide as their share, cells as tall as theirs.',
  'transform.hexbin': 'Counts points in hexagons: where a scatter too dense to read piles up.',
  'guide.axis': 'Axes: formatted labels, a title, long categories wrapped.',
  'guide.grid': 'Grid lines at the ticks.',
  'guide.legend': 'Legends: categories, a color bar, bubble sizes.',
  'guide.kpi': 'A KPI tile: the figure, its change, a sparkline.',
  'interaction.tooltip': 'The values under the pointer.',
  'interaction.zoom': 'Wheel zoom, drag to pan, double-click to reset.',
  'interaction.zoom-controls': 'Buttons: 100%, minus, plus.',
  'interaction.brush': 'Drag a range to zoom to it.',
  'interaction.crosshair': 'A line that follows the pointer across all series.',
  'interaction.legend-filter': 'Click a legend item to hide or show its series.',
  'interaction.animate': 'Draws the chart in once, when it first appears.',
  'renderer.svg': 'Draws into SVG: sharp, selectable, prints well. The default.',
  'renderer.canvas': 'Draws into a canvas, for tens of thousands of points.',
};

/** When a page carries which core. */
export const CORE_USE = {
  core: 'Kits and hand-written pages: checks every spec, decodes compressed data.',
  'core.composed': 'A report with compressed data: the composer has run the checks already.',
  'core.composed-plain': 'A report with plain data: no checks, no decoder. Most reports.',
};

/**
 * The gallery: every recipe of the skill under one kind of chart, in the order a reader looks for them. A recipe in
 * no kind, in two, or a name that is no recipe stops the build (galleryOf).
 */
export const GALLERY = [
  {
    id: 'compare',
    title: 'Comparing categories',
    intro:
      'Which region sells most, which product leads. Bars are read fastest; a dot plot says the same with less ink, a pyramid sets two groups back to back, and a computed column (a margin) is drawn like any other.',
    recipes: ['bar', 'grouped-bar', 'top-n', 'dotplot', 'highlight-bar', 'pyramid', 'calculated-field'],
  },
  {
    id: 'composition',
    title: 'Parts of a whole',
    intro:
      'How a whole splits into its parts, at one moment or over time. Stacked bars and a donut for a few parts; a treemap or a Marimekko for many, or for two levels at once.',
    recipes: ['stacked-bar', 'pie', 'treemap', 'marimekko', 'stacked-area-100', 'streamgraph'],
  },
  {
    id: 'trends',
    title: 'Trends over time',
    intro:
      'How numbers move over days, months and years: several series with zoom, a moving average over noise, two units on two axes, the prices of a period, a range around a forecast, and a series of a hundred thousand points.',
    recipes: [
      'lines-by-series',
      'wide-table',
      'moving-average',
      'step-line',
      'log-scale',
      'dual-axis',
      'bars-and-line',
      'error-bars',
      'candlestick',
      'long-series',
    ],
  },
  {
    id: 'change',
    title: 'Change and ranking',
    intro:
      'What changed between two points, who overtook whom over the years, and how a start value became an end value through gains and losses.',
    recipes: ['slope', 'dumbbell', 'bump-chart', 'waterfall'],
  },
  {
    id: 'distribution',
    title: 'Distributions',
    intro:
      'How values are spread: where most of them are, how long the tails run, and whether there are two humps that a mean or a box would hide.',
    recipes: ['histogram', 'boxplot', 'violin', 'ridgeline', 'beeswarm'],
  },
  {
    id: 'relationship',
    title: 'Relationships and patterns',
    intro:
      'How two measures go together, a third as the size of a bubble, and where the numbers gather in a grid of two categories or in a calendar. Tens of thousands of points go to a canvas, or into hexagons that count them.',
    recipes: ['scatter-groups', 'bubble', 'scatter-large', 'hexbin', 'heatmap', 'calendar-heatmap'],
  },
  {
    id: 'targets',
    title: 'Targets and progress',
    intro: 'One figure against its target or its maximum, with the ranges that say at a glance whether it is good.',
    recipes: ['bullet', 'gauge'],
  },
  {
    id: 'flows',
    title: 'Stages, flows and plans',
    intro:
      'The stages a customer passes, the volume that flows between products, channels and customers, and the tasks of a project on a timeline.',
    recipes: ['funnel', 'sankey', 'gantt'],
  },
  {
    id: 'pages',
    title: 'Dashboards and reports',
    intro:
      'Several charts on one page: KPI tiles with sparklines in a grid, the same chart for every region on one scale, a report made straight from CSV rows. The page still carries each block once.',
    recipes: ['executive-dashboard', 'dashboard', 'small-multiples', 'report-from-csv'],
  },
];

/** The chart a gallery card shows when it is not a recipe's first one (a KPI tile says less than the trend under it). */
export const COVERS = { 'executive-dashboard': 4, 'highlight-bar': 1 };

/** The index of the chart a card shows, checked against the recipe. */
export function coverOf(recipe) {
  const i = COVERS[recipe.name] ?? 0;
  if (!(i >= 0 && i < recipe.charts.length)) throw new Error(`gallery: ${recipe.name} has no chart ${i} to show`);
  return i;
}

/** The kinds of the gallery with their recipes (objects of loadRecipes), checked: every recipe in exactly one kind. */
export function galleryOf(recipes) {
  const byName = new Map(recipes.map((r) => [r.name, r]));
  const seen = new Map();
  const problems = [];
  for (const kind of GALLERY)
    for (const name of kind.recipes) {
      if (!byName.has(name)) problems.push(`"${name}" in ${kind.id} is no recipe`);
      if (seen.has(name)) problems.push(`"${name}" is in both ${seen.get(name)} and ${kind.id}`);
      seen.set(name, kind.id);
    }
  for (const r of recipes) if (!seen.has(r.name)) problems.push(`the recipe "${r.name}" is in no kind of the gallery`);
  if (problems.length) throw new Error(`gallery (site/src/lib/catalog.mjs): ${problems.join('; ')}`);
  return GALLERY.map((kind) => ({ ...kind, items: kind.recipes.map((n) => byName.get(n)) }));
}

/** The kind a recipe is shown under, with its neighbours there (for the links between examples). */
export function placeOf(recipes, name) {
  for (const kind of galleryOf(recipes)) {
    const i = kind.items.findIndex((r) => r.name === name);
    if (i >= 0) return { kind, prev: kind.items[i - 1], next: kind.items[i + 1] };
  }
  throw new Error(`gallery: no kind shows ${name}`);
}
