import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    // Pin the standalone file-tracing root to this project. Without it, when the
    // repo lives on a different drive than the OS/home (e.g. GitHub's Windows
    // runners: repo on D:, home on C:), Next's tracing walks up to C:\Users\…
    // and scandirs the deny-ACL "Application Data" junction, failing the build
    // with EPERM. Pinning also keeps standalone/server.js at the root, which
    // electron/main.js depends on.
    outputFileTracingRoot: projectRoot,
  },
};

export default nextConfig;
