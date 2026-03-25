import { z } from "zod";

/**
 * Zod schema for MarketSchema.
 *
 * Why Zod in addition to TypeScript types?
 * TypeScript types are compile-time only — they disappear at runtime.
 * Zod validates data at runtime: API request bodies, AI responses,
 * oracle data, anything that crosses a trust boundary.
 */
export const ConditionSchema = z.object({
    operator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]),
    threshold: z.string().regex(/^\d+(\.\d+)?$/, "Must be a numeric string"),
    unit: z.string().min(1),
});

export const MarketSchemaValidator = z.object({
    question: z.string().min(10).max(280),
    description: z.string().min(10).max(1000),
    subject: z.string().min(1).max(100),
    condition: ConditionSchema,
    deadline: z.string().datetime({ message: "Must be a valid ISO 8601 datetime" }),
    resolutionSource: z.enum([
        "CHAINLINK_PRICE",
        "CHAINLINK_EVENT",
        "AI_WEB_SEARCH",
        "MANUAL",
    ]),
    resolutionKey: z.string().min(1),
    confidence: z.number().min(0).max(1),
    parserNotes: z.string().optional(),
});

/**
 * Schema for a user submitting a new prediction via the API.
 * This is the raw input — just the text, before AI processing.
 */
export const CreateMarketRequestSchema = z.object({
    rawInput: z
        .string()
        .min(10, "Prediction must be at least 10 characters")
        .max(500, "Prediction must be under 500 characters"),
    creatorAddress: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
});

/**
 * Schema for placing a stake on a market.
 */
export const StakeRequestSchema = z.object({
    marketId: z.string().uuid(),
    side: z.enum(["YES", "NO"]),
    amount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a numeric string"),
    userAddress: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
    txHash: z
        .string()
        .regex(/^0x[a-fA-F0-9]{64}$/, "Must be a valid transaction hash"),
});

export type CreateMarketRequest = z.infer<typeof CreateMarketRequestSchema>;
export type StakeRequest = z.infer<typeof StakeRequestSchema>;