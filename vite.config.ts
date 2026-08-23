import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function vendorChunk(id: string) {
  if (!id.includes('node_modules')) return undefined;

  if (id.includes('react-chartjs-2') || id.includes('/chart.js/'))
    return 'vendor-charts';
  if (id.includes('@supabase/')) return 'vendor-supabase';
  if (id.includes('/motion/') || id.includes('framer-motion'))
    return 'vendor-motion';
  if (id.includes('/xlsx/')) return 'vendor-spreadsheet';
  if (id.includes('/pdfjs-dist/')) return 'vendor-pdf';
  if (id.includes('/date-fns/')) return 'vendor-date';

  return undefined;
}

function appVersionPlugin(buildId: string, builtAt: string): Plugin {
  return {
    name: 'mf-app-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt }),
      });
    },
  };
}

export default defineConfig(() => {
  const buildId = String(Date.now());
  const builtAt = new Date().toISOString();

  return {
    plugins: [react(), tailwindcss(), appVersionPlugin(buildId, builtAt)],
    define: {
      __MF_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: vendorChunk,
        },
      },
    },
    server: {
      // HMR can be disabled in specific environments via DISABLE_HMR.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
