import { PrismaClient } from "@prisma/client";
import { loggers } from "@predchain/shared";

const log = loggers.marketService;

/**
 * Prisma Client Singleton.
 *
 * Why a singleton?
 * PrismaClient opens a connection pool to PostgreSQL.
 * Creating a new instance on every request would exhaust connections fast.
 * One instance lives for the entire process lifetime.
 *
 * The globalThis trick prevents hot-reload (tsx watch) from opening
 * multiple pools — without it, every file save spawns a new pool.
 */
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log:
            process.env["NODE_ENV"] === "development"
                ? ["query", "error", "warn"]
                : ["error"],
    });

if (process.env["NODE_ENV"] !== "production") {
    globalForPrisma.prisma = prisma;
}

process.on("beforeExit", async () => {
    log.info("Disconnecting Prisma client");
    await prisma.$disconnect();
});