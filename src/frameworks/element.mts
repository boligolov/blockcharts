/// <reference path="../bc.d.ts" />
// <block-chart>: a chart as a custom element, for any framework that sets properties on elements (Angular, Vue, Svelte,
// Solid, Lit) and for plain pages. Importing this file defines it; the runtime is the kit the page loaded.
//   el.spec = {...}; el.data = rows;          or   <block-chart spec='{"data": "sales", ...}'></block-chart>
//   el.addEventListener('bc-click', (e) => e.detail.values)   with { "type": "click" } among the spec's interactions
// Properties set together are drawn once. Taken out of the page, the chart goes; put back, it is drawn again. No shadow
// DOM: the chart takes the page's styles (--bc-* variables, .bc-* classes) as any chart does.
import { Controller } from './controller.mjs';
import type { WrapperSpec } from './controller.mjs';

export type { WrapperSpec } from './controller.mjs';

// a server has no HTMLElement: the class is defined there too, and never used
const Base = (typeof HTMLElement === 'function' ? HTMLElement : class {}) as typeof HTMLElement;

export class BlockChartElement extends Base {
  static get observedAttributes(): string[] {
    return ['spec'];
  }

  private specValue: WrapperSpec | undefined = undefined;
  private dataValue: BC.DatasetInput | undefined = undefined;
  private controller: Controller | null = null;
  private queued = false;

  constructor() {
    super();
    // a framework may set spec or data before this file defined the element: they are own properties then, hiding the
    // setters below, and are taken over
    for (const key of ['spec', 'data'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = (this as Record<string, unknown>)[key];
        delete (this as Record<string, unknown>)[key];
        (this as Record<string, unknown>)[key] = value;
      }
    }
  }

  /** The chart spec. Without `data`, it names a dataset given to BC.data. */
  get spec(): WrapperSpec | undefined {
    return this.specValue;
  }
  set spec(value: WrapperSpec | undefined) {
    this.specValue = value;
    this.schedule();
  }

  /** The chart's own data: rows, { columns } or an encoded dataset. */
  get data(): BC.DatasetInput | undefined {
    return this.dataValue;
  }
  set data(value: BC.DatasetInput | undefined) {
    this.dataValue = value;
    this.schedule();
  }

  /** The chart as drawn now (setView, getView, diagnostics), null when there is none. */
  get chart(): BC.ChartHandle | null {
    return this.controller ? this.controller.handle : null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name !== 'spec' || value === null) return;
    try {
      this.spec = JSON.parse(value) as WrapperSpec;
    } catch (e) {
      console.error('[blockcharts] <block-chart spec> is not valid JSON:', e);
    }
  }

  connectedCallback(): void {
    // a custom element is inline by default, and an inline element has no width to lay the chart out at
    if (!this.style.display) this.style.display = 'block';
    this.schedule();
  }

  disconnectedCallback(): void {
    if (this.controller) this.controller.destroy();
    this.controller = null;
  }

  /** Draw once after the properties set in this turn, if the element is on the page and has a spec. */
  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.isConnected || !this.specValue) return;
      if (!this.controller) this.controller = new Controller(this);
      this.controller.set({ spec: this.specValue, data: this.dataValue });
    });
  }
}

/** Defines the element under `name` (default "block-chart"), unless that name is taken; importing this file already did. */
export function defineBlockChart(name = 'block-chart'): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (registry && !registry.get(name)) registry.define(name, class extends BlockChartElement {});
}

defineBlockChart();

declare global {
  interface HTMLElementTagNameMap {
    'block-chart': BlockChartElement;
  }
}
