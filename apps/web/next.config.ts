import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    async rewrites() {
        return [
            {
                source: "/api/:path*",
                destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/:path*`,
            },
        ];
    },
    webpack: (config) => {
        const emptyModule = path.resolve(process.cwd(), "lib/empty-module.js");
        config.resolve.alias = {
            ...config.resolve.alias,
            "@react-native-async-storage/async-storage": emptyModule,
            "pino-pretty": emptyModule,
            "idb-keyval": emptyModule,
        };
        return config;
    },
};

export default nextConfig;