/**
 * MarketStatus represents every stage a prediction market moves through.
 *
 * PENDING    → created in DB, contract not yet deployed
 * OPEN       → contract deployed, users can stake
 * LOCKED     → deadline passed, staking closed, awaiting resolution
 * RESOLVED   → oracle + AI have determined the outcome
 * SETTLED    → payouts distributed on-chain
 * CANCELLED  → market voided (e.g. oracle failure, bad question)
 */
export type MarketStatus =
    | "PENDING"
    | "OPEN"
    | "LOCKED"
    | "RESOLVED"
    | "SETTLED"
    | "CANCELLED";

/**
 * Outcome of a resolved market.
 * YES = condition was true, NO = condition was false.
 */
export type MarketOutcome = "YES" | "NO" | "VOID";

/**
 * The category of data source used to resolve the market.
 * This determines which oracle adapter the resolution service uses.
 */
export type ResolutionSource =
    | "CHAINLINK_PRICE"   // e.g. ETH/USD price feed
    | "CHAINLINK_EVENT"   // e.g. custom event feed
    | "AI_WEB_SEARCH"     // AI reads live web data (non-financial)
    | "MANUAL";           // human resolution (fallback)

/**
 * MarketSchema is the structured output produced by the AI intent parser.
 * It is the bridge between a user's natural language prediction
 * and the on-chain market contract.
 */
export interface MarketSchema {
    /** Human-readable question, e.g. "Will ETH exceed $5,000 by July 4th?" */
    question: string;

    /** Short description with more context */
    description: string;

    /** The subject of the prediction, e.g. "ETH", "Bitcoin", "Apple stock" */
    subject: string;

    /** The condition to evaluate at resolution time */
    condition: {
        /** The comparison operator */
        operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
        /** The threshold value as a string to avoid float precision issues */
        threshold: string;
        /** The unit of the threshold, e.g. "USD", "percent", "count" */
        unit: string;
    };

    /** ISO 8601 datetime string — when the market closes for new stakes */
    deadline: string;

    /** Where the resolution data comes from */
    resolutionSource: ResolutionSource;

    /**
     * For CHAINLINK_PRICE: the feed address on the target chain
     * For AI_WEB_SEARCH: a search query the resolution agent will run
     */
    resolutionKey: string;

    /**
     * AI confidence score 0–1 on the quality/resolvability of this market.
     * Low confidence markets can be flagged for manual review.
     */
    confidence: number;

    /** Any edge case notes the AI flagged during parsing */
    parserNotes?: string;
}

/**
 * A live market record as stored in PostgreSQL.
 * Extends MarketSchema with runtime/on-chain data.
 */
export interface Market extends MarketSchema {
    id: string;
    status: MarketStatus;
    outcome?: MarketOutcome;

    /** On-chain contract address, set after deployment */
    contractAddress?: string;

    /** Total tokens staked YES */
    yesPool: string;

    /** Total tokens staked NO */
    noPool: string;

    /** The wallet address that created this market */
    creatorAddress: string;

    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
}

/**
 * A single stake placed by a user on a market.
 */
export interface Stake {
    id: string;
    marketId: string;
    userAddress: string;
    side: "YES" | "NO";
    amount: string;
    /** On-chain transaction hash */
    txHash: string;
    createdAt: Date;
}

/**
 * Resolution evidence produced by the AI + oracle.
 * Stored for auditability — every resolution has a paper trail.
 */
export interface ResolutionEvidence {
    marketId: string;
    outcome: MarketOutcome;
    /** Raw value fetched from the oracle, e.g. "4823.50" */
    oracleValue: string;
    /** The AI's reasoning for the outcome decision */
    reasoning: string;
    /** ISO timestamp of when oracle data was fetched */
    fetchedAt: string;
    /** On-chain tx hash of the resolve() call */
    settlementTxHash?: string;
}