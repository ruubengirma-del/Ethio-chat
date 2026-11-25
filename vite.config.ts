import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false, // Uses public/manifest.json already linked in index.html
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'pwa-vite8-hmr-guard',
        apply: 'serve',
        enforce: 'post',
        transform(code: string, id: string) {
          if (!id.includes('pwa-entry-point-loaded')) return;
          const patched = code
            .replace(/import\.meta\.hot\.on\(/g, 'import.meta.hot?.on(')
            .replace(
              /import\.meta\.hot\.send\(([^)]+)\);?/g,
              `if (import.meta.hot) { import.meta.hot.on('vite:ws:connect', () => { try { import.meta.hot?.send($1); } catch {} }); }`
            );
          return {code: patched, map: null};
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
