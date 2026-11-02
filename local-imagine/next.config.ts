import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside another repository; pin the workspace root so Next/Turbopack
  // does not pick up the parent project's lockfile, middleware or sources.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  // ws is a plain Node package; keep it external so Turbopack does not try to bundle it.
  serverExternalPackages: ["ws"],
  // `next start` gzips responses by default, which can buffer our Server-Sent Events.
  compress: false,
  // Images are served from our own /api/files route; no optimizer needed for a local app.
  images: { unoptimized: true },
};

export default nextConfig;
