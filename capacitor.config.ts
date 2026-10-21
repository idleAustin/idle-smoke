import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.idleaustin.smokebreak',
  appName: 'Idle Smoke Break',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;

