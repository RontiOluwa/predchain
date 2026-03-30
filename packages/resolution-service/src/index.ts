import { PrismaClient } from "@prisma/client";
import { Worker } from "bullmq";
import { loggers } from "@predchain/shared";
import { MarketResolver } from "./resolver/market.resolver.js";
import { DeadlineMonitor } from "./cron/deadline.monitor.js";
import type { ResolveMarketJobData } from "./types.js";

const log = loggers.resolutionService;

const prisma = new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["error", "warn"] : ["error"],
});

const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const parsedUrl = new URL(redisUrl);

const redisConnection = {
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port || "6379"),
    password: parsedUrl.password || undefined,
    username: parsedUrl.username || undefined,
    tls: parsedUrl.protocol === "rediss:" ? {} : undefined,
};

// const redisConnection = {
//     host: process.env["REDIS_URL"]
//         ? new URL(process.env["REDIS_URL"]).hostname
//         : "localhost",
//     port: process.env["REDIS_URL"]
//         ? parseInt(new URL(process.env["REDIS_URL"]).port || "6379")
//         : 6379,
// };

/**
 * Resolution Service Entry Point.
 *
 * Two resolution triggers run simultaneously:
 *
 * 1. BullMQ Worker — listens on the "resolve-market" queue.
 *    The market-service lock worker enqueues jobs here immediately
 *    after locking a market on-chain. This is the fast path.
 *
 * 2. DeadlineMonitor — polls the DB every 60s as a safety net.
 *    Catches markets that were missed by the BullMQ worker
 *    (e.g. if the service was down during the deadline window).
 */
log.info("Resolution service starting", {
    nodeEnv: process.env["NODE_ENV"],
});

const resolver = new MarketResolver(prisma);

// ── BullMQ Worker ─────────────────────────────────────────────────
const resolveWorker = new Worker<ResolveMarketJobData>(
    "resolve-market",
    async (job) => {
        const { marketId } = job.data;
        log.info("Processing resolve-market job", { jobId: job.id, marketId });
        await resolver.resolve(marketId);
    },
    {
        connection: redisConnection,
        concurrency: 3,
    }
);

resolveWorker.on("completed", (job) => {
    log.info("Resolution job completed", { jobId: job.id });
});

resolveWorker.on("failed", (job, err) => {
    log.error("Resolution job failed", err, {
        jobId: job?.id,
        marketId: job?.data?.marketId,
        attemptsMade: job?.attemptsMade,
    });
});

// ── Deadline Monitor ──────────────────────────────────────────────
const monitor = new DeadlineMonitor(prisma);
monitor.start();

// ── Graceful Shutdown ─────────────────────────────────────────────
const shutdown = async () => {
    log.info("Shutting down resolution service");
    monitor.stop();
    await resolveWorker.close();
    await prisma.$disconnect();
    log.info("Resolution service stopped");
    process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Resolution service running", {
    triggers: ["bullmq:resolve-market", "deadline-monitor:60s"],
});