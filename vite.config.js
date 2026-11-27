import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The API-Football key is read from the .env file and added by the dev server, so it never reaches the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/pitchapi': {
          target: 'https://api.pitchapi.dev',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/pitchapi/, ''),
          headers: { 'X-API-KEY': env.PITCHAPI_KEY || '' },
        },
      },
    },
  };
});
