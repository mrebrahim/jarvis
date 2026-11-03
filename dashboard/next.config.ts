import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // for Coolify / Docker
  poweredByHeader: false,
};

export default nextConfig;
