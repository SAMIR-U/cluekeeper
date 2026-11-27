import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isUserPagesSite = repository?.endsWith(".github.io");
const base = process.env.GITHUB_ACTIONS === "true" && repository && !isUserPagesSite
  ? `/${repository}/`
  : "/";

export default defineConfig({
  base,

  plugins: [
    react(),

    VitePWA({
      registerType: "prompt",

      manifest: {
        name: "ClueKeeper",
        short_name: "ClueKeeper",
        description: "Rally de observación interactivo",
        lang: "es",
        start_url: "./",
        scope: base,
        display: "standalone",
        theme_color: "#047857",
        background_color: "#f3f8f4",

        icons: [
          {
            src: `${base}pwa-192x192.png`,
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: `${base}pwa-512x512.png`,
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
        importScripts: ["push-sw.js"],

        globPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,webp,svg,woff2}"],

        // No precachear index.html como navegación fija
        globIgnores: ["**/index.html"],
        navigateFallback: null,

        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              url.origin === self.location.origin,

            handler: "NetworkFirst",

            options: {
              cacheName: "cluekeeper-pages-v1",

              networkTimeoutSeconds: 5,

              cacheableResponse: {
                statuses: [200],
              },

              expiration: {
                maxEntries: 10,
              },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin && /\/pwa-(?:192x192|512x512)\.png$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "cluekeeper-brand-v1",
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
