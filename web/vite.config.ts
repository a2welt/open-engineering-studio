/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Dev-server proxies keep the browser on one origin, so neither backend needs CORS.
//   /xray -> `xray serve` (Repo X-Ray), /oat -> `oat serve` (OpenAgentTrust)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/xray': {
          target: env.XRAY_TARGET ?? 'http://127.0.0.1:8765',
          rewrite: (path) => path.replace(/^\/xray/, ''),
        },
        '/oat': {
          target: env.OAT_TARGET ?? 'http://127.0.0.1:8787',
          rewrite: (path) => path.replace(/^\/oat/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
