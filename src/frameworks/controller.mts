/// <reference path="../bc.d.ts" />
// What every framework wrapper does, once: a chart in an element, drawn from a spec and the chart's own data, built again
// only when the spec or the data really changed, its clicks handed to a function, and nothing left behind when it goes.
// No framework here and no blocks: the runtime is the one a kit put on the page (globalThis.BC), so an app carries only the
// blocks of the kit it chose.

/** A spec for a wrapper: `data` names a dataset of the lake, or is left out when the chart brings its own (`data`). */
export type WrapperSpec = Omit<BC.ChartSpec, 'data'> & { data?: string };

/** What every wrapper takes. */
export interface ChartProps {
  spec: WrapperSpec;
  /** The chart's own data (rows, { columns }, an encoded dataset), no other chart's: kept under a name of its own while the
   *  chart lives and taken away after. A new array or object draws again; changing the old one in place does not. Left out,
   *  the spec names a dataset given to BC.data. */
  data?: BC.DatasetInput;
  /** A click on the data: the row and the browser's event (interaction.click, added to the spec when it lacks one). */
  onClick?: (detail: BC.ClickDetail, event: CustomEvent<BC.ClickDetail>) => void;
}

/** What a wrapper hands to its ref: the chart's view and diagnostics, not its lifecycle, which the framework owns. */
export interface BlockChartHandle {
  /** The chart as drawn now, null before it is mounted and after it is gone. */
  readonly chart: BC.ChartHandle | null;
  setView(scale: string, domain: unknown[] | null): void;
  getView(): Record<string, unknown[]>;
}

/** The handle a ref gets: always the chart of the moment, whichever controller draws it now. */
export function handleOf(chart: () => BC.ChartHandle | null): BlockChartHandle {
  return {
    get chart() {
      return chart();
    },
    setView(scale, domain) {
      const c = chart();
      if (c) c.setView(scale, domain);
    },
    getView() {
      const c = chart();
      return c ? c.getView() : {};
    },
  };
}

/** The runtime a kit put on the page; null when none did. */
export function runtime(): BC.Runtime | null {
  const bc = (globalThis as { BC?: unknown }).BC as BC.Runtime | undefined;
  return bc && typeof bc.chart === 'function' && typeof bc.define === 'function' && typeof bc.version === 'string' ? bc : null;
}

const NO_RUNTIME =
  'blockcharts: no runtime on the page. Import a kit once before charts mount, e.g. import "blockcharts/kits/basic.mjs" (or another kit), or load one with a <script>.';

let counter = 0;
const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** An object a spec is made of (not a Date, a Map, a DOM node): compared and copied by content. */
const plain = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v);
  return Array.isArray(v) || proto === Object.prototype || proto === null;
};

/** Two specs that draw the same: plain values compared by content, dates by time, functions (a tooltip's content) and
 *  other objects by identity. */
export function sameSpec(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b; // NaN
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || depth > 64) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (!plain(a) || !plain(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameSpec(v, bb[i], depth + 1));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameSpec((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1)) return false;
  }
  return true;
}

/** The spec as it is now, so a change the app makes in place later (a reactive object of Vue) still compares as a
 *  change: its plain objects and arrays copied, dates and functions kept. */
export function snapshot<T>(value: T, depth = 0): T {
  if (!value || typeof value !== 'object' || depth > 64 || !plain(value)) return value;
  if (Array.isArray(value)) return value.map((v) => snapshot(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value)) out[k] = snapshot((value as Record<string, unknown>)[k], depth + 1);
  return out as T;
}

/** A chart in `host`, kept as its props say. */
export class Controller {
  handle: BC.ChartHandle | null = null;
  private readonly host: HTMLElement;
  /** The name of the chart's own dataset in the lake, while it has one. */
  private own: string | null = null;
  private data: BC.DatasetInput | undefined = undefined;
  private drawn: BC.ChartSpec | null = null;
  private onClick: ChartProps['onClick'] = undefined;
  private gone = false;
  private readonly listener = (ev: Event): void => {
    const fn = this.onClick;
    if (fn) fn((ev as CustomEvent<BC.ClickDetail>).detail, ev as CustomEvent<BC.ClickDetail>);
  };

  constructor(host: HTMLElement) {
    this.host = host;
    host.addEventListener('bc-click', this.listener);
  }

  /** Draw from these props: the first time, or again when the spec or the data changed. */
  set(props: ChartProps): void {
    if (this.gone) return;
    const bc = runtime();
    if (!bc) {
      if (!this.host.querySelector('.bc-error')) {
        const box = this.host.ownerDocument.createElement('div');
        box.className = 'bc-error';
        box.setAttribute('style', 'font:12px/1.5 monospace;color:#b00020;border:1px solid #b00020;padding:8px;white-space:pre-wrap');
        box.textContent = NO_RUNTIME;
        this.host.appendChild(box);
        console.error(NO_RUNTIME);
      }
      return;
    }
    this.onClick = props.onClick;
    let fresh = false;
    if (props.data !== undefined) {
      if (!this.own) this.own = `bc:own:${++counter}`;
      if (props.data !== this.data) {
        try {
          bc.data(this.own, props.data);
        } catch (e) {
          // a malformed dataset: the chart says so where it stands, as it does for any dataset it cannot read
          bc.data(this.own, null);
          console.error(e);
        }
        this.data = props.data;
        fresh = true;
      }
    } else if (this.own) {
      bc.data(this.own, null);
      this.own = null;
      this.data = undefined;
      fresh = true;
    }
    const spec = this.effective(props, bc);
    if (!this.handle) {
      this.host.textContent = '';
      this.handle = bc.chart(this.host, spec);
    } else if (fresh || !sameSpec(spec, this.drawn)) {
      this.handle.update(spec);
    }
    this.drawn = snapshot(spec);
  }

  /** The spec as drawn: the chart's own dataset in `data`, and interaction.click when there is a function to call. */
  private effective(props: ChartProps, bc: BC.Runtime): BC.ChartSpec {
    let spec = { ...props.spec } as BC.ChartSpec;
    if (this.own) spec.data = this.own;
    const list = Array.isArray(spec.interaction) ? spec.interaction : [];
    if (props.onClick && !list.some((i) => i && i.type === 'click')) {
      if (bc.has('interaction.click')) spec = { ...spec, interaction: list.concat([{ type: 'click' }]) };
      else warnOnce('blockcharts: onClick needs the block interaction.click, which the loaded kit does not have; load it too.');
    }
    return spec;
  }

  /** The chart, its listener and its own dataset go; the element is left empty. */
  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    this.host.removeEventListener('bc-click', this.listener);
    if (this.handle) this.handle.destroy();
    this.handle = null;
    const bc = runtime();
    if (this.own && bc) bc.data(this.own, null);
    this.own = null;
  }
}
