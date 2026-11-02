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
        // The proxy adds `oat serve`'s bearer token, so it stays out of the browser bundle.
        // OAT_API_TOKEN has no VITE_ prefix on purpose: Vite never exposes it to client code.
        '/oat': {
          target: env.OAT_TARGET ?? 'http://127.0.0.1:8787',
          rewrite: (path) => path.replace(/^\/oat/, ''),
          headers: env.OAT_API_TOKEN ? { Authorization: `Bearer ${env.OAT_API_TOKEN}` } : undefined,
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
