import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

function vendorChunk(id: string) {
  if (!id.includes('node_modules')) return undefined;

  if (id.includes('react-chartjs-2') || id.includes('/chart.js/')) return 'vendor-charts';
  if (id.includes('@supabase/')) return 'vendor-supabase';
  if (id.includes('/motion/') || id.includes('framer-motion')) return 'vendor-motion';
  if (id.includes('/xlsx/')) return 'vendor-spreadsheet';
  if (id.includes('/pdfjs-dist/')) return 'vendor-pdf';
  if (id.includes('/date-fns/')) return 'vendor-date';
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router/')) return 'vendor-react';

  return 'vendor-common';
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
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
