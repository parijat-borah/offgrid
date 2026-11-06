import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Same-origin /api in dev and preview, so the httpOnly refresh cookie works without CORS credentials.
const proxy = { "/api": "http://localhost:4000" };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "OFFGRID: trek and travel companion",
        short_name: "OFFGRID",
        description: "Plan safe, on-budget Himalayan trips that keep working without a network.",
        theme_color: "#17613f",
        background_color: "#f5f6f2",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // The bundled fallback pack (places + 800 OSM points) is a JS chunk, so it's precached too:
        // the app works offline from the very first visit.
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
        // Fonts ship every script subset; precache only Latin (which includes ₹). Others load on demand.
        globIgnores: ["**/*-cyrillic*", "**/*-greek*", "**/*-vietnamese*"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Only tiles you've actually looked at are cached (OSM's tile policy forbids bulk prefetching).
            urlPattern: ({ url }) => url.origin === "https://tile.openstreetmap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Place photos from Wikimedia Commons: cached once seen, so a plan opened at home still shows them on the trail.
            urlPattern: ({ url }) => url.origin === "https://thumb.wikimedia.org" || url.origin === "https://upload.wikimedia.org",
            handler: "CacheFirst",
            options: {
              cacheName: "place-photos",
              expiration: { maxEntries: 250, maxAgeSeconds: 90 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/uploads/"),
            handler: "CacheFirst",
            options: { cacheName: "photos", expiration: { maxEntries: 300, maxAgeSeconds: 90 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    // Content lives in /data at the repo root; it's the bundled fallback when no pack has been downloaded yet.
    alias: { "@data": fileURLToPath(new URL("../../data", import.meta.url)) },
  },
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
