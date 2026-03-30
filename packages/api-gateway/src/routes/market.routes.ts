import type { FastifyInstance } from "fastify";
// import { MarketService } from "@predchain/market-service";
import { CreateMarketRequestSchema } from "@predchain/shared";
import { requireAuth } from "../middleware/auth.js";
import { loggers } from "@predchain/shared";

const log = loggers.apiGateway;

/**
 * Market Routes
 *
 * GET  /markets          → list markets (paginated, filterable by status)
 * GET  /markets/:id      → get single market with resolution evidence
 * POST /markets          → create a new market (auth required)
 * GET  /markets/user/:address → all markets created by a wallet
 */
export async function marketRoutes(fastify: FastifyInstance) {
    // const marketService = new MarketService();
    const MARKET_SERVICE_URL = process.env["MARKET_SERVICE_URL"] ?? "http://localhost:3002";

    // ── GET /markets ──────────────────────────────────────────────
    fastify.get<{
        Querystring: {
            status?: string;
            limit?: string;
            offset?: string;
        };
    }>("/markets", async (request, reply) => {
        try {
            const { status, limit, offset } = request.query;

            const result = await marketService.listMarkets({
                status: status as any,
                limit: limit ? parseInt(limit) : 20,
                offset: offset ? parseInt(offset) : 0,
            });

            return reply.send({
                markets: result.markets,
                total: result.total,
                limit: limit ? parseInt(limit) : 20,
                offset: offset ? parseInt(offset) : 0,
            });
        } catch (err) {
            log.error("Failed to list markets", err);
            return reply.status(500).send({ error: "Failed to fetch markets" });
        }
    });

    // ── GET /markets/:id ──────────────────────────────────────────
    fastify.get<{ Params: { id: string } }>(
        "/markets/:id",
        async (request, reply) => {
            try {
                const market = await marketService.getMarketById(request.params.id);

                if (!market) {
                    return reply.status(404).send({ error: "Market not found" });
                }

                return reply.send({ market });
            } catch (err) {
                log.error("Failed to get market", err);
                return reply.status(500).send({ error: "Failed to fetch market" });
            }
        }
    );

    // ── POST /markets ─────────────────────────────────────────────
    /**
     * Creates a new prediction market.
     * Auth required — we need the wallet address as the creatorAddress.
     *
     * Body: { rawInput: string, creatorAddress: string }
     *
     * Flow:
     * 1. Validate request body with Zod
     * 2. MarketService parses with AI + writes to DB
     * 3. BullMQ job enqueued for contract deployment
     * 4. Returns the PENDING market immediately
     *    (contract deploys asynchronously in the background)
     */
    fastify.post<{ Body: unknown }>(
        "/markets",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const validation = CreateMarketRequestSchema.safeParse(request.body);

            if (!validation.success) {
                return reply.status(400).send({
                    error: "Invalid request",
                    details: validation.error.issues.map((i) => ({
                        field: i.path.join("."),
                        message: i.message,
                    })),
                });
            }

            try {
                const market = await marketService.createMarket(validation.data);

                log.info("Market created via API", {
                    marketId: market.id,
                    creatorAddress: market.creatorAddress,
                });

                /**
                 * Return 202 Accepted instead of 201 Created.
                 * The market record exists but the contract is still deploying.
                 * The client should poll GET /markets/:id or use WebSocket
                 * to know when status changes from PENDING to OPEN.
                 */
                return reply.status(202).send({
                    market,
                    message: "Market created. Contract deployment in progress.",
                });
            } catch (err) {
                log.error("Failed to create market", err);
                return reply.status(500).send({
                    error: err instanceof Error ? err.message : "Failed to create market",
                });
            }
        }
    );

    // ── GET /markets/user/:address ────────────────────────────────
    fastify.get<{ Params: { address: string } }>(
        "/markets/user/:address",
        async (request, reply) => {
            try {
                const markets = await marketService.getMarketsByCreator(
                    request.params.address
                );
                return reply.send({ markets });
            } catch (err) {
                log.error("Failed to get user markets", err);
                return reply.status(500).send({ error: "Failed to fetch markets" });
            }
        }
    );
}