import { prisma } from "../db/client.js";
import { IntentParser } from "@predchain/ai-agent";
import { loggers } from "@predchain/shared";
import type { Market as PrismaMarket, Stake as PrismaStake } from "@prisma/client";
import { enqueueDeployContract } from "../jobs/market.jobs.js";
import type { CreateMarketRequest, StakeRequest } from "@predchain/shared";

const log = loggers.marketService;

/**
 * MarketService owns all business logic for markets.
 *
 * Responsibilities:
 * - Parse raw user input via the AI agent
 * - Write market records to PostgreSQL
 * - Enqueue BullMQ jobs for contract deployment
 * - Handle stake record writes (after on-chain confirmation)
 * - Provide query methods for the API gateway
 *
 * It does NOT talk to the blockchain directly —
 * that's the FactoryClient's job, called from workers.
 */
export class MarketService {
    private parser: IntentParser;

    constructor() {
        this.parser = new IntentParser();
    }

    // ─── Market Creation ─────────────────────────────────────────

    /**
     * Full market creation flow:
     * 1. Parse the raw input with the AI intent parser
     * 2. Validate confidence threshold
     * 3. Write a PENDING market record to the DB
     * 4. Enqueue a deploy-contract job
     * 5. Return the created market
     *
     * The market stays PENDING until the BullMQ worker
     * successfully deploys the contract and updates the record to OPEN.
     */
    async createMarket(request: CreateMarketRequest): Promise<PrismaMarket> {
        log.info("Creating market", { rawInput: request.rawInput });

        // ── Step 1: Parse intent ──────────────────────────────────
        const parseResult = await this.parser.parse(request.rawInput);

        if (!parseResult.success) {
            throw new Error(`Intent parsing failed: ${parseResult.error}`);
        }

        const schema = parseResult.data;

        // ── Step 2: Confidence gate ───────────────────────────────
        /**
         * Markets with confidence < 0.4 are routed to MANUAL resolution.
         * We still create them, but flag them so the resolution service
         * knows not to auto-settle.
         */
        if (schema.confidence < 0.4) {
            log.warn("Low confidence market — will require manual resolution", {
                confidence: schema.confidence,
                question: schema.question,
            });
        }

        // ── Step 3: Write to DB ───────────────────────────────────
        const market = await prisma.market.create({
            data: {
                question: schema.question,
                description: schema.description,
                subject: schema.subject,
                conditionOperator: schema.condition.operator,
                conditionThreshold: schema.condition.threshold,
                conditionUnit: schema.condition.unit,
                deadline: new Date(schema.deadline),
                resolutionSource: schema.resolutionSource,
                resolutionKey: schema.resolutionKey,
                confidence: schema.confidence,
                parserNotes: schema.parserNotes ?? null,
                creatorAddress: request.creatorAddress,
                status: "PENDING",
            },
        });

        log.info("Market record created", {
            marketId: market.id,
            question: market.question,
            deadline: market.deadline,
        });

        // ── Step 4: Enqueue contract deployment ───────────────────
        /**
         * We enqueue the job AFTER the DB write succeeds.
         * If the job was enqueued first and the DB write failed,
         * the worker would try to deploy a contract for a market that doesn't exist.
         * DB first, queue second — always.
         */
        await enqueueDeployContract(market.id, market.deadline);

        log.info("Deploy contract job enqueued", { marketId: market.id });

        return market;
    }

    // ─── Stake Recording ────────────────────────────────────────

    /**
     * Records a stake after it has been confirmed on-chain.
     *
     * The frontend sends this after the user's wallet transaction
     * is confirmed. We don't process payments here — the contract
     * holds the funds. We just mirror the on-chain state in our DB
     * for fast queries and UI display.
     */
    async recordStake(request: StakeRequest): Promise<PrismaStake> {
        log.info("Recording stake", {
            marketId: request.marketId,
            side: request.side,
            amount: request.amount,
            txHash: request.txHash,
        });

        // Check the market exists and is OPEN
        const market = await prisma.market.findUnique({
            where: { id: request.marketId },
        });

        if (!market) {
            throw new Error(`Market ${request.marketId} not found`);
        }

        if (market.status !== "OPEN") {
            throw new Error(
                `Market ${request.marketId} is not open for staking (status: ${market.status})`
            );
        }

        // Prevent duplicate tx hash (idempotency)
        const existing = await prisma.stake.findUnique({
            where: { txHash: request.txHash },
        });

        if (existing) {
            log.warn("Duplicate stake tx, returning existing record", {
                txHash: request.txHash,
            });
            return existing;
        }

        // Write stake and update pool totals in a transaction
        const [stake] = await prisma.$transaction([
            prisma.stake.create({
                data: {
                    marketId: request.marketId,
                    userAddress: request.userAddress,
                    side: request.side,
                    amount: request.amount,
                    txHash: request.txHash,
                },
            }),
            // Update the cached pool total
            prisma.market.update({
                where: { id: request.marketId },
                data:
                    request.side === "YES"
                        ? { yesPool: { set: addBigIntStrings(market.yesPool, request.amount) } }
                        : { noPool: { set: addBigIntStrings(market.noPool, request.amount) } },
            }),
        ]);

        log.info("Stake recorded", {
            stakeId: stake.id,
            marketId: stake.marketId,
            side: stake.side,
        });

        return stake;
    }

    // ─── Queries ─────────────────────────────────────────────────

    async getMarketById(id: string): Promise<PrismaMarket | null> {
        return prisma.market.findUnique({
            where: { id },
            include: { resolutionEvidence: true },
        });
    }

    async listMarkets(params: {
        status?: PrismaMarket["status"];
        limit?: number;
        offset?: number;
    }): Promise<{ markets: PrismaMarket[]; total: number }> {
        const { status, limit = 20, offset = 0 } = params;
        const where = status ? { status } : {};

        const [markets, total] = await prisma.$transaction([
            prisma.market.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: limit,
                skip: offset,
            }),
            prisma.market.count({ where }),
        ]);

        return { markets, total };
    }

    async getMarketsByCreator(
        creatorAddress: string
    ): Promise<PrismaMarket[]> {
        return prisma.market.findMany({
            where: { creatorAddress: creatorAddress.toLowerCase() },
            orderBy: { createdAt: "desc" },
        });
    }

    async getUserStakes(userAddress: string): Promise<PrismaStake[]> {
        return prisma.stake.findMany({
            where: { userAddress: userAddress.toLowerCase() },
            include: { market: true },
            orderBy: { createdAt: "desc" },
        });
    }
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Adds two BigInt strings safely.
 * Used for updating pool totals without floating point errors.
 */
function addBigIntStrings(a: string, b: string): string {
    return (BigInt(a) + BigInt(b)).toString();
}