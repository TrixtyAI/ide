import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: 'export',
  outputFileTracingRoot: path.join(__dirname, "../../"),
  turbopack: {
    root: path.join(__dirname, "../../"),
  },
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
      "tailwind-merge",
      "@sentry/nextjs",
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/sdk-trace-web",
      "@opentelemetry/instrumentation-xml-http-request",
      "@opentelemetry/instrumentation-fetch"
    ],
  },
  // Configuración simplificada de indicadores para evitar errores de tipos
  devIndicators: {
    position: 'bottom-right',
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "unsetsoft",
  project: "trixty-ide",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  webpack: {
    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
