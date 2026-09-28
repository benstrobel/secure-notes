import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.svg"],
      manifest: {
        name: "Secure Notes",
        short_name: "Secure Notes",
        description: "A private, encrypted diary/notes app that backs up to your own Google Drive.",
        start_url: "/",
        display: "standalone",
        background_color: "#1b2430",
        theme_color: "#1b2430",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Everything the app needs is precached at install time; there is
        // no API server to proxy requests to (Drive calls go straight from
        // the client, bypassing the service worker's fetch handler by URL).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallbackDenylist: [/^\/oauth2callback/],
      },
    }),
  ],
});
