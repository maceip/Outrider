import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  basePath: "/__proxyfor__",
  devIndicators: {
    position: "bottom-right",
  },
  images: {
    unoptimized: true,
  },
  output: "export",
  trailingSlash: true,
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
