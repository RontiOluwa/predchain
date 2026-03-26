import Anthropic from "@anthropic-ai/sdk";
import { loggers } from "@predchain/shared";
import type { Market, MarketOutcome, ResolutionEvidence } from "@predchain/shared";
import {
    RESOLUTION_AGENT_SYSTEM_PROMPT,
    buildResolutionPrompt,
} from "../parsers/prompt.templates.js";
import { z } from "zod";

const log = loggers.aiAgent;

const ResolutionResponseSchema = z.object({
    outcome: z.enum(["YES", "NO", "VOID"]),
    reasoning: z.string().min(10).max(500),
});

export type ResolutionResult =
    | { success: true; evidence: ResolutionEvidence }
    | { success: false; error: string };

export class ResolutionAgent {
    private client: Anthropic;
    private readonly MODEL = "claude-sonnet-4-5";

    constructor() {
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY is not set");
        }
        this.client = new Anthropic({ apiKey });
    }

    async evaluate(
        market: Market,
        oracleValue: string,
        oracleFetchedAt: string
    ): Promise<ResolutionResult> {
        log.info("Starting market resolution evaluation", {
            marketId: market.id,
            question: market.question,
            oracleValue,
            oracleFetchedAt,
        });

        // ── Fast path: numeric CHAINLINK_PRICE resolution ─────────────
        /**
         * Skip the LLM entirely for straightforward price comparisons.
         * Faster, cheaper, and deterministic.
         */
        if (market.resolutionSource === "CHAINLINK_PRICE") {
            const localResult = this.resolveNumericLocally(
                market.condition.operator,
                market.condition.threshold,
                oracleValue
            );

            if (localResult !== null) {
                log.info("Resolved numerically (fast path)", {
                    marketId: market.id,
                    outcome: localResult,
                    oracleValue,
                    threshold: market.condition.threshold,
                });

                return {
                    success: true,
                    evidence: {
                        marketId: market.id,
                        outcome: localResult,
                        oracleValue,
                        reasoning: `Numeric evaluation: ${oracleValue} ${market.condition.operator} ${market.condition.threshold} ${market.condition.unit} = ${localResult}`,
                        fetchedAt: oracleFetchedAt,
                    },
                };
            }
        }

        // ── LLM path: event-based / ambiguous resolution ──────────────
        const prompt = buildResolutionPrompt({
            question: market.question,
            operator: market.condition.operator,
            threshold: market.condition.threshold,
            unit: market.condition.unit,
            deadline: market.deadline,
            oracleValue,
            oracleFetchedAt,
        });

        let rawResponse: string;
        try {
            const message = await this.client.messages.create({
                model: this.MODEL,
                max_tokens: 200,
                system: RESOLUTION_AGENT_SYSTEM_PROMPT,
                messages: [{ role: "user", content: prompt }],
            });

            const block = message.content[0];
            if (!block || block.type !== "text") {
                return { success: false, error: "LLM returned no text content" };
            }

            rawResponse = block.text;
        } catch (err) {
            log.error("LLM resolution call failed", err);
            return {
                success: false,
                error: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        // ── Strip markdown fences and parse ───────────────────────────
        const cleaned = rawResponse
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();

        let parsed: unknown;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            return { success: false, error: "LLM returned invalid JSON" };
        }

        const validation = ResolutionResponseSchema.safeParse(parsed);
        if (!validation.success) {
            return {
                success: false,
                error: `Invalid resolution response: ${validation.error.message}`,
            };
        }

        const { outcome, reasoning } = validation.data;

        log.info("Market resolved via LLM", {
            marketId: market.id,
            outcome,
            reasoning,
        });

        return {
            success: true,
            evidence: {
                marketId: market.id,
                outcome,
                oracleValue,
                reasoning,
                fetchedAt: oracleFetchedAt,
            },
        };
    }

    /**
     * Resolves a numeric comparison locally without an LLM call.
     * Returns null if values can't be parsed — fallback to LLM.
     */
    private resolveNumericLocally(
        operator: string,
        threshold: string,
        oracleValue: string
    ): MarketOutcome | null {
        const thresholdNum = parseFloat(threshold);
        const oracleNum = parseFloat(oracleValue);

        if (isNaN(thresholdNum) || isNaN(oracleNum)) {
            log.warn("Could not parse numeric values for local resolution", {
                threshold,
                oracleValue,
            });
            return null;
        }

        let conditionMet: boolean;

        switch (operator) {
            case "gt": conditionMet = oracleNum > thresholdNum; break;
            case "gte": conditionMet = oracleNum >= thresholdNum; break;
            case "lt": conditionMet = oracleNum < thresholdNum; break;
            case "lte": conditionMet = oracleNum <= thresholdNum; break;
            case "eq": conditionMet = oracleNum === thresholdNum; break;
            case "neq": conditionMet = oracleNum !== thresholdNum; break;
            default:
                log.warn("Unknown operator, falling back to LLM", { operator });
                return null;
        }

        return conditionMet ? "YES" : "NO";
    }
}