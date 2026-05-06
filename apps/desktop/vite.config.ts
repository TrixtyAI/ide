import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({
      org: "unsetsoft",
      project: "trixty-ide",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri expects a fixed output directory
  build: {
    outDir: "out",
    emptyOutDir: true,
    // Tauri 2 requires specific target
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Don't minify for easier debugging in dev builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // Generate sourcemaps for Sentry
    sourcemap: true,
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
