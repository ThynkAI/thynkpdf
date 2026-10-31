import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Desktop app: `THYNKPDF_STATIC_EXPORT=1 next build` writes a static site to out/ (served by the bundled backend).
  ...(process.env.THYNKPDF_STATIC_EXPORT ? { output: "export", images: { unoptimized: true }, trailingSlash: true, env: { NEXT_PUBLIC_API_URL: "" } } : {}),
  transpilePackages: ["@thynkpdf/ui", "@thynkpdf/pdf-viewer", "@thynkpdf/editor-client"],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.resolve.alias["@"] = path.join(here, "src");
    return config;
  },
};
