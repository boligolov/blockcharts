// JSON Schemas (draft-07) of what a person or a program writes, made from the manifest, so they cannot drift from the blocks:
//   chart.schema.json  one chart spec: what BC.chart, a <script data-bc-chart>, a framework wrapper and a page.json entry take
//   page.schema.json   the composer's page.json: title, layout, data and charts, each chart checked as above
// An editor gives completion and the docs of every key from them; a program can check a spec before it draws it. They check
// the shape only. What depends on the data (a field that is not in the dataset, a scale of the wrong kind for a channel) is
// for BC.validate and the composer, which also read the data.
//
// Every block of the manifest gets a definition of its own: its `type`, its params (by ParamDef.kind) and, for a mark, its
// channels; an unknown key is an error, as an editor should show it (the core only warns). A kind this file does not know
// stops the build, so a new kind of param cannot slip through unchecked.
const DRAFT = 'http://json-schema.org/draft-07/schema#';

/** Where a version's schemas are served: the CDN path of the npm package (the README's way to pin a version). */
const baseUrl = (version) => `https://cdn.jsdelivr.net/npm/blockcharts@${version}/release/schema/`;

/** The presets BC.formatter knows (src/core.ts, PRESETS); test-schema checks the core takes exactly these. */
const FORMAT_PRESETS = ['percent', 'compact', 'integer', 'year', 'quarter', 'month', 'day', 'date', 'datetime'];

const SIDES = ['top', 'right', 'bottom', 'left'];
const FORMAT_DOC = `A preset (${FORMAT_PRESETS.join(', ')}) or Intl.NumberFormat / Intl.DateTimeFormat options.`;
const ROLE_ORDER = ['transform', 'scale', 'mark', 'guide', 'interaction'];
const ROLE_DOC = {
  transform: 'A transform: applied in order to the dataset before the scales are built ("aggregate", "stack", "bin", ...).',
  scale: 'A scale: how values become positions, colors or sizes. Marks and guides name it.',
  mark: 'A mark: what is drawn for the rows ("rect" for bars, "line", "point", "arc", ...). Channels name fields.',
  guide: 'A guide: an axis, a grid, a legend or a KPI tile, bound to a scale by name.',
  interaction: 'An interaction: a tooltip, zoom, a brush, a legend filter, clicks, ...',
};

class SchemaError extends Error {}

const LANG = '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$';

/** The schema of one param, by its kind (BC.ParamDef). */
function paramSchema(where, p) {
  let s;
  switch (p.kind) {
    case 'string':
    case 'field':
    case 'scale':
      s = { type: 'string' };
      break;
    case 'number':
      s = { type: 'number' };
      break;
    case 'boolean':
      s = { type: 'boolean' };
      break;
    case 'enum':
      if (!Array.isArray(p.values) || !p.values.length) throw new SchemaError(`${where}: an enum param needs its values`);
      s = { type: 'string', enum: p.values.slice() };
      break;
    case 'list':
      s = { type: 'array' };
      break;
    case 'fields':
      s = { type: 'array', items: { type: 'string' } };
      break;
    case 'color':
      // a color that loads nothing: never url(…), which an SVG fill or a style fetches (the core checks the rest)
      s = { type: 'string', not: { type: 'string', pattern: '[uU][rR][lL]\\s*\\(' } };
      break;
    case 'format':
      s = { $ref: '#/definitions/format' };
      break;
    case 'formats':
      s = { type: 'object', additionalProperties: { $ref: '#/definitions/format' } };
      break;
    case 'any':
      s = {};
      break;
    default:
      throw new SchemaError(`${where}: param kind "${p.kind}" has no schema; add it to scripts/build-schema.js`);
  }
  const doc = [
    p.doc,
    p.kind === 'field' ? 'A field of the dataset.' : '',
    p.kind === 'scale' ? 'The name of a declared scale.' : '',
    p.kind === 'format' && !p.doc ? FORMAT_DOC : '',
  ]
    .filter(Boolean)
    .join(' ');
  // draft-07 ignores whatever stands beside a $ref, so a described reference wraps it
  if (s.$ref) s = { allOf: [s] };
  if (doc) s.description = doc;
  if (p.default !== undefined) s.default = p.default;
  return s;
}

