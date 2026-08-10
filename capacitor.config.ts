import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.mfinanceiro.app',
  appName: 'MF Financeiro',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
