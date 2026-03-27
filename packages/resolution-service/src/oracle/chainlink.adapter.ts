import {
    createPublicClient,
    http,
    parseAbiItem,
} from "viem";
import { baseSepolia } from "viem/chains";
import { loggers } from "@predchain/shared";

const log = loggers.resolutionService;

/**
 * Chainlink AggregatorV3Interface ABI.
 * This is the standard interface for all Chainlink price feeds.
 * Same ABI works for ETH/USD, BTC/USD, or any other feed.
 */
const AGGREGATOR_ABI = [
    parseAbiItem(
        "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
    ),
    parseAbiItem(
        "function decimals() view returns (uint8)"
    ),
    parseAbiItem(
        "function description() view returns (string)"
    ),
] as const;

/**
 * Known Chainlink feed addresses on Base Sepolia.
 * Maps the resolutionKey stored in the DB to the on-chain feed address.
 *
 * Full list: https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
 */
const FEED_ADDRESSES: Record<string, `0x${string}`> = {
    "ETH/USD": "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
    "BTC/USD": "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298",
    "LINK/USD": "0xb113F5A928BCfF189C998ab20d753a47F9dE5A61",
};

export interface OracleResult {
    /** The raw price value as a decimal string e.g. "4823.50" */
    value: string;
    /** When the oracle data was last updated on-chain */
    updatedAt: Date;
    /** The feed description e.g. "ETH / USD" */
    description: string;
    /** Unix timestamp when we fetched this data */
    fetchedAt: Date;
}

/**
 * ChainlinkAdapter reads price data from Chainlink Data Feeds on Base Sepolia.
 *
 * Why read directly from the chain instead of an API?
 * - Trustless: no intermediary can manipulate the data
 * - Verifiable: anyone can check the tx on the block explorer
 * - Decentralized: no single point of failure
 *
 * This is called by the MarketResolver when a CHAINLINK_PRICE
 * market needs to be resolved.
 */
export class ChainlinkAdapter {
    private client;

    constructor() {
        const rpcUrl = process.env["RPC_URL"];
        if (!rpcUrl) throw new Error("RPC_URL is not set");

        this.client = createPublicClient({
            chain: baseSepolia,
            transport: http(rpcUrl),
        });
    }

    /**
     * Fetches the latest price from a Chainlink feed.
     *
     * @param resolutionKey  Feed identifier from the DB e.g. "ETH/USD"
     * @returns              Parsed price as a decimal string
     *
     * Chainlink prices are returned as integers scaled by the feed's
     * decimal places. For ETH/USD with 8 decimals, a price of
     * $4823.50 comes back as 482350000000 (482350000000 / 10^8 = 4823.50).
     */
    async fetchPrice(resolutionKey: string): Promise<OracleResult> {
        log.info("Fetching Chainlink price", { resolutionKey });

        // ── Resolve feed address ──────────────────────────────────
        const feedAddress = this.resolveFeedAddress(resolutionKey);

        // ── Read decimals ─────────────────────────────────────────
        const decimals = await this.client.readContract({
            address: feedAddress,
            abi: AGGREGATOR_ABI,
            functionName: "decimals",
        });

        // ── Read latest price data ────────────────────────────────
        const [, answer, , updatedAt] = await this.client.readContract({
            address: feedAddress,
            abi: AGGREGATOR_ABI,
            functionName: "latestRoundData",
        });

        // ── Read feed description ─────────────────────────────────
        const description = await this.client.readContract({
            address: feedAddress,
            abi: AGGREGATOR_ABI,
            functionName: "description",
        });

        // ── Validate staleness ────────────────────────────────────
        /**
         * Chainlink feeds have a heartbeat (typically 1 hour for price feeds).
         * If the data is older than 2 hours, we consider it stale and refuse
         * to use it for resolution. A stale price could cause wrong outcomes.
         */
        const updatedAtDate = new Date(Number(updatedAt) * 1000);
        const staleThresholdMs = 2 * 60 * 60 * 1000; // 2 hours
        const ageMs = Date.now() - updatedAtDate.getTime();

        if (ageMs > staleThresholdMs) {
            throw new Error(
                `Chainlink feed "${resolutionKey}" data is stale. ` +
                `Last updated: ${updatedAtDate.toISOString()} (${Math.round(ageMs / 60000)} minutes ago)`
            );
        }

        // ── Parse price ───────────────────────────────────────────
        /**
         * Convert the raw integer answer to a human-readable decimal string.
         * answer is int256 so it could be negative (for certain feeds) —
         * but for price feeds it's always positive.
         */
        const rawPrice = answer < 0n ? 0n : answer;
        const divisor = BigInt(10 ** decimals);
        const wholePart = rawPrice / divisor;
        const fracPart = rawPrice % divisor;

        // Format with full decimal precision
        const fracStr = fracPart.toString().padStart(decimals, "0");
        const priceString = `${wholePart}.${fracStr}`;

        // Trim trailing zeros but keep at least 2 decimal places
        const trimmed = priceString.replace(/(\.\d{2,}?)0+$/, "$1");

        const result: OracleResult = {
            value: trimmed,
            updatedAt: updatedAtDate,
            description,
            fetchedAt: new Date(),
        };

        log.info("Chainlink price fetched", {
            resolutionKey,
            value: result.value,
            updatedAt: result.updatedAt.toISOString(),
        });

        return result;
    }

    /**
     * Resolves a resolutionKey to a feed contract address.
     * First checks the environment (for custom feeds), then the
     * built-in map, then throws if not found.
     */
    private resolveFeedAddress(resolutionKey: string): `0x${string}` {
        // Allow overriding feed addresses via env vars
        // e.g. CHAINLINK_ETH_USD_FEED for "ETH/USD"
        const envKey = `CHAINLINK_${resolutionKey.replace("/", "_")}_FEED`;
        const envAddress = process.env[envKey];

        if (envAddress) {
            return envAddress as `0x${string}`;
        }

        const address = FEED_ADDRESSES[resolutionKey];
        if (!address) {
            throw new Error(
                `No Chainlink feed address found for "${resolutionKey}". ` +
                `Add it to FEED_ADDRESSES or set ${envKey} in your .env`
            );
        }

        return address;
    }
}