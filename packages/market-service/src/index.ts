import "dotenv/config";
import { loggers } from "@predchain/shared";
import {
    deployContractWorker,
    lockMarketWorker,
} from "./jobs/market.worker.js";

const log = loggers.marketService;

/**
 * Market Service Entry Point.
 *
 * When run directly (pnpm dev), this starts all three BullMQ workers.
 * Workers listen to Redis and process jobs as they arrive.
 *
 * The MarketService class is also exported for use by the API gateway —
 * the gateway imports it directly rather than calling over HTTP,
 * keeping the internal architecture simple.
 */

log.info("Market service starting", {
    nodeEnv: process.env["NODE_ENV"],
    redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
});

// Workers start listening as soon as they're imported
log.info("Workers started", {
    workers: ["deploy-contract", "lock-market", "resolve-market"],
});

// Graceful shutdown
const shutdown = async () => {
    log.info("Shutting down market service workers");
    await Promise.all([
        deployContractWorker.close(),
        lockMarketWorker.close(),
        // resolveMarketWorker.close(),
    ]);
    log.info("All workers stopped");
    process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);