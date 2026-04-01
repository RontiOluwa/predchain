# @predchain/ai-agent

Claude-powered AI agent for Predchain. Handles two jobs:

1. **Intent parsing** — converts plain English predictions into structured `MarketSchema` objects
2. **Resolution** — evaluates oracle data against market conditions and determines YES/NO/VOID outcomes

Uses the Anthropic Claude SDK (`claude-sonnet-4-5`).

---

## Installation

```json
{
  "dependencies": {
    "@predchain/ai-agent": "workspace:*"
  }
}
```

Requires `ANTHROPIC_API_KEY` in the environment.

---

## IntentParser

Parses a natural language prediction into a fully structured `MarketSchema`.

```ts
import { IntentParser } from "@predchain/ai-agent";

const parser = new IntentParser();

const result = await parser.parse(
  "Will ETH exceed $5,000 by December 31st, 2026?"
);

console.log(result);
// {
//   success: true,
//   market: {
//     question: "Will ETH exceed $5,000 by December 31st, 2026?",
//     description: "This market resolves YES if...",
//     subject: "ETH",
//     condition: { operator: "gt", threshold: "5000", unit: "USD" },
//     deadline: "2026-12-31T23:59:59Z",
//     resolutionSource: "CHAINLINK_PRICE",
//     resolutionKey: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
//     confidence: 1.0,
//     parserNotes: "Clear price condition with Chainlink feed available"
//   }
// }
```

### How it works

1. Sends the raw input to Claude with a structured system prompt
2. Claude extracts:
   - **Subject** — what is being measured (asset, team, person, metric)
   - **Condition** — the comparison operator and threshold
   - **Deadline** — parsed into ISO 8601 format
   - **Resolution source** — Chainlink for price/rate data, web search for events
   - **Resolution key** — the specific feed address or search query to use
3. Claude validates whether the market is objectively resolvable
4. Returns a validated `MarketSchema` with a confidence score

### Confidence score

The confidence score (0.0–1.0) measures **resolvability**, not outcome probability:

- `1.0` — fully clear condition, reliable oracle available
- `0.8+` — resolvable but with some ambiguity in condition or timing
- `< 0.6` — subjective or difficult to resolve objectively

Markets with confidence below `0.5` are rejected.

### Resolution source selection

| Market type        | Resolution source | Example                         |
| ------------------ | ----------------- | ------------------------------- |
| Crypto price       | `CHAINLINK_PRICE` | "Will ETH exceed $5,000?"       |
| FX/commodity price | `CHAINLINK_PRICE` | "Will gold exceed $3,000?"      |
| Sports result      | `AI_WEB_SEARCH`   | "Will Arsenal win the league?"  |
| Real-world event   | `AI_WEB_SEARCH`   | "Will the Fed cut rates in Q2?" |
| Custom             | `MANUAL`          | Admin-resolved markets          |

### ParseResult type

```ts
interface ParseResult {
  success: boolean;
  market?: MarketSchema;
  error?: string;
}
```

---

## ResolutionAgent

Evaluates oracle data against a market's condition and determines the outcome.

```ts
import { ResolutionAgent } from "@predchain/ai-agent";

const agent = new ResolutionAgent();

const result = await agent.resolve(market, oracleValue);

console.log(result);
// {
//   outcome: "YES",
//   reasoning: "ETH/USD price at deadline was $5,234.50, which exceeds the threshold of $5,000 USD. Market resolves YES.",
//   confidence: 0.99
// }
```

### Parameters

| Param         | Type           | Description                            |
| ------------- | -------------- | -------------------------------------- |
| `market`      | `MarketSchema` | The parsed market definition           |
| `oracleValue` | `string`       | Raw value from Chainlink or web search |

### Outcome values

| Outcome | Meaning                                                |
| ------- | ------------------------------------------------------ |
| `YES`   | Condition was met                                      |
| `NO`    | Condition was not met                                  |
| `VOID`  | Unable to determine — market cancelled, refunds issued |

### ResolutionResult type

```ts
interface ResolutionResult {
  outcome: "YES" | "NO" | "VOID";
  reasoning: string;
  confidence: number;
}
```

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...    # Required — Anthropic API key
```

---

## Build

```bash
pnpm build     # Compile TypeScript to dist/
pnpm dev       # Watch mode
pnpm clean     # Remove dist/
```

---

## Structure

```
src/
├── parsers/
│   ├── intent.parser.ts       # IntentParser class
│   └── prompt.templates.ts    # System prompts for Claude
├── agents/
│   └── resolution.agent.ts    # ResolutionAgent class
└── index.ts                   # Public exports
```

---

## Prompt design

The system prompts in `prompt.templates.ts` are the core of the AI behaviour. They instruct Claude to:

- Return **only valid JSON** with no preamble or markdown
- Be conservative with confidence scores — prefer `VOID` over incorrect resolution
- Map price-based markets to specific Chainlink feed addresses
- Reject subjective or unresolvable markets gracefully

To tune the parsing behaviour, edit the prompt templates rather than the parser logic.
