import type { FastifyInstance } from "fastify";
import { MarketService } from "@predchain/market-service";
import { createClient } from "redis";
import { StakeRequestSchema } from "@predchain/shared";
import {
    requireAuth,
    generateNonce,
    verifyWalletSignature,
} from "../middleware/auth.js";
import { loggers } from "@predchain/shared";

const log = loggers.apiGateway;

/**
 * Stake + Auth Routes
 *
 * POST /auth/nonce         → get a sign message for a wallet address
 * POST /auth/verify        → verify signature, receive JWT
 * POST /stakes             → record an on-chain stake (auth required)
 * GET  /stakes/user/:addr  → get all stakes for a wallet
 */
export async function stakeRoutes(fastify: FastifyInstance) {
    const marketService = new MarketService();


    const redis = createClient({ url: process.env["REDIS_URL"] ?? "redis://localhost:6379" });
    redis.connect().catch(console.error);

    const FAUCET_AMOUNT = 10_000n * 10n ** 18n; // 10,000 PRED
    const COOLDOWN_SECONDS = 24 * 60 * 60;       // 24 hours



    // ── POST /auth/nonce ──────────────────────────────────────────
    /**
     * Step 1 of wallet auth.
     * Returns a unique message for the wallet to sign.
     *
     * Body: { address: "0x..." }
     */
    fastify.post<{ Body: { address?: string } }>(
        "/auth/nonce",
        async (request, reply) => {
            const { address } = request.body ?? {};

            if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
                return reply
                    .status(400)
                    .send({ error: "Valid Ethereum address required" });
            }

            const nonce = generateNonce(address);
            return reply.send({ nonce, address });
        }
    );

    // ── POST /auth/verify ─────────────────────────────────────────
    /**
     * Step 2 of wallet auth.
     * Verifies the signature, returns a JWT.
     *
     * Body: { address: "0x...", signature: "0x..." }
     *
     * The JWT payload contains the wallet address.
     * JWT is valid for 24 hours.
     */
    fastify.post<{ Body: { address?: string; signature?: string } }>(
        "/auth/verify",
        async (request, reply) => {
            const { address, signature } = request.body ?? {};

            if (!address || !signature) {
                return reply
                    .status(400)
                    .send({ error: "address and signature are required" });
            }

            try {
                const verifiedAddress = await verifyWalletSignature(address, signature);

                const token = fastify.jwt.sign(
                    { address: verifiedAddress },
                    { expiresIn: "24h" }
                );

                log.info("JWT issued", { address: verifiedAddress });

                return reply.send({ token, address: verifiedAddress });
            } catch (err) {
                log.warn("Auth verification failed", {
                    address,
                    error: err instanceof Error ? err.message : String(err),
                });
                return reply.status(401).send({
                    error: err instanceof Error ? err.message : "Verification failed",
                });
            }
        }
    );

    // ── POST /stakes ──────────────────────────────────────────────
    /**
     * Records a confirmed on-chain stake in the database.
     *
     * This is called by the frontend AFTER the user's wallet transaction
     * has been confirmed on Base Sepolia. We don't process payments —
     * the smart contract holds funds. We just mirror the state for fast reads.
     *
     * Body: { marketId, side, amount, userAddress, txHash }
     */
    fastify.post<{ Body: unknown }>(
        "/stakes",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const validation = StakeRequestSchema.safeParse(request.body);

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
                const stake = await marketService.recordStake(validation.data);

                log.info("Stake recorded via API", {
                    stakeId: stake.id,
                    marketId: stake.marketId,
                    side: stake.side,
                    txHash: stake.txHash,
                });

                return reply.status(201).send({ stake });
            } catch (err) {
                log.error("Failed to record stake", err);
                return reply.status(500).send({
                    error: err instanceof Error ? err.message : "Failed to record stake",
                });
            }
        }
    );

    // ── GET /stakes/user/:address ─────────────────────────────────
    fastify.get<{ Params: { address: string } }>(
        "/stakes/user/:address",
        async (request, reply) => {
            try {
                const stakes = await marketService.getUserStakes(
                    request.params.address
                );
                log.info(`${request.params.address}: user stakes`, { stakes },);
                return reply.send({ stakes });
            } catch (err) {
                log.error("Failed to get user stakes", err);
                return reply.status(500).send({ error: "Failed to fetch stakes" });
            }
        }
    );


    // POST /faucet
    fastify.post<{ Body: { address?: string } }>(
        "/faucet",
        async (request, reply) => {
            const { address } = request.body ?? {};

            if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
                return reply.status(400).send({ error: "Valid Ethereum address required" });
            }

            const normalizedAddress = address.toLowerCase();
            const redisKey = `faucet:${normalizedAddress}`;

            // ── Check cooldown ────────────────────────────────────────
            const lastClaim = await redis.get(redisKey);

            if (lastClaim) {
                const claimedAt = parseInt(lastClaim);
                const elapsedSeconds = Math.floor(Date.now() / 1000) - claimedAt;
                const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;
                const remainingHours = Math.ceil(remainingSeconds / 3600);

                return reply.status(429).send({
                    error: `Cooldown active. Try again in ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}.`,
                    remainingSeconds,
                });
            }

            // ── Mint tokens via deployer wallet ───────────────────────
            try {
                const { createWalletClient, createPublicClient, http, parseAbi } =
                    await import("viem");
                const { privateKeyToAccount } = await import("viem/accounts");
                const { baseSepolia } = await import("viem/chains");

                const account = privateKeyToAccount(
                    process.env["DEPLOYER_PRIVATE_KEY"] as `0x${string}`
                );

                const walletClient = createWalletClient({
                    chain: baseSepolia,
                    transport: http(process.env["RPC_URL"]),
                    account,
                });

                const publicClient = createPublicClient({
                    chain: baseSepolia,
                    transport: http(process.env["RPC_URL"]),
                });

                const txHash = await walletClient.writeContract({
                    address: process.env["PRED_TOKEN_ADDRESS"] as `0x${string}`,
                    abi: parseAbi(["function mint(address to, uint256 amount)"]),
                    functionName: "mint",
                    args: [address as `0x${string}`, FAUCET_AMOUNT],
                    gas: 100_000n,
                });

                await publicClient.waitForTransactionReceipt({ hash: txHash });

                // ── Store claim timestamp in Redis with 24hr TTL ──────────
                await redis.setEx(
                    redisKey,
                    COOLDOWN_SECONDS,
                    Math.floor(Date.now() / 1000).toString()
                );

                log.info("Faucet tokens minted", { address, txHash });

                return reply.send({
                    success: true,
                    txHash,
                    amount: "10000",
                    address,
                });
            } catch (err) {
                log.error("Faucet mint failed", err);
                return reply.status(500).send({
                    error: err instanceof Error ? err.message : "Faucet failed",
                });
            }
        }
    );
}