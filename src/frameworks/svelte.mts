/// <reference path="../bc.d.ts" />
// <div use:blockchart={{ spec, data, onClick }}></div>: a chart as a Svelte action (Svelte 4 and 5). Plain JavaScript, so
// nothing has to compile it; the runtime is the kit the app imported (import "blockcharts/kits/basic.mjs"). An action runs
// in the browser only, so a server renders the empty element.
import { Controller } from './controller.mjs';
import type { ChartProps } from './controller.mjs';

export type { ChartProps, WrapperSpec } from './controller.mjs';

/** What Svelte expects of an action (svelte/action's ActionReturn), written out so the action needs nothing of Svelte's. */
export interface BlockChartAction {
  update(props: ChartProps): void;
  destroy(): void;
}

export function blockchart(node: HTMLElement, props: ChartProps): BlockChartAction {
  const controller = new Controller(node);
  controller.set(props);
  return {
    update(next) {
      controller.set(next);
    },
    destroy() {
      controller.destroy();
    },
  };
}
