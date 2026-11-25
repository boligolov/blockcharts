import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ../shared holds the page every app draws: the dev server may serve it
export default defineConfig({ plugins: [react()], server: { fs: { allow: ['..'] } } });
