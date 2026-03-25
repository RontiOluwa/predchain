/**
 * Structured logger for all predchain services.
 *
 * Uses console under the hood for simplicity now.
 * In production, swap the underlying transport to Pino or Winston
 * and ship logs to a service like Datadog or Logtail.
 *
 * Every log line is JSON so it's machine-parseable in production.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    level: LogLevel;
    service: string;
    message: string;
    timestamp: string;
    [key: string]: unknown;
}

function formatEntry(
    level: LogLevel,
    service: string,
    message: string,
    meta?: Record<string, unknown>
): LogEntry {
    return {
        level,
        service,
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };
}

export function createLogger(service: string) {
    return {
        debug(message: string, meta?: Record<string, unknown>) {
            if (process.env["NODE_ENV"] === "development") {
                console.debug(JSON.stringify(formatEntry("debug", service, message, meta)));
            }
        },

        info(message: string, meta?: Record<string, unknown>) {
            console.info(JSON.stringify(formatEntry("info", service, message, meta)));
        },

        warn(message: string, meta?: Record<string, unknown>) {
            console.warn(JSON.stringify(formatEntry("warn", service, message, meta)));
        },

        error(message: string, error?: unknown, meta?: Record<string, unknown>) {
            const errorMeta =
                error instanceof Error
                    ? { errorMessage: error.message, stack: error.stack }
                    : { error: String(error) };

            console.error(
                JSON.stringify(
                    formatEntry("error", service, message, { ...errorMeta, ...meta })
                )
            );
        },
    };
}

/** Pre-built logger instances for each service */
export const loggers = {
    aiAgent: createLogger("ai-agent"),
    marketService: createLogger("market-service"),
    resolutionService: createLogger("resolution-service"),
    apiGateway: createLogger("api-gateway"),
};