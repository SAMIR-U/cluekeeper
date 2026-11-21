import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/",

  plugins: [
    react(),

    VitePWA({
      registerType: "prompt",

      manifest: {
        name: "ClueKeeper",
        short_name: "ClueKeeper",
        description: "Rally de observación interactivo",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#047857",
        background_color: "#f3f8f4",

        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,

        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],

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
        ],
      },
    }),
  ],
});
