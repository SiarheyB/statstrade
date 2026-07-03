import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ccxt is a large server-only library that ships CJS/optional deps the
  // bundler cannot resolve (e.g. protobufjs). Keep it external so it is
  // required from node_modules at runtime instead of being bundled.
  // bcrypt — нативный аддон (.node), его тоже нельзя бандлить.
  serverExternalPackages: ["ccxt", "bcrypt"],
};

export default nextConfig;
