import Anthropic from "@anthropic-ai/sdk";
import { loggers } from "@predchain/shared";
import { z } from "zod";

const log = loggers.resolutionService;

/**
 * Schema for the web search result we expect Claude to return.
 */
const WebSearchResultSchema = z.object({
    found: z.boolean(),
    value: z.string(),
    source: z.string().optional(),
    summary: z.string(),
});

export interface WebSearchResult {
    found: boolean;
    /** The factual value discovered e.g. "Arsenal finished 2nd" */
    value: string;
    /** URL or source name if found */
    source?: string | undefined;
    /** Human-readable summary for the resolution evidence */
    summary: string;
    fetchedAt: Date;
}

/**
 * WebSearchAdapter uses Claude's web_search tool to find
 * real-world event outcomes for AI_WEB_SEARCH markets.
 *
 * Why Claude for web search instead of a raw search API?
 * - Claude can interpret ambiguous results and extract the relevant fact
 * - It handles edge cases (postponed events, disputed outcomes, etc.)
 * - The same Anthropic API key we already have covers this
 *
 * This is called by the MarketResolver for markets where
 * resolutionSource === "AI_WEB_SEARCH".
 */
export class WebSearchAdapter {
    private client: Anthropic;
    private readonly MODEL = "claude-sonnet-4-5";

    constructor() {
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
        this.client = new Anthropic({ apiKey });
    }

    /**
     * Searches for the outcome of a real-world event.
     *
     * @param resolutionKey  Search query from the MarketSchema
     *                       e.g. "Arsenal Premier League winners 2025-26"
     * @param deadline       Market deadline — we only care about events
     *                       that occurred before this date
     * @returns              Structured result with the found value
     */
    async search(
        resolutionKey: string,
        deadline: Date
    ): Promise<WebSearchResult> {
        log.info("Running web search for market resolution", { resolutionKey });

        const systemPrompt = `
You are a fact-checker for a prediction market resolution system.
Your job is to search for the outcome of a specific real-world event
and return a structured JSON result.

Rules:
- Only consider events that occurred ON OR BEFORE: ${deadline.toISOString()}
- If the event hasn't happened yet or you can't find a definitive result, set found: false
- Be precise and factual — this result determines financial payouts
- Return ONLY valid JSON matching the schema below, no preamble

Schema:
{
  "found": boolean,
  "value": string,      // The factual outcome e.g. "Arsenal finished 2nd with 74 points"
  "source": string,     // Where you found it e.g. "BBC Sport, premierleague.com"
  "summary": string     // 1-2 sentence explanation for the resolution record
}
`.trim();

        const userPrompt = `Search for the outcome of this event and return the result JSON:

Event query: "${resolutionKey}"
Deadline (only events on or before this date count): ${deadline.toISOString()}`;

        try {
            const message = await this.client.messages.create({
                model: this.MODEL,
                max_tokens: 1024,
                system: systemPrompt,
                /**
                 * web_search tool lets Claude search the live web.
                 * This is what makes AI_WEB_SEARCH markets resolvable —
                 * Claude can fetch current sports scores, election results,
                 * product launch confirmations, etc.
                 */
                tools: [
                    {
                        type: "web_search_20250305",
                        name: "web_search",
                    } as any,
                ],
                messages: [{ role: "user", content: userPrompt }],
            });

            // Extract the final text response (after any tool use)
            const textBlock = message.content
                .filter((block) => block.type === "text")
                .pop();

            if (!textBlock || textBlock.type !== "text") {
                return {
                    found: false,
                    value: "No result found",
                    summary: "Web search returned no usable response",
                    fetchedAt: new Date(),
                };
            }

            // Strip markdown fences and parse
            const cleaned = textBlock.text
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, "")
                .trim();

            let parsed: unknown;
            try {
                parsed = JSON.parse(cleaned);
            } catch {
                log.warn("Web search response was not valid JSON", {
                    raw: textBlock.text,
                });
                return {
                    found: false,
                    value: textBlock.text.slice(0, 200),
                    summary: "Could not parse web search response as JSON",
                    fetchedAt: new Date(),
                };
            }

            const validation = WebSearchResultSchema.safeParse(parsed);
            if (!validation.success) {
                log.warn("Web search result failed schema validation", {
                    error: validation.error.message,
                });
                return {
                    found: false,
                    value: "Schema validation failed",
                    summary: "Web search result did not match expected format",
                    fetchedAt: new Date(),
                };
            }

            const result: WebSearchResult = {
                ...validation.data,
                fetchedAt: new Date(),
            };

            log.info("Web search completed", {
                resolutionKey,
                found: result.found,
                value: result.value,
            });

            return result;
        } catch (err) {
            log.error("Web search failed", err);
            throw new Error(
                `Web search failed: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }
}