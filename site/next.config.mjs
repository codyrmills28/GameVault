/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: "/GameVault",
  assetPrefix: "/GameVault",
  images: { unoptimized: true },
};

export default nextConfig;
