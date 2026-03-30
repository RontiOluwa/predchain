import { Worker } from "bullmq";
import { prisma } from "../db/client.js";
import { FactoryClient } from "../blockchain/factory.client.js";
import { loggers } from "@predchain/shared";
import {
    enqueueLockMarket,
    enqueueResolveMarket,
} from "./market.jobs.js";
import type {
    DeployContractJobData,
    LockMarketJobData,
} from "./market.jobs.js";

const log = loggers.marketService;

const redisConnection = {
    host: process.env["REDIS_URL"]
        ? new URL(process.env["REDIS_URL"]).hostname
        : "localhost",
    port: process.env["REDIS_URL"]
        ? parseInt(new URL(process.env["REDIS_URL"]).port || "6379")
        : 6379,
};

// ─── Worker 1: Deploy Contract ────────────────────────────────────

/**
 * Processes deploy-contract jobs.
 *
 * Flow:
 * 1. Fetch market from DB
 * 2. Call factory.deployMarket() on Base Sepolia
 * 3. Wait for on-chain confirmation
 * 4. Store the deployed contract address in DB
 * 5. Update market status to OPEN
 * 6. Enqueue a delayed lock-market job at the deadline
 */
export const deployContractWorker = new Worker<DeployContractJobData>(
    "deploy-contract",
    async (job) => {
        const { marketId, deadline } = job.data;
        log.info("Processing deploy-contract job", { jobId: job.id, marketId });

        // ── Fetch market ──────────────────────────────────────────
        const market = await prisma.market.findUnique({
            where: { id: marketId },
        });

        if (!market) {
            throw new Error(`Market ${marketId} not found in DB`);
        }

        if (market.status !== "PENDING") {
            log.warn("Market is not PENDING, skipping deploy", {
                marketId,
                status: market.status,
            });
            return;
        }

        // ── Update job record ─────────────────────────────────────
        await prisma.marketJob.create({
            data: {
                marketId,
                jobType: "deploy-contract",
                bullJobId: job.id ?? null,
                status: "PROCESSING",
            },
        });

        // ── Deploy contract ───────────────────────────────────────
        const factory = new FactoryClient();
        const deadlineDate = new Date(deadline);

        const txHash = await factory.deployMarket(marketId, deadlineDate);

        // Wait for on-chain confirmation
        await factory.waitForTransaction(txHash);

        // Fetch the deployed address from the factory
        const contractAddress = await factory.getDeployedMarketAddress(marketId);

        if (!contractAddress) {
            throw new Error(`Contract address not found after deployment for ${marketId}`);
        }

        // ── Update DB ─────────────────────────────────────────────
        await prisma.market.update({
            where: { id: marketId },
            data: {
                status: "OPEN",
                contractAddress,
                deploymentTxHash: txHash,
            },
        });

        await prisma.marketJob.updateMany({
            where: { marketId, jobType: "deploy-contract" },
            data: { status: "COMPLETED", completedAt: new Date() },
        });

        log.info("Market contract deployed and OPEN", {
            marketId,
            contractAddress,
            txHash,
        });

        // ── Schedule lock job at deadline ─────────────────────────
        await enqueueLockMarket(marketId, deadlineDate);
    },
    {
        connection: redisConnection,
        concurrency: 3, // Process up to 3 deployments simultaneously
    }
);

// ─── Worker 2: Lock Market ────────────────────────────────────────

/**
 * Processes lock-market jobs.
 * Runs at the market's deadline timestamp.
 *
 * Flow:
 * 1. Call lock() on the PredictionMarket contract
 * 2. Update market status to LOCKED in DB
 * 3. Immediately enqueue a resolve-market job
 */
export const lockMarketWorker = new Worker<LockMarketJobData>(
    "lock-market",
    async (job) => {
        const { marketId } = job.data;
        log.info("Processing lock-market job", { jobId: job.id, marketId });

        const market = await prisma.market.findUnique({
            where: { id: marketId },
        });

        if (!market || market.status !== "OPEN") {
            log.warn("Market not OPEN, skipping lock", {
                marketId,
                status: market?.status,
            });
            return;
        }

        if (!market.contractAddress) {
            throw new Error(`Market ${marketId} has no contract address`);
        }

        // Call lock() on-chain
        // Note: lock() is callable by anyone after deadline, so we use
        // a separate minimal viem call here
        const { createWalletClient, createPublicClient, http } = await import("viem");
        const { privateKeyToAccount } = await import("viem/accounts");
        const { baseSepolia } = await import("viem/chains");
        const { parseAbiItem } = await import("viem");

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

        const lockAbi = [parseAbiItem("function lock()")] as const;

        const txHash = await walletClient.writeContract({
            address: market.contractAddress as `0x${string}`,
            abi: lockAbi,
            functionName: "lock",
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        // Update DB status
        await prisma.market.update({
            where: { id: marketId },
            data: { status: "LOCKED" },
        });

        log.info("Market locked on-chain", { marketId, txHash });

        // Immediately trigger resolution
        await enqueueResolveMarket(marketId);
    },
    { connection: redisConnection, concurrency: 5 }
);


// ─── Worker Error Handlers ────────────────────────────────────────

[deployContractWorker, lockMarketWorker].forEach(
    (worker) => {
        worker.on("failed", async (job, err) => {
            log.error(`Worker job failed`, err, {
                jobId: job?.id,
                jobName: job?.name,
                attemptsMade: job?.attemptsMade,
            });

            // Update the MarketJob record on final failure
            if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
                await prisma.marketJob
                    .updateMany({
                        where: { bullJobId: job.id ?? null },
                        data: {
                            status: "FAILED",
                            error: err.message,
                        },
                    })
                    .catch(() => { }); // Don't let DB errors mask the original error
            }
        });

        worker.on("completed", (job) => {
            log.info(`Worker job completed`, { jobId: job.id, jobName: job.name });
        });
    }
);