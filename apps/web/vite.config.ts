import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // main.tsx awaits the OIDC callback at module top level; Vite's default
  // target predates top-level await.
  build: { target: "es2022" },
  server: {
    port: 5176,
    proxy: {
      "/api": {
        target: "http://localhost:8789",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
