/**
 * blockcharts — contracts between the core and blocks.
 *
 * Ambient on purpose: no import/export anywhere. Every block file is a plain
 * classic script (works from file://, inlines into <script>), and tsc emits it
 * as-is. A block is written as
 *
 *     (function () {
 *       BC.define({ role: 'mark', type: 'rect', version: 1, requires: [...], ... });
 *     })();
 *
 * Page shape (what an agent writes):
 *
 *     <script type="application/json" id="bc-data">{ "sales": [ {...}, ... ] }</script>
 *     <script type="application/json" data-bc-chart>{ "data": "sales", ... }</script>
 *
 * The chart is mounted where its <script data-bc-chart> sits (or into #spec.id).
 */
declare namespace BC {
  // ───────────────────────── data lake ─────────────────────────

  type Row = Record<string, unknown>;
  /** Numeric fields load as Float64Array, not boxed numbers — fewer GC pauses on
   *  scans/domain inference, and the same shape the future Canvas renderer needs. */
  type Column = ArrayLike<unknown> | Float64Array;

  /** Normalized, columnar. Rows are converted on load (numeric fields → Float64Array). */
  interface Table {
    readonly length: number;
    readonly columns: Readonly<Record<string, Column>>;
  }

  /** A dataset stored as text: the UTF-8 JSON of rows or { columns }, base64-encoded, optionally gzipped first.
   *  Decoded asynchronously (gzip needs DecompressionStream); charts wait for their dataset, see Runtime.ready. */
  interface EncodedDataset {
    encoding: 'base64' | 'gzip+base64';
    data: string;
  }

  /** One numeric column stored as raw little-endian values (base64, optionally gzipped first): 4 or 8 bytes per value
   *  instead of ~10 characters of JSON. Used as a value in `columns`; read as Float64 (NaN = missing for float types). */
  interface BinaryColumn {
    dtype: 'float32' | 'float64' | 'int8' | 'int16' | 'int32' | 'uint8' | 'uint16' | 'uint32';
    encoding: 'base64' | 'gzip+base64';
    data: string;
  }

  type DatasetInput = Row[] | { columns: Record<string, unknown[] | BinaryColumn> } | EncodedDataset;

  /** Content of <script id="bc-data">. Datasets are shared by name between charts. */
  type DataLake = Record<string, DatasetInput>;

  // ───────────────────────── spec (what the agent writes) ─────────────────────────

  /** Common shape of every block reference in a spec: `type` selects `<role>.<type>`. */
  interface BlockSpec {
    type: string;
    [param: string]: unknown;
  }

  interface ChartSpec {
    id?: string;
    /** Key in the data lake. */
    data: string;
    /** Applied in order to the dataset before scales are built (stack, bin, ...). */
    transforms?: TransformSpec[];
    /** Logical size; the SVG uses it as viewBox and scales to the container. Default [640, 400]. */
    size?: [number, number];
    padding?: Partial<Insets>;
    title?: string;
    /** Declared once per chart, referenced by name from marks and guides. */
    scales?: Record<string, ScaleSpec>;
    guides?: GuideSpec[];
    marks: MarkSpec[];
    interaction?: InteractionSpec[];
    /** Initial view: scale name → visible domain (zoomed state). Same thing `setView` changes at runtime. */
    view?: Record<string, unknown[]>;
    /** When the chart's container is narrower than `size` (a phone), the chart is laid out again at the container's width,
     *  so text keeps its size instead of shrinking with the drawing; and again whenever that width changes. Default true;
     *  false keeps `size` and only scales. A wider container scales the drawing up as always. */
    responsive?: boolean;
    /** Default "svg". */
    renderer?: string;
  }

  interface TransformSpec extends BlockSpec {}

  interface ScaleSpec extends BlockSpec {
    /** Extra column contributing to the domain; marks' channels contribute automatically. */
    field?: string;
    /** Explicit domain overrides inference. */
    domain?: unknown[];
    /** "width" | "height" resolve to the plot area (defaults for scales named x / y);
     *  otherwise an explicit range (numbers, or colors for color scales). */
    range?: 'width' | 'height' | unknown[];
  }