/** A channel of a mark: a field on the scale named like the channel, { field, scale }, or a constant { value }. Its
 *  description is the only one on the way down: an editor shows the innermost description it finds, so the shared
 *  definitions below carry none (only a $comment) and the reader sees what this channel is. */
function channelSchema(c) {
  const s = { allOf: [{ $ref: c.unscaled ? '#/definitions/unscaledChannel' : '#/definitions/channel' }] };
  s.description = [
    c.doc,
    c.unscaled
      ? 'A field name, { "field" } or a constant { "value" }; read as it is, without a scale.'
      : 'A field name (on the scale named like the channel), { "field", "scale" } or a constant { "value" }.',
  ]
    .filter(Boolean)
    .join(' ');
  return s;
}

/** Keys every block of a role takes besides its params, as the core reads them. */
function commonKeys(role, entry) {
  if (role === 'scale')
    return {
      field: {
        type: 'string',
        description: 'An extra column whose values the domain holds; the channels that use the scale count anyway.',
      },
      domain: {
        type: 'array',
        description: 'The domain, instead of one inferred from the data: [from, to] for numbers and dates, the categories in order.',
      },
      range: {
        anyOf: [{ type: 'string', enum: ['width', 'height'] }, { type: 'array' }],
        description:
          '"width" or "height" of the plot (the default of scales named x and y), or a list: the colors of a color scale, px of a size scale.',
      },
    };
  if (role === 'guide')
    return {
      scale: { type: 'string', description: 'The name of the scale the guide shows.' },
      position: {
        type: 'string',
        enum: SIDES,
        description: 'The side of the plot it takes. Default: from its scale ("height" left, "width" bottom).',
      },
    };
  return {};
}

/** The definition of one block: its type, common keys, params and channels, nothing else. */
function blockSchema(name, entry) {
  const role = name.slice(0, name.indexOf('.'));
  const type = name.slice(name.indexOf('.') + 1);
  const properties = { type: { type: 'string', const: type } };
  Object.assign(properties, commonKeys(role, entry));
  const required = ['type'];
  for (const [ch, c] of Object.entries(entry.channels || {})) {
    properties[ch] = channelSchema(c);
    if (c.required && c.default === undefined) required.push(ch);
  }
  const channels = entry.channels || {};
  for (const [key, p] of Object.entries(entry.params || {})) {
    // a key that is a channel is read as the channel, as the core does
    if (Object.prototype.hasOwnProperty.call(channels, key)) continue;
    const s = paramSchema(`${name}.${key}`, p);
    // a param that only narrows a common key (an axis's sides) keeps that key's description
    if (!s.description && properties[key] && properties[key].description) s.description = properties[key].description;
    properties[key] = s;
    if (p.required && p.default === undefined) required.push(key);
  }
  const s = { type: 'object', properties, required, additionalProperties: false };
  if (entry.doc) s.description = entry.doc;
  return s;
}

/** One role's choice of blocks: `type` picks the definition, so an editor proposes the keys of that block alone. */
function roleSchema(role, names) {
  const types = names.map((n) => n.slice(role.length + 1));
  return {
    description: ROLE_DOC[role],
    type: 'object',
    required: ['type'],
    properties: { type: { type: 'string', enum: types, description: `Which ${role}.` } },
    allOf: types.map((t) => ({
      if: { type: 'object', properties: { type: { const: t } }, required: ['type'] },
      then: { $ref: `#/definitions/${role}.${t}` },
    })),
  };
}

