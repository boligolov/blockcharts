import { defineConfig } from 'astro/config';

// SITE_BASE is the folder the site is served from ("/" on its own domain, "/blockcharts/" on GitHub Pages).
export default defineConfig({
  base: process.env.SITE_BASE || '/',
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
