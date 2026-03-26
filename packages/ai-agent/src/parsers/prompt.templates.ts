/**
 * All LLM prompt templates live here — isolated from business logic.
 *
 * Why a separate file?
 * Prompts are not code — they're configuration. You'll tune these
 * independently of the parser logic. Keeping them here means you can
 * A/B test prompts without touching the parser, and the diff is clean.
 */

// ─── Intent Parser ────────────────────────────────────────────────────────────

/**
 * Tells the LLM exactly what role it plays and what rules to follow.
 * Sent once as the "system" message before every parse request.
 */
export const INTENT_PARSER_SYSTEM_PROMPT = `
You are a prediction market analyst. Your job is to convert a user's
natural language prediction into a strict JSON object.

## Output shape
Return ONLY a JSON object with these exact fields. No preamble,
no explanation, no markdown fences.

{
  "question":          string,   // Full, clear question form of the prediction
  "description":       string,   // 1-2 sentence elaboration
  "subject":           string,   // What entity is being predicted about
  "condition": {
    "operator":        "gt" | "gte" | "lt" | "lte" | "eq" | "neq",
    "threshold":       string,   // Numeric string, e.g. "5000"
    "unit":            string    // e.g. "USD", "percent", "goals"
  },
  "deadline":          string,   // ISO 8601 UTC datetime
  "resolutionSource":  "CHAINLINK_PRICE" | "CHAINLINK_EVENT" | "AI_WEB_SEARCH" | "MANUAL",
  "resolutionKey":     string,   // Feed address or search query string
  "confidence":        number,   // 0.0–1.0 how clearly resolvable this market is
  "parserNotes":       string    // Any ambiguity you noticed (optional)
}

## Resolution source rules
- Crypto/stock price comparisons → CHAINLINK_PRICE
  Set resolutionKey to the appropriate Chainlink feed identifier,
  e.g. "ETH/USD", "BTC/USD"
- Real-world events (sports scores, elections, product launches) → AI_WEB_SEARCH
  Set resolutionKey to a precise search query that would return the outcome,
  e.g. "Arsenal vs Chelsea Premier League result 2025-05-01"
- Anything requiring human judgement → MANUAL

## Confidence scoring
1.0  — Exact numeric threshold + clear deadline + verifiable source
0.8  — Clear but deadline is vague (e.g. "end of year")
0.6  — Condition requires interpretation
0.4  — Ambiguous or subjective outcome
<0.4 — Unresolvable, flag in parserNotes

## Critical rules
- deadline must always be in the future relative to today
- threshold must always be a numeric string (no commas, no currency symbols)
- Never add extra fields to the JSON
- If you cannot form a valid MarketSchema, return confidence: 0.1 and explain in parserNotes
`.trim();

/**
 * Builds the user turn message for the intent parser.
 * Injecting today's date prevents the LLM from anchoring on stale training data
 * when interpreting relative time references like "by Q3" or "end of this year".
 */
export function buildParserUserPrompt(rawInput: string): string {
  return `Convert this prediction into the MarketSchema JSON:

"${rawInput}"

Today's date and time (UTC): ${new Date().toISOString()}

Return JSON only.`;
}

// ─── Resolution Agent ─────────────────────────────────────────────────────────

/**
 * System prompt for the resolution agent.
 * This agent receives oracle data and must decide YES, NO, or VOID.
 */
export const RESOLUTION_AGENT_SYSTEM_PROMPT = `
You are a prediction market resolution judge. Your job is to evaluate
whether a market's condition was met, given evidence from an oracle.

You will receive:
- The original market question and condition
- The oracle value fetched at the resolution deadline
- The deadline timestamp

You must return ONLY a JSON object:
{
  "outcome":   "YES" | "NO" | "VOID",
  "reasoning": string   // 1-3 sentences explaining your decision
}

## Decision rules
- YES: The condition was fully met at or before the deadline
- NO:  The condition was not met at the deadline
- VOID: The oracle data is missing, clearly corrupted, or the question
        is fundamentally unresolvable (e.g. the event never occurred)

## Critical rules
- Be deterministic. Same inputs must always produce the same output.
- Do not consider price movement after the deadline.
- Do not add extra fields.
- Return JSON only — no preamble, no markdown.
`.trim();

/**
 * Builds the resolution prompt.
 * Formats the market criteria and oracle evidence into a clear evaluation task.
 */
export function buildResolutionPrompt(params: {
  question: string;
  operator: string;
  threshold: string;
  unit: string;
  deadline: string;
  oracleValue: string;
  oracleFetchedAt: string;
}): string {
  return `Evaluate this prediction market:

Question:   "${params.question}"
Condition:  value ${params.operator} ${params.threshold} ${params.unit}
Deadline:   ${params.deadline}

Oracle evidence:
  Value fetched: ${params.oracleValue} ${params.unit}
  Fetched at:    ${params.oracleFetchedAt}

Return the outcome JSON.`;
}