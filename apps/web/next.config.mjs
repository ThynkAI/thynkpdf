import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ["@thynkpdf/ui", "@thynkpdf/pdf-viewer", "@thynkpdf/editor-client"],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.resolve.alias["@"] = path.join(here, "src");
    return config;
  },
};
