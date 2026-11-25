<script setup>
import BC from 'blockcharts/kits/basic.mjs';
import { BlockChart } from 'blockcharts/vue';
import { ref } from 'vue';
import { ROWS3, ROWS4, SHARED, SHARED_ROWS, spec, picked } from '../../shared/smoke.js';

// the dataset charts b and c share, given once, before they mount
BC.data(SHARED, SHARED_ROWS);

// ref, as an app keeps its state: the rows are a deep reactive proxy, which the component reads through
const rows = ref(ROWS3);
const title = ref('Sales');
const showB = ref(true);
const show = ref(true);
const pick = ref('');
const specB = spec('B', { data: SHARED });
const specC = spec('C', { data: SHARED });
</script>

<template>
  <main>
    <p>
      <button id="update" @click="rows = ROWS4">Update</button>
      <button id="retitle" @click="title = 'Revenue'">Retitle</button>
      <button id="remove-b" @click="showB = false">Remove b</button>
      <button id="hide" @click="show = false">Hide</button>
      <output id="picked">{{ pick }}</output>
    </p>
    <template v-if="show">
      <div data-chart="a">
        <BlockChart :spec="spec(title)" :data="rows" @click="(d) => (pick = picked('a', d))" />
      </div>
      <div v-if="showB" data-chart="b">
        <BlockChart :spec="specB" @click="(d) => (pick = picked('b', d))" />
      </div>
      <div data-chart="c">
        <BlockChart :spec="specC" @click="(d) => (pick = picked('c', d))" />
      </div>
    </template>
  </main>
</template>
