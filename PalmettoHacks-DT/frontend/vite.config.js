import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Standalone mode imports the shared fixtures from ../data.
    fs: { allow: [".."] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/recharts/")) return "recharts";
          if (id.includes("/node_modules/d3-")) return "d3";
          if (id.includes("/node_modules/victory-vendor/")) return "chart-vendor";
        },
      },
    },
  },
});