  interface GuideSpec extends BlockSpec {
    /** Name of the scale the guide is bound to. */
    scale?: string;
    /** Which side of the plot the guide occupies. Default: derived from the
     *  bound scale's resolved range ("height" → "left", "width" → "bottom").
     *  Set explicitly for a second guide on the same side (e.g. a secondary
     *  y-axis: `{"type":"axis","scale":"y2","position":"right"}`). */
    position?: 'top' | 'right' | 'bottom' | 'left';
  }

  interface MarkSpec extends BlockSpec {
    /** Channels: "date" = field on the scale named like the channel (x → scale "x");
     *  { field, scale } is explicit; { value } is a constant. */
    [channel: string]: unknown;
  }

  interface InteractionSpec extends BlockSpec {}

  /** What interaction.tooltip hands to a custom `content` function. */
  interface TooltipDatum {
    /** Row of the table under the pointer. */
    row: number;
    /** Every column of that row, not only the ones the mark reads. */
    values: Record<string, unknown>;
    /** The default content: a label and a formatted value per line. */
    lines: [string, string][];
    mark: MarkSpec;
    markIndex: number;
    /** Anchor of the marker, in display-list px. */
    x: number;
    y: number;
    table: Table;
  }

  /** What a tooltip `content` function may return. A string is inserted as text. `{ html }` is inserted as markup
   *  (the caller is responsible for escaping data in it). A Node is inserted as is. An array inserts each item.
   *  null / false hides the tooltip; undefined keeps the default content. */
  type TooltipContent = string | number | { html: string } | Node | null | false | undefined | readonly TooltipContent[];

  type ChannelSpec =
    | string
    | { field?: string; scale?: string; value?: number | string };

  // ───────────────────────── geometry ─────────────────────────

  interface Rect { x: number; y: number; w: number; h: number }
  interface Insets { top: number; right: number; bottom: number; left: number }

  // ───────────────────────── scales ─────────────────────────

  interface Tick {
    value: unknown;
    /** Position in the scale's range: px for positional scales, a fraction 0..1 of the domain for a continuous color scale. */
    pos: number;
    label: string;
  }

  /** A callable data → range mapping. `any` because the domain is per-kind. */
  interface Scale<D = any, R = any> {
    (value: D): R;
    readonly kind: string;
    /** Current (view) domain — what ticks and mapping use. Equals baseDomain() until zoomed. */
    domain(): D[];
    /** Domain inferred from data / spec, before any view is applied. */
    baseDomain(): D[];
    /** Set the view domain; null resets to baseDomain(). Never changes the range. */
    setDomain(domain: D[] | null): void;
    range(): R[];
    /** Called by the core after layout settles (guides may shrink the plot). */
    setRange(range: R[]): void;
    invert?(px: number): D;
    ticks?(approxCount?: number): Tick[];
    /** band / point scales only */
    readonly bandwidth?: number;
  }

  /** Passed to ScaleDef.create. */
  interface ScaleCtx {
    readonly name: string;
    /** Columns of every channel bound to this scale (plus spec.field). Domain inference input. */
    readonly sources: readonly Column[];
    /** Range already resolved from spec.range and the provisional plot rect. */
    readonly range: readonly unknown[];
    /** Categorical color by index from the theme palette (same as ChartCtx.color). */
    color(index: number): string;
  }

  // ───────────────────────── display list ─────────────────────────

  /** Which table row of which mark a primitive represents — interaction uses it for hit-testing. */
  interface DatumRef { mark: number; row: number }

  interface Style {
    fill?: string;            // any CSS color, CSS variables allowed (theming)
    stroke?: string;
    strokeWidth?: number;
    strokeDash?: number[];
    opacity?: number;
    fillOpacity?: number;
    strokeLinejoin?: 'round' | 'miter' | 'bevel';
    strokeLinecap?: 'round' | 'butt' | 'square';
    /** The fill fades out downwards: full `fillOpacity` at the top of the plot, transparent at its bottom (a vertical
     *  gradient over the plot rectangle, the same for every shape, so areas stacked on one chart fade alike). */
    fade?: boolean;
  }

