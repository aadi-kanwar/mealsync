import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MealSync screens show live, per-person data from Convex, so we don't use
  // Next.js's page caching (cacheComponents / partialPrefetching).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
