import { createApp } from 'vue';

// the smoke page, or every chart (?all): each imports its own kit, so a page loads only the blocks it draws with
const page = new URLSearchParams(location.search).has('all') ? import('./All.vue') : import('./Smoke.vue');
page.then(({ default: Page }) => createApp(Page).mount('#app'));
