import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@tauri-apps/api",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-http",
      "@tauri-apps/plugin-positioner",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-shell",
      "@tauri-apps/plugin-store",
      "@tauri-apps/plugin-updater",
      "react-resizable-panels",
      "react-virtuoso",
      "@monaco-editor/react",
      "clsx",
      "monaco-editor",
      "picomatch",
      "react-markdown",
      "remark-gfm",
      "tailwind-merge"
    ],
    // Mejora el rendimiento de compilación en Windows
    webpackBuildWorker: true,
    parallelServerCompiles: true,
  },
  // Configuración simplificada de indicadores para evitar errores de tipos
  devIndicators: {
    position: 'bottom-right',
  },
};

export default nextConfig;
