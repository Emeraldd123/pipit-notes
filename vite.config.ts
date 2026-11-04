import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const commit = (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; } })();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Pipit Notes",
        short_name: "Pipit Notes",
        description: "Private, offline-first handwriting notes.",
        theme_color: "#3d5244",
        background_color: "#eef0ee",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,mjs,wasm,json}"],
        navigateFallback: "/index.html",
        // never answer the reporting endpoint (or any Netlify function) with the app shell
        navigateFallbackDenylist: [/^\/\.netlify\//],
        runtimeCaching: [
          // Pyodide (Python-in-WASM) is big; cache it after first use so code
          // blocks and the step-checker keep working offline.
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/pyodide\//,
            handler: "CacheFirst",
            options: { cacheName: "pyodide", expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/katex/,
            handler: "CacheFirst",
            options: { cacheName: "katex", expiration: { maxEntries: 40 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