  interface PrimBase {
    style?: Style;
    /** CSS class hook for user styling / printing. */
    cls?: string;
    ref?: DatumRef;
    /** Native tooltip / accessibility label. */
    title?: string;
    /** Extra attributes, written as `data-<key>` (a legend item tells an interaction which value it stands for). */
    data?: Record<string, string>;
  }

  /** `d` is a standard SVG path string (Path2D understands it too, so a Canvas renderer can reuse it). */
  interface PathPrim extends PrimBase { type: 'path'; d: string }
  interface RectPrim extends PrimBase { type: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  interface CirclePrim extends PrimBase { type: 'circle'; cx: number; cy: number; r: number }
  interface TextPrim extends PrimBase {
    type: 'text';
    x: number;
    y: number;
    text: string;
    size?: number;
    weight?: number | string;
    anchor?: 'start' | 'middle' | 'end';
    baseline?: 'auto' | 'middle' | 'hanging';
    /** degrees around (x, y) */
    rotate?: number;
  }
  interface GroupPrim extends PrimBase {
    type: 'g';
    children: Prim[];
    translate?: [number, number];
    clip?: Rect;
  }
  type Prim = PathPrim | RectPrim | CirclePrim | TextPrim | GroupPrim;

  /** Draw order, bottom to top. */
  type LayerName = 'grid' | 'marks' | 'axes' | 'overlay';
  type Emission = Partial<Record<LayerName, Prim[]>>;

  interface Layer { name: LayerName; prims: Prim[]; clip?: Rect }
  interface DisplayList {
    size: { w: number; h: number };
    plot: Rect;
    layers: Layer[];
  }

  // ───────────────────────── contexts ─────────────────────────

  /** Resolved data of one mark channel. */
  interface ChannelData {
    readonly field?: string;
    readonly scale?: Scale;
    /** Column values (or a constant expanded to table length). */
    readonly raw: Column;
    /** `scale(raw[i])`; for constants, the constant itself. Marks read this. */
    readonly mapped: ArrayLike<any>;
  }

  interface ChartCtx {
    readonly spec: ChartSpec;
    readonly table: Table;
    readonly size: { w: number; h: number };
    readonly plot: Rect;
    readonly scales: Readonly<Record<string, Scale>>;
    /** Resolve and cache a channel of a mark. Throws a Diagnostic-worthy error if required and missing. */
    channel(mark: MarkSpec, name: string): ChannelData;
    /** Which plot axis a positional scale runs along (from its resolved `range`: "width" → horizontal,
     *  "height" → vertical); null for non-positional scales (color, size). Guides use it to pick a default side. */
    orientation(scale: string): 'horizontal' | 'vertical' | null;
    /** Ticks the chart uses for a scale, computed once per frame and shared by every guide, so an axis and
     *  a grid line up. `approxCount` defaults to plot size / 40px (vertical) or / 80px (horizontal). */
    ticks(scale: string, approxCount?: number): Tick[];
    /** Rows of the table a mark has to draw. Marks loop over `from..to` instead of `0..table.length`. While a scale is
     *  zoomed and the column bound to it is sorted (either way), only the rows inside the plot are returned, with one
     *  neighbour on each side and 12 px of margin; otherwise the whole table. Mapped channel values outside the range
     *  are NaN. */
    rows(mark: MarkSpec): { from: number; to: number };
    /** Rows of a mark split into series — by its `group` param or by the field of its `color` channel; no
     *  such field = one series — each in x order (rows unsorted by `xs` are sorted). Lines and areas share it. */
    series(mark: MarkSpec, xs: ArrayLike<number>): { key: unknown; rows: number[] }[];
    /** Categorical color by index, from the theme (`--bc-c<N>`) with a built-in fallback palette. */
    color(index: number): string;
    /** Rough text measurement for layout (no DOM access). */
    measure(text: string, size?: number): { w: number; h: number };
  }

