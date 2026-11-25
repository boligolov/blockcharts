import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// ../shared holds the page every app draws: the dev server may serve it
export default defineConfig({ plugins: [vue()], server: { fs: { allow: ['..'] } } });