/** The keys of a chart spec (BC.ChartSpec; SPEC_KEYS in src/core.ts) and `$schema`. */
function specSchema(renderers) {
  const px = { type: 'number', minimum: 0 };
  return {
    type: 'object',
    required: ['data', 'marks'],
    additionalProperties: false,
    properties: {
      $schema: { type: 'string', description: 'The schema this file follows; blockcharts ignores it.' },
      id: { type: 'string', description: 'The id of an element on the page to draw the chart in, instead of where its spec is.' },
      data: { type: 'string', description: 'The name of the dataset in the data lake (BC.data, the page\'s "data").' },
      transforms: {
        type: 'array',
        items: { $ref: '#/definitions/transform' },
        description: 'Applied in order to the dataset before the scales are built.',
      },
      size: {
        type: 'array',
        items: [
          { type: 'number', exclusiveMinimum: 0, description: 'Width, px.' },
          { type: 'number', exclusiveMinimum: 0, description: 'Height, px.' },
        ],
        minItems: 2,
        maxItems: 2,
        additionalItems: false,
        description:
          '[width, height] in px. The chart is laid out at its container\'s width and this height (see "responsive"). Default [640, 400].',
      },
      padding: {
        anyOf: [
          px,
          {
            type: 'object',
            properties: { top: px, right: px, bottom: px, left: px },
            additionalProperties: false,
          },
        ],
        description: 'px around the plot, one number for every side or one per side. Default 16; guides take what they need on top.',
      },
      title: { type: 'string', description: 'A title drawn above the plot.' },
      alt: {
        type: 'string',
        description: 'What a reader who cannot see the chart hears it called: what it shows. Default: the title.',
      },
      scales: {
        type: 'object',
        additionalProperties: { $ref: '#/definitions/scale' },
        description: 'Scales by name, declared once; marks and guides refer to them. A channel uses the scale named like it.',
      },
      guides: { type: 'array', items: { $ref: '#/definitions/guide' }, description: 'Axes, grids, legends, KPI tiles.' },
      marks: {
        type: 'array',
        items: { $ref: '#/definitions/mark' },
        description: 'What is drawn, bottom to top. May be empty when a guide is the chart (a KPI tile).',
      },
      interaction: {
        type: 'array',
        items: { $ref: '#/definitions/interaction' },
        description: 'Tooltips, zoom, brush, legend filters, clicks, ...',
      },
      view: {
        type: 'object',
        additionalProperties: { type: 'array' },
        description: 'The visible domain of scales when the chart opens (zoomed in): scale name to [from, to] or categories.',
      },
      responsive: {
        type: 'boolean',
        default: true,
        description: "Laid out again at its container's width, so text keeps its size. false keeps `size` and scales the drawing.",
      },
      renderer: { type: 'string', enum: renderers, default: 'svg', description: 'What draws it.' },
      locale: {
        type: 'string',
        pattern: LANG,
        description: 'The language numbers and dates are written in where a format names none. Default "en-US".',
      },
    },
  };
}

/** Definitions shared by both schemas: every block, the role choices, channels, formats and the spec itself. */
function definitions(manifest) {
  const names = Object.keys(manifest.blocks).sort();
  const defs = {};
  for (const role of ROLE_ORDER) {
    const ofRole = names.filter((n) => n.startsWith(role + '.'));
    defs[role] = roleSchema(role, ofRole);
    for (const n of ofRole) defs[n] = blockSchema(n, manifest.blocks[n]);
  }
  const renderers = names.filter((n) => n.startsWith('renderer.')).map((n) => n.slice('renderer.'.length));
  const constant = {
    type: 'object',
    required: ['value'],
    properties: {
      value: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }], description: 'The same value for every row.' },
    },
    $comment: 'A constant.',
  };
  defs.channel = {
    $comment: 'A field name (on the scale named like the channel), { "field", "scale" }, or a constant { "value" }.',
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        required: ['field'],
        properties: {
          field: { type: 'string', description: 'A field of the dataset.' },
          scale: { type: 'string', description: 'The name of a declared scale.' },
        },
        additionalProperties: false,
      },
      {
        ...constant,
        properties: { ...constant.properties, scale: { type: 'string', description: 'The name of a declared scale.' } },
        additionalProperties: false,
      },
    ],
  };
  defs.unscaledChannel = {
    $comment: 'A field name, { "field" }, or a constant { "value" }.',
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        required: ['field'],
        properties: { field: { type: 'string', description: 'A field of the dataset.' } },
        additionalProperties: false,
      },
      { ...constant, additionalProperties: false },
    ],
  };
  defs.format = {
    $comment: 'How to write a number or a date: a preset, or Intl.NumberFormat / Intl.DateTimeFormat options.',
    anyOf: [
      { type: 'string', enum: FORMAT_PRESETS },
      {
        type: 'object',
        properties: {
          locale: { type: 'string', pattern: LANG, description: 'Default "en-US".' },
          kind: { type: 'string', enum: ['number', 'date'], description: 'Guessed from the options when left out.' },
          prefix: { type: 'string' },
          suffix: { type: 'string' },
        },
      },
    ],
  };
  defs.spec = specSchema(renderers);
  return defs;
}

