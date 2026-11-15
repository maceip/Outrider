import type {NextConfig} from "next";

const isWww = process.env.NEXT_PUBLIC_WWW === "1";

const nextConfig: NextConfig = {
  basePath: isWww ? "/__PAGES_BASE__" : "/__proxyfor__",
  devIndicators: {
    position: "bottom-right",
  },
  distDir: isWww ? "out-www" : "out",
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
