import { Queue } from "bullmq";
import { loggers } from "@predchain/shared";

const log = loggers.marketService;

/**
 * Redis connection config for BullMQ.
 * All queues share the same Redis instance.
 */
const redisConnection = {
    host: process.env["REDIS_URL"]
        ? new URL(process.env["REDIS_URL"]).hostname
        : "localhost",
    port: process.env["REDIS_URL"]
        ? parseInt(new URL(process.env["REDIS_URL"]).port || "6379")
        : 6379,
};

// ─── Queue Definitions ────────────────────────────────────────────

/**
 * Three queues, each with a specific job type.
 *
 * deploy-contract  → called after market is created in DB
 * lock-market      → called at market deadline (delayed job)
 * resolve-market   → called after lock, triggers oracle + AI resolution
 */
export const deployContractQueue = new Queue("deploy-contract", {
    connection: redisConnection,
    defaultJobOptions: {
        /**
         * Retry up to 3 times with exponential backoff.
         * RPC calls to Base Sepolia can occasionally time out —
         * retries handle transient failures automatically.
         */
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000, // 5s, 10s, 20s
        },
        removeOnComplete: 100, // Keep last 100 completed jobs for debugging
        removeOnFail: 200,
    },
});

export const lockMarketQueue = new Queue("lock-market", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 200,
    },
});

export const resolveMarketQueue = new Queue("resolve-market", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
    },
});

// ─── Job Payload Types ────────────────────────────────────────────

export interface DeployContractJobData {
    marketId: string;
    deadline: string; // ISO string — Dates aren't serializable in JSON
}

export interface LockMarketJobData {
    marketId: string;
}

export interface ResolveMarketJobData {
    marketId: string;
}

// ─── Enqueue Helpers ──────────────────────────────────────────────

/**
 * Enqueues a contract deployment job immediately.
 * Called right after a market is written to the DB.
 */
export async function enqueueDeployContract(
    marketId: string,
    deadline: Date
): Promise<void> {
    const job = await deployContractQueue.add(
        "deploy-contract",
        { marketId, deadline: deadline.toISOString() } satisfies DeployContractJobData,
        { jobId: `deploy-${marketId}` } // Idempotent job ID prevents duplicates
    );

    log.info("Deploy contract job enqueued", {
        jobId: job.id,
        marketId,
    });
}

/**
 * Enqueues a market lock job delayed until the deadline.
 *
 * BullMQ's delay feature schedules this job to run at exactly
 * the deadline timestamp — no cron polling needed.
 * At deadline, the worker calls lock() on the contract.
 */
export async function enqueueLockMarket(
    marketId: string,
    deadline: Date
): Promise<void> {
    const delay = deadline.getTime() - Date.now();

    if (delay <= 0) {
        // Deadline already passed — enqueue immediately
        log.warn("Market deadline already passed, locking immediately", {
            marketId,
        });
    }

    const job = await lockMarketQueue.add(
        "lock-market",
        { marketId } satisfies LockMarketJobData,
        {
            jobId: `lock-${marketId}`,
            delay: Math.max(0, delay),
        }
    );

    log.info("Lock market job scheduled", {
        jobId: job.id,
        marketId,
        runsAt: deadline.toISOString(),
        delayMs: delay,
    });
}

/**
 * Enqueues a resolution job immediately.
 * Called by the lock worker after the market is locked on-chain.
 */
export async function enqueueResolveMarket(
    marketId: string
): Promise<void> {
    const job = await resolveMarketQueue.add(
        "resolve-market",
        { marketId } satisfies ResolveMarketJobData,
        { jobId: `resolve-${marketId}` }
    );

    log.info("Resolve market job enqueued", {
        jobId: job.id,
        marketId,
    });
}