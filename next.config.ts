import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ccxt is a large server-only library that ships CJS/optional deps the
  // bundler cannot resolve (e.g. protobufjs). Keep it external so it is
  // required from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["ccxt"],
};

export default nextConfig;
