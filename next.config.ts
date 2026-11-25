import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // إخفاء شارة المطوّر (شعار Next.js) في زاوية الصفحة أثناء التطوير
  devIndicators: false,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
