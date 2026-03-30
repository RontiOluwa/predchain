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

function isDev(): boolean {
    try {
        // @ts-ignore — process may not exist in all environments
        return (typeof process !== "undefined" && process.env?.["NODE_ENV"]) === "development";
    } catch {
        return false;
    }
}

export function createLogger(service: string) {
    return {
        debug(message: string, meta?: Record<string, unknown>) {
            if (isDev()) {
                // @ts-ignore
                console.debug(JSON.stringify(formatEntry("debug", service, message, meta)));
            }
        },

        info(message: string, meta?: Record<string, unknown>) {
            // @ts-ignore
            console.info(JSON.stringify(formatEntry("info", service, message, meta)));
        },

        warn(message: string, meta?: Record<string, unknown>) {
            // @ts-ignore
            console.warn(JSON.stringify(formatEntry("warn", service, message, meta)));
        },

        error(message: string, error?: unknown, meta?: Record<string, unknown>) {
            const errorMeta =
                error instanceof Error
                    ? { errorMessage: error.message, stack: error.stack }
                    : { error: String(error) };

            // @ts-ignore
            console.error(
                JSON.stringify(
                    formatEntry("error", service, message, { ...errorMeta, ...meta })
                )
            );
        },
    };
}

export const loggers = {
    aiAgent: createLogger("ai-agent"),
    marketService: createLogger("market-service"),
    resolutionService: createLogger("resolution-service"),
    apiGateway: createLogger("api-gateway"),
};