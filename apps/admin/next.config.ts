import type { NextConfig } from "next";

// Static export: the portal is client-only until the organizer callables exist.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
