import { defineConfig } from 'vite';

// ../shared holds the page every app draws: the dev server may serve it
export default defineConfig({ server: { fs: { allow: ['..'] } } });
