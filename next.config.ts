import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` here on purpose. Nixpacks keeps node_modules in
  // the image and Railway starts the app with `next start`, which refuses to
  // serve a standalone build ("next start does not work with output:
  // standalone"). Standalone would also need public/ and .next/static copied
  // into the bundle by hand. Plain output is the one that actually boots.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
