import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { loggers } from "@predchain/shared";

const log = loggers.apiGateway;

/**
 * WebSocket handler for real-time market updates.
 *
 * Clients connect to ws://localhost:3001/ws/markets
 * and receive live updates whenever market state changes.
 *
 * Message types sent to clients:
 *
 *   { type: "market:update", data: Market }
 *     → When a market status changes (PENDING→OPEN, OPEN→LOCKED, etc.)
 *
 *   { type: "market:pool", data: { marketId, yesPool, noPool, probability } }
 *     → When a stake is recorded (pool totals update)
 *
 *   { type: "market:resolved", data: { marketId, outcome, evidence } }
 *     → When a market is resolved
 *
 *   { type: "ping" }
 *     → Keepalive sent every 30s
 *
 * Clients can subscribe to specific markets:
 *   { type: "subscribe", marketId: "uuid" }
 *   { type: "unsubscribe", marketId: "uuid" }
 *
 * Or subscribe to all markets:
 *   { type: "subscribe:all" }
 */

interface ConnectedClient {
    socket: any;
    subscribedMarkets: Set<string>;
    subscribeAll: boolean;
}

// Connected clients registry
const clients = new Set<ConnectedClient>();

/**
 * Broadcasts a message to all clients subscribed to a specific market
 * or to clients subscribed to all markets.
 */
export function broadcastMarketUpdate(marketId: string, payload: object) {
    const message = JSON.stringify(payload);

    for (const client of clients) {
        try {
            if (
                client.subscribeAll ||
                client.subscribedMarkets.has(marketId)
            ) {
                client.socket.send(message);
            }
        } catch {
            // Client disconnected — will be cleaned up on close event
        }
    }
}

/**
 * Registers the WebSocket route on the Fastify instance.
 *
 * Polling interval: every 5 seconds we check for market status
 * changes and push updates to subscribed clients.
 *
 * In production, replace polling with a Prisma event or
 * a Redis pub/sub channel that services publish to when they
 * update markets. Polling is fine for development.
 */
export async function marketSocketHandler(fastify: FastifyInstance) {
    const prisma = new PrismaClient();

    fastify.get(
        "/ws/markets",
        { websocket: true },
        (socket, _request) => {
            const client: ConnectedClient = {
                socket,
                subscribedMarkets: new Set(),
                subscribeAll: false,
            };

            clients.add(client);
            log.info("WebSocket client connected", {
                totalClients: clients.size,
            });

            // Send welcome message
            socket.send(
                JSON.stringify({
                    type: "connected",
                    message: "Connected to Predchain market feed",
                    timestamp: new Date().toISOString(),
                })
            );

            // ── Handle incoming messages ────────────────────────────
            socket.on("message", (rawMessage: Buffer) => {
                try {
                    const msg = JSON.parse(rawMessage.toString()) as {
                        type: string;
                        marketId?: string;
                    };

                    switch (msg.type) {
                        case "subscribe":
                            if (msg.marketId) {
                                client.subscribedMarkets.add(msg.marketId);
                                socket.send(
                                    JSON.stringify({
                                        type: "subscribed",
                                        marketId: msg.marketId,
                                    })
                                );
                            }
                            break;

                        case "unsubscribe":
                            if (msg.marketId) {
                                client.subscribedMarkets.delete(msg.marketId);
                            }
                            break;

                        case "subscribe:all":
                            client.subscribeAll = true;
                            socket.send(
                                JSON.stringify({ type: "subscribed:all" })
                            );
                            break;

                        case "pong":
                            // Client responded to keepalive — connection is healthy
                            break;

                        default:
                            socket.send(
                                JSON.stringify({ type: "error", message: "Unknown message type" })
                            );
                    }
                } catch {
                    socket.send(
                        JSON.stringify({ type: "error", message: "Invalid JSON message" })
                    );
                }
            });

            // ── Handle disconnect ───────────────────────────────────
            socket.on("close", () => {
                clients.delete(client);
                log.info("WebSocket client disconnected", {
                    totalClients: clients.size,
                });
            });
        }
    );

    // ── Keepalive ping every 30 seconds ──────────────────────────
    setInterval(() => {
        const ping = JSON.stringify({ type: "ping" });
        for (const client of clients) {
            try {
                client.socket.send(ping);
            } catch {
                clients.delete(client);
            }
        }
    }, 30_000);

    // ── Poll for market updates every 5 seconds ───────────────────
    /**
     * Tracks the last time we saw each market's status so we
     * only broadcast when something actually changed.
     */
    const lastSeenStatus = new Map<string, string>();
    const lastSeenPools = new Map<string, string>();

    setInterval(async () => {
        if (clients.size === 0) return; // No clients — skip DB query

        try {
            const markets = await prisma.market.findMany({
                where: {
                    status: { in: ["OPEN", "LOCKED", "RESOLVED"] },
                },
                select: {
                    id: true,
                    status: true,
                    outcome: true,
                    yesPool: true,
                    noPool: true,
                    question: true,
                },
            });

            for (const market of markets) {
                // ── Status change broadcast ───────────────────────────
                const prevStatus = lastSeenStatus.get(market.id);
                if (prevStatus !== market.status) {
                    lastSeenStatus.set(market.id, market.status);

                    if (prevStatus !== undefined) {
                        broadcastMarketUpdate(market.id, {
                            type: "market:update",
                            data: market,
                        });
                    }
                }

                // ── Pool change broadcast ─────────────────────────────
                const poolKey = `${market.yesPool}:${market.noPool}`;
                const prevPools = lastSeenPools.get(market.id);
                if (prevPools !== poolKey) {
                    lastSeenPools.set(market.id, poolKey);

                    if (prevPools !== undefined) {
                        const total =
                            BigInt(market.yesPool) + BigInt(market.noPool);
                        const probability =
                            total === 0n
                                ? 5000
                                : Number((BigInt(market.yesPool) * 10000n) / total);

                        broadcastMarketUpdate(market.id, {
                            type: "market:pool",
                            data: {
                                marketId: market.id,
                                yesPool: market.yesPool,
                                noPool: market.noPool,
                                probability,
                            },
                        });
                    }
                }
            }
        } catch (err) {
            log.error("WebSocket poll failed", err);
        }
    }, 5_000);
}