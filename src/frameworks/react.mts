/// <reference path="../bc.d.ts" />
// <BlockChart spec={spec} data={rows} onClick={(d) => ...} />: a chart as a React component (React 18 and 19). The chart is
// drawn after mount, so a server renders an empty <div>; the runtime is the kit the app imported (import
// "blockcharts/kits/basic.mjs"). The ref is a BlockChartHandle: the chart's view (setView, getView) and the chart itself.
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import { Controller, handleOf } from './controller.mjs';
import type { BlockChartHandle, ChartProps } from './controller.mjs';

export type { BlockChartHandle, ChartProps, WrapperSpec } from './controller.mjs';

export interface BlockChartProps extends ChartProps {
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export const BlockChart: ForwardRefExoticComponent<BlockChartProps & RefAttributes<BlockChartHandle>> = forwardRef<
  BlockChartHandle,
  BlockChartProps
>(function BlockChart(props, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const controller = useRef<Controller | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useImperativeHandle(ref, () => handleOf(() => (controller.current ? controller.current.handle : null)), []);
  // mounted once (twice in StrictMode, which unmounts in between); every render after hands it the props, and the
  // controller draws again only when the spec or the data changed
  useEffect(() => {
    const c = new Controller(host.current as HTMLDivElement);
    controller.current = c;
    c.set(latest.current);
    return () => {
      c.destroy();
      if (controller.current === c) controller.current = null;
    };
  }, []);
  useEffect(() => {
    if (controller.current) controller.current.set(props);
  });
  return createElement('div', { ref: host, id: props.id, className: props.className, style: props.style });
});
