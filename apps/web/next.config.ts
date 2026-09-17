import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Workspace package shipped as TypeScript source.
  transpilePackages: ["@wwh/schema"],
};

export default nextConfig;