  /** Available to interactions once the chart is in the DOM. */
  interface LiveCtx extends ChartCtx {
    readonly host: HTMLElement;
    readonly root: Element;
    /** The current display list (a new one after every redraw). */
    readonly list: DisplayList;
    /** Change the visible domain of a scale (null = back to the full domain). Calls in one frame are
     *  merged; only marks, guides and rendering rerun — the layout stays frozen. */
    setView(scale: string, domain: unknown[] | null): void;
    /** The requested visible domain of every scale (applied at the next frame); the full domain if not zoomed. */
    getView(): Record<string, unknown[]>;
    /** The domain `scale` would have if it were inferred from only the rows visible in the requested view of
     *  `follow` (same nice / zero / padding rules as the full domain). null = there is no view to follow or no
     *  row is visible: leave the scale alone. Feed it to setView to auto-fit y to an x zoom. */
    fit(scale: string, follow: string): unknown[] | null;
    /** Which datum an event target belongs to (reads DatumRef from the DOM; only meaningful with the SVG renderer). */
    hit(ev: Event): DatumRef | null;
    /** The `data` of the primitive under a pointer event (a legend item says which value it stands for), or null.
     *  Works with every renderer: the DOM ones read the element, the canvas one tests the display list. */
    dataAt(ev: MouseEvent): Record<string, string> | null;
    /** Register teardown; the core runs it on destroy/update. */
    cleanup(fn: () => void): void;
    /** Make `host` a positioning context (`position: relative`, unless it already is one) for an absolutely-positioned
     *  overlay (a tooltip marker, a drag box, a button bar). Calls stack: `host` only goes back to how it was once
     *  every claim on it has called the returned release function. Interactions must not set `host.style.position`
     *  themselves — more than one may need it at once, and a plain "save it, restore it" fights the others. */
    claimPosition(): () => void;
  }

  // ───────────────────────── blocks ─────────────────────────

  type Role = 'scale' | 'transform' | 'mark' | 'guide' | 'interaction' | 'renderer';
  /** `<role>.<type>`, e.g. "scale.linear", "mark.rect". Derived, never written by hand. */
  type BlockName = `${Role}.${string}`;

  interface ParamDef {
    kind: 'string' | 'number' | 'boolean' | 'enum' | 'field' | 'scale' | 'list' | 'any';
    required?: boolean;
    default?: unknown;
    /** for kind "enum" */
    values?: readonly string[];
    doc?: string;
  }

  interface ChannelDef {
    required?: boolean;
    /** Scale kinds accepted, e.g. ['linear','time']. Omitted = any. */
    scales?: readonly string[];
    /** Channel whose scale this one uses by default (e.g. `y2` of a rect shares the scale of `y`), instead of a scale
     *  named like itself. An explicit { field, scale } still wins. */
    sharesScale?: string;
    /** The channel is a plain field (a label, a slice size) read as it is: no scale, `mapped` equals `raw`. Naming a scale
     *  for it is a validation error. */
    unscaled?: boolean;
    default?: unknown;
    doc?: string;
  }

  interface BlockBase {
    /** Second part of the name. */
    type: string;
    /** Integer; bump on any behavior change. Same name + same version = idempotent no-op. */
    version: number;
    /** Full names of blocks this one needs at runtime. Single source of truth for the manifest. */
    requires?: readonly BlockName[];
    /** Validated by the core, exported to the manifest for the agent. */
    params?: Readonly<Record<string, ParamDef>>;
    doc?: string;
  }

  interface ScaleDef extends BlockBase {
    role: 'scale';
    create(spec: ScaleSpec, ctx: ScaleCtx): Scale;
  }

  /** What a view-dependent transform may look at: where the plot is and the scales as they are drawn now (zoomed). */
  interface TransformView {
    readonly plot: Rect;
    readonly scales: Readonly<Record<string, Scale>>;
    /** Report something worth knowing that is not an error (data left as it is because it is unsorted, ...). It becomes a
     *  warning in the chart's diagnostics, once, however often the transform reruns. */
    warn(message: string): void;
  }

