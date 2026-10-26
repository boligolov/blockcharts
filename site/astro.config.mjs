import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { createRequire } from 'node:module';

const { SITE } = createRequire(import.meta.url)('../scripts/site-prebuild.js');

// SITE_BASE is the folder the site is served from ("/" on its own domain, "/blockcharts/" on GitHub Pages).
export default defineConfig({
  site: SITE,
  integrations: [sitemap()],
  base: process.env.SITE_BASE || '/',
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
