
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
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#14213d",
        background_color: "#ffffff",

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
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,woff2}",
        ],
        navigateFallback: "/index.html",
      },
    }),
  ],
});
