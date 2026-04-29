import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: 'export',
  outputFileTracingRoot: path.join(__dirname, "../../"),
  turbopack: {
    root: __dirname,
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
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: "trixty",
  project: "trixty-ide",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Automatically annotate React components to show their full name in breadcrumbs and session replay
  reactComponentAnnotation: {
    enabled: true,
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your Sentry bill.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
