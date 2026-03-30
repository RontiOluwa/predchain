import { buildServer } from "./server.js";
import { loggers } from "@predchain/shared";

const log = loggers.apiGateway;

const PORT = parseInt(process.env["API_PORT"] ?? "3001");
const HOST = "0.0.0.0";

async function start() {
    const server = await buildServer();

    try {
        await server.listen({ port: PORT, host: HOST });

        log.info("API Gateway started", {
            port: PORT,
            nodeEnv: process.env["NODE_ENV"],
            endpoints: {
                health: `http://localhost:${PORT}/health`,
                markets: `http://localhost:${PORT}/markets`,
                stakes: `http://localhost:${PORT}/stakes`,
                websocket: `ws://localhost:${PORT}/ws/markets`,
                authNonce: `http://localhost:${PORT}/auth/nonce`,
                authVerify: `http://localhost:${PORT}/auth/verify`,
            },
        });
    } catch (err) {
        log.error("Failed to start API Gateway", err);
        process.exit(1);
    }
}

// ── Graceful shutdown ──────────────────────────────────────────────
process.on("SIGTERM", async () => {
    log.info("SIGTERM received, shutting down");
    const server = await buildServer();
    await server.close();
    process.exit(0);
});

start();