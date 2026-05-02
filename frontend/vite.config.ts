import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // fs.watch is unreliable across Docker-on-Windows bind mounts, so HMR
    // silently drops edits. Polling is slower but actually delivers events.
    watch: { usePolling: true, interval: 300 },
    // Allow the prod hostname through Vite's Host-header check. Comma-separated
    // override via VITE_ALLOWED_HOSTS so a redeploy on a different domain doesn't
    // need a code change.
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS || "localhost,app-6fj3.process-scout.com")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
