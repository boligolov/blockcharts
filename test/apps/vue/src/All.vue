<script setup>
import 'blockcharts/kits/full.mjs';
import { BlockChart } from 'blockcharts/vue';
import { onMounted, ref, shallowRef } from 'vue';
import { loadAll, renewed, GRID } from '../../shared/all.js';

// shallowRef: large data that is replaced, never changed in place, as Vue's guide advises
const items = shallowRef(null);
const shown = ref(false);
onMounted(async () => {
  items.value = await loadAll();
});
</script>

<template>
  <p v-if="!items" id="loading">Loading…</p>
  <main v-else>
    <p>
      <button id="mount" @click="shown = true">Mount</button>
      <button id="update" @click="items = renewed(items)">Update</button>
      <button id="unmount" @click="shown = false">Unmount</button>
    </p>
    <div id="all" :style="GRID">
      <template v-if="shown">
        <div v-for="it in items" :key="it.key" class="cell">
          <BlockChart :spec="it.spec" :data="it.data" />
        </div>
      </template>
    </div>
  </main>
</template>
