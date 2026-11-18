import { defineConfig, loadEnv, type Plugin } from 'vite';
import type {} from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Strict CSP is injected only into production builds: the dev server needs inline scripts for HMR.
// connect-src allows any HTTPS origin because BYOK endpoints are user-configured (see DECISIONS ADR 12).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// Keys in .env are for local use. Refuse to bake them into a distributable bundle by accident.
function keyGuardPlugin(mode: string): Plugin {
  return {
    name: 'byok-key-guard',
    apply: 'build',
    buildStart() {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const withKeys = Object.keys(env).filter((k) => k.endsWith('_API_KEY') && env[k]);
      if (withKeys.length > 0 && process.env.ALLOW_KEYS_IN_BUNDLE !== '1') {
        this.error(
          `Refusing to build: ${withKeys.join(', ')} would be embedded in the bundle. ` +
            'Remove them for a publishable build, or set ALLOW_KEYS_IN_BUNDLE=1 for a private, personal build.',
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.5.0') },
  plugins: [
    react(),
    cspPlugin(),
    keyGuardPlugin(mode),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Executive Reflexes',
        short_name: 'Reflexes',
        description: 'Deliberate-practice gym for executive communication. Local-first, BYOK.',
        theme_color: '#14213d',
        background_color: '#f6f4ef',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], navigateFallback: 'index.html' },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
}));