  interface TransformDef extends BlockBase {
    role: 'transform';
    /** true = the result depends on what is visible (level of detail, bins that refine when zooming). The transform,
     *  and every transform after it, runs again at every redraw with `view`; the ones before it run once. Scale
     *  domains are still inferred from the full data. */
    viewDependent?: boolean;
    apply(table: Table, spec: TransformSpec, view?: TransformView): Table;
    /** Names of the columns `apply` adds, so validation still knows every field after the transform ran. */
    outputs?(spec: TransformSpec): string[];
    /** The result is a new table, not the old one plus columns (group-by, binning): after it only the `outputs` exist, and
     *  validation flags a reference to a column the transform dropped. */
    replacesColumns?: boolean;
  }

  /** A datum a mark found near a pointer position (logical px, same space as the display list). */
  interface Pick {
    row: number;
    /** Anchor for a marker / tooltip. */
    x: number;
    y: number;
    /** 0 = the pointer is on the shape, larger = farther. Lets an interaction choose between marks. */
    dist: number;
    /** The shape's own bounding box (logical px), when it has one (rect marks: bar, heatmap). An interaction can
     *  highlight this instead of a dot at `x`/`y` — a dot on a bar's edge reads as a rendering glitch, not a marker. */
    box?: { x: number; y: number; w: number; h: number };
  }

  interface MarkDef extends BlockBase {
    role: 'mark';
    channels: Readonly<Record<string, ChannelDef>>;
    /** Pure: spec + context → primitives for the "marks" layer. `index` is the mark's position in spec.marks.
     *  Line/area emit ONE PathPrim per series (single pass building one `d` string), never one primitive
     *  per point — that's what keeps large series cheap for the SVG renderer (see uPlot's single-Path2D-per-series). */
    render(spec: MarkSpec, ctx: ChartCtx, index: number): Prim[];
    /** Hit-testing lives with the mark that knows its shapes. Return the closest datum within a mark-specific
     *  reach of (x, y), or null. Interactions (tooltip) call it on every mark and keep the smallest `dist`. */
    pick?(spec: MarkSpec, ctx: ChartCtx, index: number, x: number, y: number): Pick | null;
  }

  /** What a guide needs around the plot. The side keys are space the guide occupies and add up with other guides
   *  (they stack). `overhang` is different: how far past the plot edge something the guide draws sticks out — the end
   *  label of a horizontal axis is centered on the plot edge and needs half its width. Overhangs of all guides combine
   *  by taking the largest, and only widen the margin if the padding and the stacked guides do not already cover them. */
  interface GuideMeasure extends Partial<Insets> {
    overhang?: Partial<Insets>;
  }

  interface GuideDef extends BlockBase {
    role: 'guide';
    /** Space the guide needs around the plot (axis labels), keyed by its own side
     *  (see GuideSpec.position). Called before the plot rect is final. */
    measure?(spec: GuideSpec, ctx: ChartCtx): GuideMeasure;
    /** `offset` is the inset already claimed on this guide's side by earlier
     *  entries in `spec.guides` (array order) — e.g. a second y-axis with
     *  `position: "right"` uses it to draw outside the first one instead of
     *  on top of it. Zero on all sides when this is the only guide there. */
    render(spec: GuideSpec, ctx: ChartCtx, offset: Insets): Emission;
  }

  interface InteractionDef extends BlockBase {
    role: 'interaction';
    attach(spec: InteractionSpec, live: LiveCtx): void;
  }

  interface Rendered {
    /** Stays the same element across updates: interactions attach listeners to it once. */
    root: Element;
    /** Redraw in place with a new display list (same size, possibly different primitives). */
    update(list: DisplayList): void;
    /** For renderers without elements to hit-test (canvas): the `data` of the topmost primitive under the pointer.
     *  Left out, the core reads `data-*` attributes of the event target instead. */
    dataAt?(ev: MouseEvent): Record<string, string> | null;
    destroy(): void;
  }

  interface RendererDef extends BlockBase {
    role: 'renderer';
    render(list: DisplayList, host: HTMLElement): Rendered;
  }

  type BlockDef = ScaleDef | TransformDef | MarkDef | GuideDef | InteractionDef | RendererDef;

