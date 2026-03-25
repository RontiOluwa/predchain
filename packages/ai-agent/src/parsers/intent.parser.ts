import OpenAI from "openai";
import { loggers } from "@predchain/shared";
import { MarketSchemaValidator } from "@predchain/shared";
import type { MarketSchema } from "@predchain/shared";
import {
    INTENT_PARSER_SYSTEM_PROMPT,
    buildParserUserPrompt,
} from "./prompt.templates.js";

const log = loggers.aiAgent;

export class IntentParser {
    private client: OpenAI;

    constructor() {
        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
        this.client = new OpenAI({ apiKey });
    }

    async parse(rawInput: string): Promise<MarketSchema> {
        log.info("Parsing intent", { rawInput });

        const response = await this.client.chat.completions.create({
            model: "gpt-4o",
            temperature: 0,  // zero temp = deterministic, structured output
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: INTENT_PARSER_SYSTEM_PROMPT },
                { role: "user", content: buildParserUserPrompt(rawInput) },
            ],
        });

        const raw = response.choices[0]?.message?.content;
        if (!raw) throw new Error("Empty response from LLM");

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error(`LLM returned invalid JSON: ${raw}`);
        }

        // Validate against our Zod schema — never trust LLM output blindly
        const result = MarketSchemaValidator.safeParse(parsed);
        if (!result.success) {
            log.error("MarketSchema validation failed", result.error, { raw });
            throw new Error(`Invalid MarketSchema: ${result.error.message}`);
        }

        log.info("Intent parsed successfully", {
            question: result.data.question,
            confidence: result.data.confidence,
        });

        return result.data;
    }
}