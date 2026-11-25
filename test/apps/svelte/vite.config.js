import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// SvelteKit 3 takes its configuration here (no svelte.config.js). Every page is prerendered (src/routes/+layout.js): the
// server renders the smoke page at build time and the browser hydrates it. ../shared holds the page every app draws.
export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })], server: { fs: { allow: ['..'] } } });