  /** How to write a number or a date: a preset name ("percent", "compact", "integer", "year", "month", "day", "date",
   *  "datetime"), or an object of Intl.NumberFormat / Intl.DateTimeFormat options plus a few of our own. JSON-friendly on purpose. */
  interface FormatSpec {
    /** BCP 47 locale, default "en-US" (fixed, so a report reads the same for every reader). */
    locale?: string;
    /** "number" or "date"; guessed from the options when omitted. */
    kind?: 'number' | 'date';
    prefix?: string;
    suffix?: string;
    /** e.g. { style: "currency", currency: "USD", maximumFractionDigits: 0 }, { month: "short", year: "2-digit" } */
    [intlOption: string]: unknown;
  }

  // ───────────────────────── runtime (core.js) ─────────────────────────

  interface Diagnostic {
    level: 'error' | 'warn';
    /** JSON-path-ish location in the spec, e.g. "marks[1].y". */
    path: string;
    message: string;
  }

  interface ChartHandle {
    readonly host: HTMLElement;
    readonly spec: ChartSpec;
    readonly diagnostics: readonly Diagnostic[];
    /** Resolves once the chart has been built for the first time (after its dataset finished decoding). */
    readonly ready: Promise<void>;
    /** Rebuild with a new spec. The current zoom is kept for every scale that still exists with the same type
     *  (except where the new spec sets its own `view`); `resetView: true` starts from the spec instead. */
    update(spec: ChartSpec, options?: { resetView?: boolean }): void;
    /** External control of the visible domain, same mechanism the zoom interaction uses. */
    setView(scale: string, domain: unknown[] | null): void;
    getView(): Record<string, unknown[]>;
    destroy(): void;
  }

  interface Runtime {
    readonly version: string;

    /** Idempotent: same name+version is ignored, different version warns and keeps the first. */
    define(def: BlockDef): void;
    has(name: BlockName): boolean;
    get(name: BlockName): BlockDef | undefined;
    blocks(): BlockName[];

    /** Add/replace a dataset in the data lake (the page's #bc-data is loaded on mount). Rows and columns are
     *  available at once; an EncodedDataset is decoded in the background (a failure is reported by the charts
     *  that use it, and by console.error). A malformed plain dataset throws. */
    data(name: string, input: DatasetInput): void;
    /** Resolves when every dataset that was being decoded has settled. Never rejects. */
    ready(): Promise<void>;
    /** Register a function that specs can refer to by name (e.g. tooltip `content: "myTip"`), because JSON
     *  cannot carry code. Last registration wins; specs look the name up when they use it. */
    defineFn(name: string, fn: (...args: any[]) => unknown): void;
    /** A function that writes values as the spec says (numbers, or dates in UTC). Missing values give "". Built once per
     *  spec and cached. An invalid spec throws an Error that says what is wrong. `kind` fixes number or date. */
    formatter(spec: string | FormatSpec, kind?: 'number' | 'date'): (value: unknown) => string;
    getFn(name: string): ((...args: any[]) => unknown) | undefined;

    /** Direct block names a spec uses (e.g. ["scale.time","mark.line","guide.axis","renderer.svg"]).
     *  Pure function of the spec; the same mapping a composer applies with the manifest closures. */
    needs(spec: ChartSpec): BlockName[];
    /** Missing blocks, unknown params, dangling scale/field references. Never throws. */
    validate(spec: ChartSpec): Diagnostic[];

    chart(host: HTMLElement, spec: ChartSpec): ChartHandle;
    /** Load #bc-data, find every <script data-bc-chart>, mount. Runs automatically on DOMContentLoaded, unless
     *  `globalThis.BC_CONFIG = { autoMount: false }` was set before the core loaded. */
    mount(root?: ParentNode): ChartHandle[];
  }

  // ───────────────────────── build output ─────────────────────────

  /** manifest.json, generated by the build from the registry — nobody edits it. */
  interface ManifestEntry {
    file: string;
    bytes: number;
    version: number;
    requires: BlockName[];
    /** Transitive requires including the block itself; a composer unions these across a page. */
    closure: BlockName[];
    params?: Record<string, ParamDef>;
    channels?: Record<string, ChannelDef>;
    doc?: string;
  }

  interface Manifest {
    core: { file: string; bytes: number; version: string };
    blocks: Record<BlockName, ManifestEntry>;
  }
}

declare const BC: BC.Runtime;
