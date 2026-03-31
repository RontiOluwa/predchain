import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import jwt from "@fastify/jwt";
import { loggers } from "@predchain/shared";
import { marketRoutes } from "./routes/market.routes.js";
import { stakeRoutes } from "./routes/stake.routes.js";
import { marketSocketHandler } from "./ws/market.socket.js";

const log = loggers.apiGateway;

/**
 * Builds and configures the Fastify server.
 *
 * We export a factory function instead of a singleton so tests
 * can create a fresh server instance without port conflicts.
 */
export async function buildServer() {
    const server = Fastify({
        logger: false, // We use our own structured logger
    });

    // ── Plugins ───────────────────────────────────────────────────

    /**
     * CORS — allow requests from the Next.js frontend.
     * In production, replace origin with your actual domain.
     */
    await server.register(cors, {
        origin:
            process.env["NODE_ENV"] === "production"
                ? ["https://predchain-web.vercel.app/"]
                : true, // Allow all origins in development
        credentials: true,
    });

    /**
     * WebSocket support.
     * Enables ws:// connections on the same port as HTTP.
     */
    await server.register(websocket);

    /**
     * JWT plugin.
     * Signs and verifies tokens using the JWT_SECRET from .env.
     * request.jwtVerify() is called in the requireAuth middleware.
     */
    const jwtSecret = process.env["JWT_SECRET"];
    if (!jwtSecret) throw new Error("JWT_SECRET is not set");

    await server.register(jwt, {
        secret: jwtSecret,
    });

    // ── Health check ──────────────────────────────────────────────
    server.get("/health", async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "api-gateway",
    }));

    // ── Routes ────────────────────────────────────────────────────
    await server.register(marketRoutes);
    await server.register(stakeRoutes);
    await server.register(marketSocketHandler);

    // ── Global error handler ──────────────────────────────────────
    server.setErrorHandler((error, request, reply) => {
        log.error("Unhandled server error", error, {
            url: request.url,
            method: request.method,
        });

        reply.status(500).send({
            error: "Internal server error",
            message:
                process.env["NODE_ENV"] === "development"
                    ? error.message
                    : "Something went wrong",
        });
    });

    // ── 404 handler ───────────────────────────────────────────────
    server.setNotFoundHandler((request, reply) => {
        reply.status(404).send({
            error: "Not found",
            path: request.url,
        });
    });

    return server;
}