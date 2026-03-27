import { PrismaClient } from "@prisma/client";
import { loggers } from "@predchain/shared";
import { MarketResolver } from "../resolver/market.resolver.js";

const log = loggers.resolutionService;

/**
 * DeadlineMonitor polls the DB for markets that are LOCKED
 * and haven't been resolved yet, then triggers the resolver.
 *
 * Why poll in addition to BullMQ delayed jobs?
 * BullMQ is the primary trigger — the lock worker enqueues a
 * resolve job immediately after locking. But if the service
 * was down during that window, the resolve job may have been
 * missed. The monitor is the safety net that catches those cases.
 *
 * Poll interval: every 60 seconds.
 * In practice, most resolutions happen via BullMQ within seconds
 * of the deadline. This monitor handles edge cases only.
 */
export class DeadlineMonitor {
    private prisma: PrismaClient;
    private resolver: MarketResolver;
    private intervalHandle: NodeJS.Timeout | null = null;
    private isRunning = false;

    private readonly POLL_INTERVAL_MS = 60_000; // 1 minute

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.resolver = new MarketResolver(prisma);
    }

    /**
     * Starts the polling loop.
     * Runs immediately on start, then every POLL_INTERVAL_MS.
     */
    start(): void {
        if (this.isRunning) {
            log.warn("DeadlineMonitor already running");
            return;
        }

        this.isRunning = true;
        log.info("DeadlineMonitor started", {
            pollIntervalMs: this.POLL_INTERVAL_MS,
        });

        // Run immediately on start
        this.poll().catch((err) =>
            log.error("Initial poll failed", err)
        );

        // Then every interval
        this.intervalHandle = setInterval(() => {
            this.poll().catch((err) =>
                log.error("Scheduled poll failed", err)
            );
        }, this.POLL_INTERVAL_MS);
    }

    /**
     * Stops the polling loop gracefully.
     */
    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        this.isRunning = false;
        log.info("DeadlineMonitor stopped");
    }

    /**
     * One poll cycle:
     * 1. Find all LOCKED markets (deadline passed, not yet resolved)
     * 2. Find OPEN markets whose deadline has passed (need locking first)
     * 3. Resolve each LOCKED market via MarketResolver
     */
    private async poll(): Promise<void> {
        const now = new Date();
        log.debug("Polling for markets to resolve", { now: now.toISOString() });

        // ── Find markets stuck in LOCKED ──────────────────────────
        const lockedMarkets = await this.prisma.market.findMany({
            where: {
                status: "LOCKED",
                resolutionSource: {
                    not: "MANUAL", // Skip manual markets
                },
            },
            select: { id: true, question: true, deadline: true },
        });

        if (lockedMarkets.length > 0) {
            log.info("Found LOCKED markets to resolve", {
                count: lockedMarkets.length,
                marketIds: lockedMarkets.map((m) => m.id),
            });
        }

        // ── Resolve each market ───────────────────────────────────
        for (const market of lockedMarkets) {
            try {
                log.info("Resolving market via monitor", { marketId: market.id });
                await this.resolver.resolve(market.id);
            } catch (err) {
                /**
                 * Log the error but continue to the next market.
                 * One failing resolution should not block others.
                 */
                log.error("Failed to resolve market in monitor", err, {
                    marketId: market.id,
                });
            }
        }

        // ── Find OPEN markets past their deadline ─────────────────
        /**
         * These should have been locked by the BullMQ worker already.
         * If they weren't (service was down), we need to lock them
         * before they can be resolved.
         *
         * We don't lock them directly here — instead we log a warning
         * so an operator can investigate. Locking involves an on-chain
         * tx and we want to be careful about doing that without
         * the full worker flow.
         */
        const overdueMarkets = await this.prisma.market.findMany({
            where: {
                status: "OPEN",
                deadline: { lt: now },
            },
            select: { id: true, deadline: true },
        });

        if (overdueMarkets.length > 0) {
            log.warn("Found OPEN markets past their deadline — lock job may have been missed", {
                count: overdueMarkets.length,
                marketIds: overdueMarkets.map((m) => m.id),
            });
        }
    }
}