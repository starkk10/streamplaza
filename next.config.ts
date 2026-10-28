import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los comprobantes y QR pesan hasta 5 MB
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  serverExternalPackages: ["@prisma/client", "bcryptjs", "nodemailer"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
