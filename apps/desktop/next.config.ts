import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "react-icons", "@tauri-apps/plugin-shell"],
  },
};

export default nextConfig;
