<script>
  import BC from 'blockcharts/kits/basic.mjs';
  import { blockchart } from 'blockcharts/svelte';
  import { ROWS3, ROWS4, SHARED, SHARED_ROWS, spec, picked } from '../../../shared/smoke.js';

  // the dataset charts b and c share, given once, before they mount
  BC.data(SHARED, SHARED_ROWS);

  let rows = $state.raw(ROWS3);
  let title = $state('Sales');
  let showB = $state(true);
  let show = $state(true);
  let pick = $state('');
</script>

<main>
  <p>
    <button id="update" onclick={() => (rows = ROWS4)}>Update</button>
    <button id="retitle" onclick={() => (title = 'Revenue')}>Retitle</button>
    <button id="remove-b" onclick={() => (showB = false)}>Remove b</button>
    <button id="hide" onclick={() => (show = false)}>Hide</button>
    <output id="picked">{pick}</output>
  </p>
  {#if show}
    <div data-chart="a" use:blockchart={{ spec: spec(title), data: rows, onClick: (d) => (pick = picked('a', d)) }}></div>
    {#if showB}
      <div data-chart="b" use:blockchart={{ spec: spec('B', { data: SHARED }), onClick: (d) => (pick = picked('b', d)) }}></div>
    {/if}
    <div data-chart="c" use:blockchart={{ spec: spec('C', { data: SHARED }), onClick: (d) => (pick = picked('c', d)) }}></div>
  {/if}
</main>