const header = (version, file, title, description) => ({
  $schema: DRAFT,
  $id: baseUrl(version) + file,
  title,
  description,
});

/** chart.schema.json: one chart spec. */
function chartSchema(manifest) {
  const defs = definitions(manifest);
  const { spec, ...rest } = defs;
  return {
    ...header(
      manifest.core.version,
      'chart.schema.json',
      `blockcharts ${manifest.core.version} chart`,
      'One chart: a dataset by name, scales, marks, guides and interactions, each a block named by its "type".',
    ),
    ...spec,
    definitions: rest,
  };
}

/** page.schema.json: the composer's page.json (PAGE_KEYS, ENTRY_KEYS in scripts/compose.js, without the program-only keys). */
function pageSchema(manifest) {
  const defs = definitions(manifest);
  const text = (description) => ({ type: 'string', description });
  const lang = (description) => ({ type: 'string', pattern: LANG, description });
  const how = text('A note for whoever makes the page (how it is made). Never shown.');
  defs.section = {
    type: 'object',
    required: ['section'],
    additionalProperties: false,
    description: 'A heading over the whole width that starts a group of cards.',
    properties: {
      section: { type: 'string', minLength: 1, pattern: '\\S', description: 'The heading.' },
      note: text('A line for the reader under the heading.'),
      how,
      lang: lang('The language of the section and the charts after it, until the next section.'),
    },
  };
  defs.entry = {
    type: 'object',
    required: ['spec'],
    additionalProperties: false,
    description: 'A chart in a card, with its heading and note.',
    properties: {
      spec: { $ref: '#/definitions/spec' },
      title: text("The card's heading (and the chart's name for a screen reader when the spec has neither title nor alt)."),
      note: text('A line for the reader under the heading: what the chart shows.'),
      how,
      span: { type: 'integer', minimum: 1, maximum: 12, description: 'How many columns of layout.columns the card takes.' },
      minWidth: {
        type: 'number',
        exclusiveMinimum: 0,
        maximum: 4000,
        description: 'px below which the chart keeps its width and its card scrolls sideways.',
      },
      lang: lang('The language of this chart.'),
      facet: {
        type: 'object',
        required: ['field'],
        additionalProperties: false,
        description: 'Draw the chart once per value of a field, on shared scales, in one card.',
        properties: {
          field: { type: 'string', minLength: 1, description: 'A column of the dataset, or one a transform of the chart makes.' },
          columns: { type: 'integer', minimum: 1, maximum: 6, description: 'Panels in a row.' },
          values: {
            type: 'array',
            items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            description: 'The values to draw, in order; default every value.',
          },
          free: { type: 'array', items: { type: 'string' }, description: 'Scales each panel keeps its own domain of.' },
        },
      },
    },
  };
  defs.chartsItem = {
    description: 'A chart spec, a chart entry { "spec", "title", "note", ... } or a section { "section", "note" }.',
    if: { type: 'object', properties: { section: true }, required: ['section'] },
    then: { $ref: '#/definitions/section' },
    else: {
      if: { type: 'object', properties: { spec: true }, required: ['spec'] },
      then: { $ref: '#/definitions/entry' },
      else: { $ref: '#/definitions/spec' },
    },
  };
  const csvOptions = {
    delimiter: { type: 'string', minLength: 1, maxLength: 1, description: 'Default: guessed from the first line.' },
    nullValues: { type: 'array', items: { type: 'string' }, description: 'Texts that mean a missing value, like ["n/a", "-"].' },
    types: {
      type: 'object',
      additionalProperties: { type: 'string', enum: ['number', 'string'] },
      description: 'A type for a column instead of the guessed one: { "zip": "string" }.',
    },
  };
  defs.binaryColumn = {
    type: 'object',
    required: ['dtype', 'encoding', 'data'],
    additionalProperties: false,
    description: 'A numeric column as raw little-endian values, base64 (optionally gzipped first).',
    properties: {
      dtype: { type: 'string', enum: ['float32', 'float64', 'int8', 'int16', 'int32', 'uint8', 'uint16', 'uint32'] },
      encoding: { type: 'string', enum: ['base64', 'gzip+base64'] },
      data: { type: 'string' },
    },
  };
  defs.dataset = {
    description: 'Rows, { "columns" }, CSV text { "csv" }, a CSV file next to page.json { "csvFile" }, or an encoded dataset.',
    anyOf: [
      { type: 'array', items: { type: 'object' }, description: 'Rows: one object per row.' },
      {
        type: 'object',
        required: ['columns'],
        additionalProperties: false,
        properties: {
          columns: {
            type: 'object',
            additionalProperties: { anyOf: [{ type: 'array' }, { $ref: '#/definitions/binaryColumn' }] },
            description: 'Column name to its values.',
          },
        },
      },
      {
        type: 'object',
        required: ['csv'],
        additionalProperties: false,
        properties: { csv: text('CSV text; the first row names the columns.'), ...csvOptions },
      },
      {
        type: 'object',
        required: ['csvFile'],
        additionalProperties: false,
        properties: { csvFile: text('A CSV file, relative to the folder of page.json and inside it.'), ...csvOptions },
      },
      {
        type: 'object',
        required: ['encoding', 'data'],
        additionalProperties: false,
        properties: {
          encoding: { type: 'string', enum: ['base64', 'gzip+base64'] },
          data: text('The UTF-8 JSON of rows or { columns }, base64 (gzipped first for gzip+base64).'),
        },
      },
    ],
  };
  return {
    ...header(
      manifest.core.version,
      'page.schema.json',
      `blockcharts ${manifest.core.version} page`,
      'A page.json for the composer: one standalone HTML report of charts in cards, with its data.',
    ),
    type: 'object',
    required: ['data', 'charts'],
    additionalProperties: false,
    properties: {
      $schema: { type: 'string', description: 'The schema this file follows; the composer ignores it.' },
      title: text('The heading of the page, and its <title>.'),
      subtitle: text('One line under the heading.'),
      lang: lang('The language of the page ("ko", "zh-CN"): its font and the language numbers and dates are written in.'),
      layout: {
        type: 'object',
        additionalProperties: false,
        description: 'A dashboard grid: cards fill it left to right, each taking its "span" of columns.',
        properties: {
          columns: { type: 'integer', minimum: 1, maximum: 12, default: 1 },
          phoneColumns: {
            type: 'integer',
            enum: [1, 2],
            default: 1,
            description: '2: on a phone, tiles of span 1 that draw as well at any width (KPI tiles) go two to a row.',
          },
        },
      },
      css: text('A stylesheet after the default one. It cannot fetch: url() only for data: URLs, no @import.'),
      defaultCss: { type: 'boolean', default: true, description: 'false leaves out the default stylesheet.' },
      compress: {
        enum: ['auto', true, false],
        default: 'auto',
        description: 'Store datasets gzipped: when it pays ("auto"), always or never.',
      },
      data: {
        type: 'object',
        additionalProperties: { $ref: '#/definitions/dataset' },
        description: 'The datasets, by name; a spec names its own.',
      },
      charts: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/definitions/chartsItem' },
        description: 'Charts and sections, in the order of the page.',
      },
    },
    definitions: defs,
  };
}

/** Both schemas as the files the release carries. */
function schemaFiles(manifest) {
  const json = (v) => JSON.stringify(v, null, 2) + '\n';
  return {
    'schema/chart.schema.json': json(chartSchema(manifest)),
    'schema/page.schema.json': json(pageSchema(manifest)),
  };
}

module.exports = { chartSchema, pageSchema, schemaFiles, baseUrl, FORMAT_PRESETS, SchemaError };
