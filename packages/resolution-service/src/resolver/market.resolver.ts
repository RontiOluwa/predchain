import {
    createWalletClient,
    createPublicClient,
    http,
    parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import { ResolutionAgent } from "@predchain/ai-agent";
import { loggers } from "@predchain/shared";
import type { Market as PrismaMarket } from "@prisma/client";
import { ChainlinkAdapter } from "../oracle/chainlink.adapter.js";
import { WebSearchAdapter } from "../oracle/websearch.adapter.js";

const log = loggers.resolutionService;

/**
 * PredictionMarket contract ABI — only the resolve() function.
 */
const MARKET_ABI = [
    parseAbiItem(
        "function resolve(uint8 _outcome)"
    ),
    parseAbiItem(
        "function status() view returns (uint8)"
    ),
] as const;

/**
 * Maps our string outcome to the Solidity enum index.
 * Solidity: enum Outcome { NONE, YES, NO, VOID }
 */
const OUTCOME_TO_UINT: Record<string, number> = {
    YES: 1,
    NO: 2,
    VOID: 3,
};

/**
 * MarketResolver orchestrates the full resolution pipeline:
 *
 * 1. Fetch oracle data (Chainlink or web search)
 * 2. Pass to ResolutionAgent (AI evaluates outcome)
 * 3. Call resolve() on the PredictionMarket contract
 * 4. Write ResolutionEvidence to DB
 * 5. Update market status to RESOLVED
 *
 * This is the core of Step 5 — the full autonomous resolution loop.
 */
export class MarketResolver {
    private prisma: PrismaClient;
    private resolutionAgent: ResolutionAgent;
    private chainlinkAdapter: ChainlinkAdapter;
    private webSearchAdapter: WebSearchAdapter;
    private walletClient;
    private publicClient;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.resolutionAgent = new ResolutionAgent();
        this.chainlinkAdapter = new ChainlinkAdapter();
        this.webSearchAdapter = new WebSearchAdapter();

        const privateKey = process.env["DEPLOYER_PRIVATE_KEY"];
        const rpcUrl = process.env["RPC_URL"];
        if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
        if (!rpcUrl) throw new Error("RPC_URL is not set");

        const account = privateKeyToAccount(privateKey as `0x${string}`);

        this.walletClient = createWalletClient({
            chain: baseSepolia,
            transport: http(rpcUrl),
            account,
        });

        this.publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(rpcUrl),
        });
    }

    /**
     * Resolves a single market end-to-end.
     *
     * @param marketId  The UUID of the LOCKED market to resolve
     */
    async resolve(marketId: string): Promise<void> {
        log.info("Starting market resolution", { marketId });

        // ── Step 1: Fetch market from DB ──────────────────────────
        const market = await this.prisma.market.findUnique({
            where: { id: marketId },
        });

        if (!market) {
            throw new Error(`Market ${marketId} not found`);
        }

        if (market.status !== "LOCKED") {
            log.warn("Market is not LOCKED, skipping resolution", {
                marketId,
                status: market.status,
            });
            return;
        }

        if (!market.contractAddress) {
            throw new Error(`Market ${marketId} has no contract address`);
        }

        // ── Step 2: Fetch oracle data ─────────────────────────────
        let oracleValue: string;
        let oracleFetchedAt: Date;

        try {
            const oracleData = await this.fetchOracleData(market);
            oracleValue = oracleData.value;
            oracleFetchedAt = oracleData.fetchedAt;
        } catch (err) {
            log.error("Oracle fetch failed — resolving as VOID", err, { marketId });
            /**
             * If the oracle fails, we resolve VOID so all stakers get refunds.
             * We never leave a market stuck in LOCKED with no resolution path.
             */
            await this.settleOnChain(market, "VOID", "Oracle data unavailable", "N/A", new Date());
            return;
        }

        // ── Step 3: AI evaluates the outcome ─────────────────────
        /**
         * Build a Market object that matches what ResolutionAgent expects.
         * The agent needs the condition, question, and deadline.
         */
        const marketForAgent = this.toAgentMarket(market);

        const resolutionResult = await this.resolutionAgent.evaluate(
            marketForAgent,
            oracleValue,
            oracleFetchedAt.toISOString()
        );

        if (!resolutionResult.success) {
            log.error("Resolution agent failed", undefined, {
                marketId,
                error: resolutionResult.error,
            });
            await this.settleOnChain(market, "VOID", resolutionResult.error, oracleValue, oracleFetchedAt);
            return;
        }

        const { evidence } = resolutionResult;

        // ── Step 4: Settle on-chain ───────────────────────────────
        await this.settleOnChain(
            market,
            evidence.outcome,
            evidence.reasoning,
            oracleValue,
            oracleFetchedAt
        );
    }

    /**
     * Fetches oracle data based on the market's resolutionSource.
     */
    private async fetchOracleData(
        market: PrismaMarket
    ): Promise<{ value: string; fetchedAt: Date }> {
        switch (market.resolutionSource) {
            case "CHAINLINK_PRICE": {
                const result = await this.chainlinkAdapter.fetchPrice(
                    market.resolutionKey
                );
                return { value: result.value, fetchedAt: result.fetchedAt };
            }

            case "AI_WEB_SEARCH": {
                const result = await this.webSearchAdapter.search(
                    market.resolutionKey,
                    market.deadline
                );
                /**
                 * For web search, the "value" is the full factual finding.
                 * If nothing was found, we pass that to the agent which
                 * will likely resolve VOID.
                 */
                return {
                    value: result.found ? result.value : "Event outcome not found",
                    fetchedAt: result.fetchedAt,
                };
            }

            case "MANUAL": {
                /**
                 * MANUAL markets cannot be auto-resolved.
                 * The resolution service skips these — they require
                 * a human to call resolve() directly via the admin UI.
                 */
                throw new Error(
                    `Market ${market.id} requires MANUAL resolution — skipping auto-resolve`
                );
            }

            default: {
                throw new Error(
                    `Unknown resolutionSource: ${market.resolutionSource}`
                );
            }
        }
    }

    /**
     * Calls resolve() on the PredictionMarket contract and writes
     * the evidence to the DB.
     */
    private async settleOnChain(
        market: PrismaMarket,
        outcome: string,
        reasoning: string,
        oracleValue: string,
        oracleFetchedAt: Date
    ): Promise<void> {
        const outcomeUint = OUTCOME_TO_UINT[outcome] ?? 3; // Default VOID

        log.info("Calling resolve() on-chain", {
            marketId: market.id,
            contractAddress: market.contractAddress,
            outcome,
            outcomeUint,
        });

        // ── Call resolve() on the contract ────────────────────────
        const txHash = await this.walletClient.writeContract({
            address: market.contractAddress as `0x${string}`,
            abi: MARKET_ABI,
            functionName: "resolve",
            args: [outcomeUint],
        });

        // Wait for confirmation
        const receipt = await this.publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
        });

        log.info("resolve() confirmed on-chain", {
            marketId: market.id,
            txHash,
            blockNumber: receipt.blockNumber.toString(),
        });

        // ── Write evidence to DB ──────────────────────────────────
        await this.prisma.$transaction([
            // Create resolution evidence record
            this.prisma.resolutionEvidence.create({
                data: {
                    marketId: market.id,
                    outcome: outcome as "YES" | "NO" | "VOID",
                    oracleValue,
                    reasoning,
                    fetchedAt: oracleFetchedAt,
                    settlementTxHash: txHash,
                    settlementBlock: Number(receipt.blockNumber),
                },
            }),
            // Update market status
            this.prisma.market.update({
                where: { id: market.id },
                data: {
                    status: "RESOLVED",
                    outcome: outcome as "YES" | "NO" | "VOID",
                    resolvedAt: new Date(),
                },
            }),
        ]);

        log.info("Market fully resolved", {
            marketId: market.id,
            outcome,
            txHash,
        });
    }

    /**
     * Converts a Prisma Market record into the shape ResolutionAgent expects.
     * Bridges the DB model and the shared Market type.
     */
    private toAgentMarket(market: PrismaMarket) {
        return {
            id: market.id,
            question: market.question,
            description: market.description,
            subject: market.subject,
            condition: {
                operator: market.conditionOperator as
                    | "gt" | "gte" | "lt" | "lte" | "eq" | "neq",
                threshold: market.conditionThreshold,
                unit: market.conditionUnit,
            },
            deadline: market.deadline.toISOString(),
            resolutionSource: market.resolutionSource as
                | "CHAINLINK_PRICE" | "CHAINLINK_EVENT" | "AI_WEB_SEARCH" | "MANUAL",
            resolutionKey: market.resolutionKey,
            confidence: market.confidence,
            parserNotes: market.parserNotes ?? undefined,
            status: market.status as "LOCKED",
            outcome: undefined,
            contractAddress: market.contractAddress ?? undefined,
            deploymentTxHash: market.deploymentTxHash ?? undefined,
            yesPool: market.yesPool,
            noPool: market.noPool,
            creatorAddress: market.creatorAddress,
            createdAt: market.createdAt,
            updatedAt: market.updatedAt,
            resolvedAt: market.resolvedAt ?? undefined,
        };
    }
}