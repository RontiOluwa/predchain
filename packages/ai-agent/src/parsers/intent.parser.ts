import Anthropic from "@anthropic-ai/sdk";
import { loggers, MarketSchemaValidator } from "@predchain/shared";
import type { MarketSchema } from "@predchain/shared";
import {
    INTENT_PARSER_SYSTEM_PROMPT,
    buildParserUserPrompt,
} from "./prompt.templates.js";

const log = loggers.aiAgent;

export type ParseResult =
    | { success: true; data: MarketSchema }
    | { success: false; error: string; rawResponse?: string };

export class IntentParser {
    private client: Anthropic;

    /**
     * MODEL CHOICE: claude-sonnet-4-5
     *
     * Strong instruction following for structured JSON extraction.
     * Swap to "claude-haiku-4-5-20251001" for faster/cheaper dev testing.
     */
    private readonly MODEL = "claude-sonnet-4-5";
    private readonly MIN_ACCEPTABLE_CONFIDENCE = 0.4;

    constructor() {
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey) {
            throw new Error(
                "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
            );
        }
        this.client = new Anthropic({ apiKey });
    }

    async parse(rawInput: string): Promise<ParseResult> {
        log.info("Starting intent parse", { rawInput });

        // ── Step 1: Call the LLM ──────────────────────────────────────
        let rawResponse: string;

        try {
            const message = await this.client.messages.create({
                model: this.MODEL,
                max_tokens: 800,
                /**
                 * Anthropic uses a top-level system param, not a system message
                 * inside the messages array. The user turn carries the actual input.
                 */
                system: INTENT_PARSER_SYSTEM_PROMPT,
                messages: [
                    { role: "user", content: buildParserUserPrompt(rawInput) },
                ],
            });

            /**
             * Anthropic returns an array of content blocks.
             * For text responses we grab the first text block.
             */
            const block = message.content[0];
            if (!block || block.type !== "text") {
                return { success: false, error: "LLM returned no text content" };
            }

            rawResponse = block.text;
            log.debug("LLM raw response received", { rawResponse });
        } catch (err) {
            log.error("LLM API call failed", err);
            return {
                success: false,
                error: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        // ── Step 2: Strip markdown fences if present ──────────────────
        /**
         * Claude sometimes wraps JSON in ```json ... ``` even when instructed
         * not to. We strip fences defensively before parsing.
         */
        const cleaned = rawResponse
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();

        // ── Step 3: Parse JSON ────────────────────────────────────────
        let parsed: unknown;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            log.error("LLM response was not valid JSON", undefined, { rawResponse });
            return {
                success: false,
                error: "LLM returned invalid JSON",
                rawResponse,
            };
        }

        // ── Step 4: Validate with Zod ─────────────────────────────────
        const validation = MarketSchemaValidator.safeParse(parsed);
        if (!validation.success) {
            log.error("MarketSchema Zod validation failed", validation.error, {
                rawResponse,
            });
            return {
                success: false,
                error: `Schema validation failed: ${validation.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join(", ")}`,
                rawResponse,
            };
        }

        const schema = validation.data;

        // ── Step 5: Confidence gate ───────────────────────────────────
        if (schema.confidence < this.MIN_ACCEPTABLE_CONFIDENCE) {
            log.warn("Market confidence below threshold", {
                confidence: schema.confidence,
                parserNotes: schema.parserNotes,
                question: schema.question,
            });
        }

        // ── Step 6: Deadline sanity check ─────────────────────────────
        const deadline = new Date(schema.deadline);
        if (deadline <= new Date()) {
            return {
                success: false,
                error: `Deadline "${schema.deadline}" is in the past.`,
            };
        }

        log.info("Intent parsed successfully", {
            question: schema.question,
            subject: schema.subject,
            resolutionSource: schema.resolutionSource,
            confidence: schema.confidence,
            deadline: schema.deadline,
        });

        return { success: true, data: schema };
    }
}