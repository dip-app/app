import type { NextConfig } from "next";

// Static export: the portal is client-only until the organizer callables exist.
const nextConfig: NextConfig = {
  output: "export",
  // Served under letsdip.work/admin on the shared Hosting site (see scripts/build-site.sh).
  basePath: "/admin",
  images: { unoptimized: true },
  trailingSlash: true,
  devIndicators: false,
};

export default nextConfig;
