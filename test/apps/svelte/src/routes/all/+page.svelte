<script>
  import 'blockcharts/kits/full.mjs';
  import { blockchart } from 'blockcharts/svelte';
  import { onMount } from 'svelte';
  import { loadAll, renewed, GRID_STYLE } from '../../../../shared/all.js';

  let items = $state.raw(null);
  let shown = $state(false);
  onMount(async () => {
    items = await loadAll();
  });
</script>

{#if !items}
  <p id="loading">Loading…</p>
{:else}
  <main>
    <p>
      <button id="mount" onclick={() => (shown = true)}>Mount</button>
      <button id="update" onclick={() => (items = renewed(items))}>Update</button>
      <button id="unmount" onclick={() => (shown = false)}>Unmount</button>
    </p>
    <div id="all" style={GRID_STYLE}>
      {#if shown}
        {#each items as it (it.key)}
          <div class="cell"><div use:blockchart={{ spec: it.spec, data: it.data }}></div></div>
        {/each}
      {/if}
    </div>
  </main>
{/if}
