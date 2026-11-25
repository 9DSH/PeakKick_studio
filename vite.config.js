import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The API-Football key is read from the .env file and added by the dev server, so it never reaches the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api-football': {
          target: 'https://v3.football.api-sports.io',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api-football/, ''),
          headers: { 'x-apisports-key': env.API_FOOTBALL_KEY || '' },
        },
      },
    },
  };
});
