/// <reference path="../bc.d.ts" />
// <BlockChart :spec="spec" :data="rows" @click="(d) => ..." />: a chart as a Vue 3 component. The chart is drawn after
// mount, so a server renders an empty <div>; the runtime is the kit the app imported (import "blockcharts/kits/basic.mjs").
// @click is a click on the data (interaction.click), with the row; the component's ref exposes the chart's view.
import { defineComponent, h, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import type { PropType } from 'vue';
import { Controller, handleOf } from './controller.mjs';
import type { ChartProps, WrapperSpec } from './controller.mjs';

export type { BlockChartHandle, ChartProps, WrapperSpec } from './controller.mjs';

export const BlockChart = defineComponent({
  name: 'BlockChart',
  props: {
    spec: { type: Object as PropType<WrapperSpec>, required: true },
    data: { type: [Array, Object] as PropType<BC.DatasetInput>, required: false, default: undefined },
    // a prop, not an emit: @click binds to it, and whether it is there is whether the chart takes clicks
    onClick: { type: Function as PropType<NonNullable<ChartProps['onClick']>>, required: false, default: undefined },
  },
  setup(props, { expose }) {
    const host = ref<HTMLElement | null>(null);
    let controller: Controller | null = null;
    const current = (): ChartProps => ({
      // the raw objects: the chart reads them often, and through a reactive proxy every read is slower
      spec: toRaw(props.spec) as WrapperSpec,
      data: props.data === undefined ? undefined : (toRaw(props.data) as BC.DatasetInput),
      onClick: props.onClick,
    });
    expose(handleOf(() => (controller ? controller.handle : null)));
    onMounted(() => {
      controller = new Controller(host.value as HTMLElement);
      controller.set(current());
    });
    const again = () => {
      if (controller) controller.set(current());
    };
    // a spec changed in place (a reactive object) or replaced, data replaced, a listener added: drawn again if it differs
    watch(() => props.spec, again, { deep: true });
    watch(() => props.data, again);
    watch(() => props.onClick, again);
    onBeforeUnmount(() => {
      if (controller) controller.destroy();
      controller = null;
    });
    return () => h('div', { ref: host });
  },
});
