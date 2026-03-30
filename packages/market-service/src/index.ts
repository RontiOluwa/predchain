import "dotenv/config";
import { loggers } from "@predchain/shared";
import { deployContractWorker, lockMarketWorker } from "./jobs/market.worker.js";

// Start HTTP server
import "./server.js";

const log = loggers.marketService;

log.info("Market service starting", {
    nodeEnv: process.env["NODE_ENV"],
    redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
});

log.info("Workers started", {
    workers: ["deploy-contract", "lock-market"],
});

const shutdown = async () => {
    log.info("Shutting down market service");
    await Promise.all([
        deployContractWorker.close(),
        lockMarketWorker.close(),
    ]);
    log.info("All workers stopped");
    process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);